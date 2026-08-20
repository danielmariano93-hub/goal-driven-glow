// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — composição de situações financeiras (função pura).
// Um sinal isolado raramente muda uma decisão. A situação cruza domínios
// (fatura × caixa, meta × ritmo, compromisso × entrada prevista) e é a única
// unidade que pode virar comunicação.
import type {
  FinancialSignal,
  FinancialSituation,
  MultiFinanceProactiveContext,
  ProactiveDomain,
  SituationSeverity,
} from "./contracts.ts";
import { PROACTIVE_MULTIFINANCE_VERSION } from "./contracts.ts";

function brl(value: number): string {
  return `R$ ${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

function pick(signals: FinancialSignal[], key: string): FinancialSignal | undefined {
  return signals.find((signal) => signal.key === key);
}

function byDomain(signals: FinancialSignal[], domain: ProactiveDomain): FinancialSignal[] {
  return signals.filter((signal) => signal.domain === domain);
}

function domainsOf(signals: FinancialSignal[]): ProactiveDomain[] {
  return [...new Set(signals.map((signal) => signal.domain))];
}

function minConfidence(signals: FinancialSignal[]): number {
  return signals.reduce((min, signal) => Math.min(min, signal.confidence), 1);
}

function nearestDays(signals: FinancialSignal[]): number | null {
  const values = signals.map((s) => s.days_until).filter((v): v is number => v != null);
  return values.length > 0 ? Math.min(...values) : null;
}

function situation(input: {
  ctx: MultiFinanceProactiveContext;
  type: string;
  communication_kind: string;
  severity: SituationSeverity;
  title: string;
  body: string;
  primary_domain: ProactiveDomain;
  signals: FinancialSignal[];
  impact_amount: number;
  route: string | null;
  anchor: string;
}): FinancialSituation {
  const { ctx, signals } = input;
  return {
    fingerprint: `${PROACTIVE_MULTIFINANCE_VERSION}:${input.type}:${input.anchor}`,
    type: input.type,
    communication_kind: input.communication_kind,
    severity: input.severity,
    title: input.title,
    body: input.body,
    primary_domain: input.primary_domain,
    domains: domainsOf(signals),
    signals,
    impact_amount: Math.round(Math.abs(input.impact_amount) * 100) / 100,
    days_until: nearestDays(signals),
    confidence: Math.round(minConfidence(signals) * 100) / 100,
    actionable: signals.some((signal) => signal.actionable),
    route: input.route,
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: PROACTIVE_MULTIFINANCE_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      formula_version: ctx.snapshot_ref.formula_version,
      materiality_floor: ctx.materiality_floor,
      monthly_income: ctx.monthly_income,
      signals: signals.map((signal) => ({
        key: signal.key, domain: signal.domain, label: signal.label,
        amount: signal.amount, confidence: signal.confidence, evidence: signal.evidence,
      })),
    },
  };
}

export function composeFinancialSituations(
  signals: FinancialSignal[],
  ctx: MultiFinanceProactiveContext,
): FinancialSituation[] {
  const out: FinancialSituation[] = [];
  const used = new Set<string>();
  const consume = (list: FinancialSignal[]) => list.forEach((signal) => used.add(signal.key));

  const cashNegative = signals.find((signal) => signal.key.startsWith("cash_negative:"));
  const monthEnd = pick(signals, "month_end_shortfall");
  const cardAboveCash = pick(signals, "card_above_cash");
  const cardDue = pick(signals, "card_due_this_month");
  const cluster = pick(signals, "commitment_cluster");
  const pace = pick(signals, "pace_above_typical");

  // 1) Aperto de caixa causado por fatura: a situação mais decisiva do produto.
  if (cashNegative && (cardAboveCash || cardDue)) {
    const group = [cashNegative, cardAboveCash ?? cardDue!, ...(cluster ? [cluster] : [])];
    consume(group);
    out.push(situation({
      ctx,
      type: "card_pressure_on_cash",
      communication_kind: "card_bill_pressure",
      severity: "critical",
      title: `Sua fatura não cabe no caixa de ${cashNegative.date}`,
      body: `Com a fatura de ${brl((cardDue ?? cardAboveCash)!.amount)} e os compromissos já conhecidos, o caixa projetado fica em ${brl(cashNegative.amount)} negativo em ${cashNegative.date}. Vale antecipar entrada, remanejar compromisso ou planejar o pagamento parcial.`,
      primary_domain: "cards",
      signals: group,
      impact_amount: cashNegative.amount,
      route: "/app/contas",
      anchor: `${cashNegative.date}`,
    }));
  } else if (cashNegative) {
    const group = [cashNegative, ...(cluster ? [cluster] : []), ...(pace ? [pace] : [])];
    consume(group);
    out.push(situation({
      ctx,
      type: "cash_shortfall_ahead",
      communication_kind: "upcoming_cash_pressure",
      severity: "critical",
      title: `Caixa fica negativo em ${cashNegative.date}`,
      body: `Somando o que já está agendado, o saldo projetado chega a ${brl(cashNegative.amount)} negativo em ${cashNegative.date}.${cluster ? ` O peso vem de ${cluster.label.toLowerCase()}.` : ""}`,
      primary_domain: "cash",
      signals: group,
      impact_amount: cashNegative.amount,
      route: "/app/compromissos",
      anchor: `${cashNegative.date}`,
    }));
  } else if (monthEnd) {
    const group = [monthEnd, ...(pace ? [pace] : []), ...(cardDue ? [cardDue] : [])];
    consume(group);
    out.push(situation({
      ctx,
      type: "month_end_shortfall",
      communication_kind: "cash_flow_imbalance",
      severity: "attention",
      title: `O mês deve fechar ${brl(monthEnd.amount)} no vermelho`,
      body: `Considerando entradas previstas e compromissos conhecidos, a projeção de fechamento é ${brl(monthEnd.amount)} negativa.${pace ? ` O ritmo atual está acima do típico.` : ""}`,
      primary_domain: "cash",
      signals: group,
      impact_amount: monthEnd.amount,
      route: "/app/planejamento",
      anchor: String((ctx.domains.cash as any)?.month_end ?? ctx.as_of),
    }));
  }

  // 2) Dívidas com vencimento próximo (uma situação por dívida).
  for (const signal of byDomain(signals, "debts")) {
    if (used.has(signal.key)) continue;
    used.add(signal.key);
    const overdue = (signal.days_until ?? 9) <= 0;
    out.push(situation({
      ctx,
      type: overdue ? "debt_overdue" : "debt_due_soon",
      communication_kind: overdue ? "debt_overdue" : "debt_due_soon",
      severity: overdue ? "critical" : "attention",
      title: signal.label,
      body: `${signal.label}. Confirme o pagamento para manter o histórico da dívida em dia.`,
      primary_domain: "debts",
      signals: [signal],
      impact_amount: signal.amount,
      route: signal.route,
      anchor: signal.key,
    }));
  }

  // 3) Metas por categoria: teto ultrapassado ou projeção de excesso.
  for (const signal of byDomain(signals, "goals")) {
    if (used.has(signal.key)) continue;
    const group = [signal, ...(pace && !used.has(pace.key) ? [pace] : [])];
    consume(group);
    const exceeded = Number((signal.evidence as any)?.overage ?? 0) > 0;
    out.push(situation({
      ctx,
      type: "category_goal_pressure",
      communication_kind: "goal_feasibility",
      severity: exceeded ? "critical" : "attention",
      title: signal.label,
      body: exceeded
        ? `${signal.label}. Ver o plano do Nino para essa categoria ajuda a decidir onde cortar até o fim do período.`
        : `${signal.label}. Ajustar agora evita o excesso no fechamento do período.`,
      primary_domain: "goals",
      signals: group,
      impact_amount: signal.amount,
      route: signal.route,
      anchor: String((signal.evidence as any)?.goal_id ?? signal.key),
    }));
  }

  // 4) Concentração de compromissos sem risco de caixa: contexto útil, não alarme.
  if (cluster && !used.has(cluster.key)) {
    used.add(cluster.key);
    out.push(situation({
      ctx,
      type: "commitment_cluster",
      communication_kind: "recurring_commitment_pressure",
      severity: "info",
      title: cluster.label,
      body: `${cluster.label}. O caixa projetado ainda cobre, mas vale conferir a ordem dos pagamentos.`,
      primary_domain: "commitments",
      signals: [cluster],
      impact_amount: cluster.amount,
      route: cluster.route,
      anchor: String(cluster.date ?? ctx.as_of),
    }));
  }

  // 5) Ritmo acima do típico sozinho.
  if (pace && !used.has(pace.key)) {
    used.add(pace.key);
    out.push(situation({
      ctx,
      type: "spending_pace",
      communication_kind: "spending_pace_change",
      severity: "attention",
      title: `Seu ritmo está acima do típico`,
      body: `${pace.label}. Mantido até o fim do mês, isso representa cerca de ${brl(pace.amount)} a mais.`,
      primary_domain: "patterns",
      signals: [pace],
      impact_amount: pace.amount,
      route: pace.route,
      anchor: ctx.as_of,
    }));
  }

  // 6) Padrões e emoções do diagnóstico canônico (sem recontar dinheiro).
  for (const signal of signals) {
    if (used.has(signal.key) || !signal.key.startsWith("diagnosis:")) continue;
    used.add(signal.key);
    const kind = String((signal.evidence as any)?.kind ?? "pattern");
    out.push(situation({
      ctx,
      type: kind === "achievement" ? "achievement" : "behavioral_pattern",
      communication_kind: kind === "achievement" ? "goal_progress" : "emotional_spending",
      severity: kind === "achievement" ? "info" : "attention",
      title: signal.label,
      body: String((signal.evidence as any)?.summary ?? signal.label),
      primary_domain: signal.domain,
      signals: [signal],
      impact_amount: signal.amount,
      route: signal.route,
      anchor: String((signal.evidence as any)?.logical_topic_key ?? signal.key),
    }));
  }

  // 7) Performance (financial_performance.v1): mudança material do período.
  //    Melhora vira reconhecimento; piora vira atenção. Nunca cria número.
  for (const signal of signals) {
    if (used.has(signal.key) || signal.domain !== "performance") continue;
    used.add(signal.key);
    const evidence = signal.evidence as any;
    const positive = signal.direction === "achievement";
    out.push(situation({
      ctx,
      type: String(evidence?.performance_signal_kind ?? "performance_change"),
      communication_kind: positive ? "performance_improvement" : "performance_deterioration",
      severity: positive ? "info" : (String(evidence?.severity ?? "info") === "critical" ? "critical" : "attention"),
      title: signal.label,
      body: String(evidence?.interpretation ?? signal.label),
      primary_domain: "performance",
      signals: [signal],
      impact_amount: signal.amount,
      route: signal.route,
      anchor: String(evidence?.logical_topic_key ?? signal.key),
    }));
  }

  return out;
}
