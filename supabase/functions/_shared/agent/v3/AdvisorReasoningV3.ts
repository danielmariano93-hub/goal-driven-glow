// Nino Runtime V3 — advisor reasoning (scenario, decision, goal projection).
//
// The semantic authority already decided WHAT the user is weighing. This
// module only gathers owned evidence and computes the hypothetical deltas
// deterministically. It never writes, never invents a personal fact and never
// treats a user hypothesis as a transaction. The deterministic body produced
// here is the source of truth the conversational composer is allowed to
// explain; if composition fails, this body is what the user receives.
// deno-lint-ignore-file no-explicit-any

import type { AdvisoryParams, ConversationTurnContract } from "../core/ConversationTurnContract.ts";

export const ADVISOR_REASONING_VERSION = "nino_advisor_reasoning.v1";

export type AdvisorToolCall = {
  tool_name: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  error?: string | null;
};

export type AdvisorToolRunner = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ ok: boolean; result: any; error?: string | null }>;

export type CategoryBaseline = {
  category: string;
  typical_monthly: number | null;
  months_with_data: number;
  window: { from: string; to: string };
} | { category: string; error: "category_not_found" | "category_ambiguous" };

export type AdvisorDeps = {
  runTool: AdvisorToolRunner;
  loadCategoryBaseline: (category: string, window: { from: string; to: string; n: number }) => Promise<CategoryBaseline>;
  today?: string;
};

export type AdvisorOutcome = {
  version: string;
  kind: "scenario" | "decision" | "goal_projection";
  ok: boolean;
  reply: string;
  tool_calls: AdvisorToolCall[];
  /** Structured, already-computed facts. The composer may cite only these. */
  facts: Record<string, unknown>;
  error: string | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function money(value: number): string {
  return BRL.format(Math.round(value * 100) / 100);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function monthYear(iso: string | null | undefined): string | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} de ${m[1]}`;
}

function todaySP(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Parses user-stated hypothetical money: "R$ 3.000", "500", "1,5 mil", "2 mil reais". */
export function parseHypotheticalAmount(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").toLowerCase().replace(/r\$\s*/g, "").replace(/reais?/g, "").trim();
  if (!text) return null;
  const m = text.match(/^(-)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k)?\b/);
  const alt = !m ? text.match(/^(-)?\s*(\d+)(?:[.,](\d+))?\s*(mil|k)\b/) : null;
  const match = m ?? alt;
  if (!match) return null;
  const integer = match[2].replace(/\./g, "");
  const decimals = match[3] ? `.${match[3]}` : "";
  let value = Number(`${integer}${decimals}`);
  if (!Number.isFinite(value)) return null;
  if (match[4]) value *= 1000;
  if (match[1]) value = -value;
  return round2(value);
}

/** Last N complete calendar months before `today`. */
export function lastCompleteMonthsWindow(today: string, n: number): { from: string; to: string; n: number } {
  const [y, m] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, 0));
  const start = new Date(Date.UTC(y, m - 1 - n, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), n };
}

async function call(
  deps: AdvisorDeps,
  calls: AdvisorToolCall[],
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result: any; error?: string | null }> {
  try {
    const out = await deps.runTool(tool, args);
    calls.push({ tool_name: tool, args, result: out.ok ? out.result : null, ok: out.ok, error: out.error ?? null });
    return out;
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 160);
    calls.push({ tool_name: tool, args, result: null, ok: false, error: message });
    return { ok: false, result: null, error: message };
  }
}

type GoalImpact = {
  goal: string;
  remaining: number;
  observed_pace_month: number;
  current_projected: string | null;
  new_monthly: number;
  new_projected: string | null;
  new_months: number | null;
};

async function goalImpact(
  deps: AdvisorDeps,
  calls: AdvisorToolCall[],
  goal: string | null,
  extraMonthly: number,
): Promise<GoalImpact | null> {
  if (!(extraMonthly > 0)) return null;
  const projection = await call(deps, calls, "project_goal_completion", goal ? { goal } : {});
  if (!projection.ok || !projection.result) return null;
  const p = projection.result;
  const remaining = Number(p.remaining ?? 0);
  if (!(remaining > 0)) return null;
  const observed = Math.max(0, Number(p.observed_pace_month ?? 0));
  const newMonthly = round2(observed + extraMonthly);
  const simulation = await call(deps, calls, "simulate_goal_pace", {
    ...(goal ? { goal } : { goal_id: p.goal_id }),
    monthly_contribution: newMonthly,
  });
  return {
    goal: String(p.name ?? goal ?? "sua meta"),
    remaining: round2(remaining),
    observed_pace_month: round2(observed),
    current_projected: p.projected_date ?? null,
    new_monthly: newMonthly,
    new_projected: simulation.ok ? simulation.result?.projected_date ?? null : null,
    new_months: simulation.ok && Number.isFinite(Number(simulation.result?.months))
      ? Math.ceil(Number(simulation.result.months))
      : null,
  };
}

function goalImpactLines(impact: GoalImpact | null): string[] {
  if (!impact) return [];
  const lines = [
    `Na meta ${impact.goal} (faltam ${money(impact.remaining)}), isso levaria o aporte para ${money(impact.new_monthly)} por mês.`,
  ];
  const next = monthYear(impact.new_projected);
  const current = monthYear(impact.current_projected);
  if (next && current) lines.push(`A conclusão estimada passaria de ${current} para ${next}.`);
  else if (next) lines.push(`Nesse ritmo, a conclusão estimada fica em ${next}.`);
  return lines;
}

async function executeScenario(
  deps: AdvisorDeps,
  params: AdvisoryParams | null | undefined,
): Promise<AdvisorOutcome> {
  const calls: AdvisorToolCall[] = [];
  const scenario = params?.scenario ?? null;
  const base = { version: ADVISOR_REASONING_VERSION, kind: "scenario" as const, tool_calls: calls };
  if (!scenario) {
    return { ...base, ok: false, reply: "Me conta qual mudança você quer simular — por exemplo, cortar um gasto ou guardar um valor por mês.", facts: {}, error: "scenario_missing" };
  }
  const amount = parseHypotheticalAmount(scenario.amount);
  const today = deps.today ?? todaySP();

  if (scenario.lever === "cut_category") {
    const category = String(scenario.category ?? "").trim();
    const window = lastCompleteMonthsWindow(today, 3);
    const baseline = await deps.loadCategoryBaseline(category, window);
    calls.push({ tool_name: "typical_monthly_expense", args: { category, ...window }, result: baseline, ok: !("error" in baseline) });
    if ("error" in baseline) {
      const reply = baseline.error === "category_ambiguous"
        ? `Encontrei mais de uma categoria parecida com "${category}". Qual delas você quer simular?`
        : `Não encontrei a categoria "${category}" nos seus lançamentos. Quer simular com outra?`;
      return { ...base, ok: false, reply, facts: { category }, error: baseline.error };
    }
    const typical = Number(baseline.typical_monthly ?? 0);
    if (!(typical > 0)) {
      return {
        ...base, ok: false,
        reply: `Nos últimos 3 meses completos não houve gasto em ${category}, então esse corte não mudaria seu mês.`,
        facts: { category, typical_monthly: 0, months_with_data: baseline.months_with_data }, error: "no_baseline",
      };
    }
    const saving = round2(scenario.percent != null
      ? typical * Math.min(100, Math.max(0, scenario.percent)) / 100
      : Math.min(Math.max(0, amount ?? 0), typical));
    if (!(saving > 0)) {
      return { ...base, ok: false, reply: `Quanto você quer cortar em ${category}? Pode ser um valor ou uma porcentagem.`, facts: { category }, error: "magnitude_missing" };
    }
    const impact = await goalImpact(deps, calls, scenario.goal, saving);
    const newTypical = round2(typical - saving);
    const facts = {
      lever: "cut_category", category, typical_monthly: round2(typical), months_with_data: baseline.months_with_data,
      percent: scenario.percent ?? null, monthly_saving: saving, annual_saving: round2(saving * 12),
      new_typical_monthly: newTypical, goal_impact: impact,
    };
    const lines = [
      `Hoje você gasta tipicamente ${money(typical)} por mês com ${category} (base: ${baseline.months_with_data} ${baseline.months_with_data === 1 ? "mês" : "meses"}).`,
      `Com esse corte, ficaria em ${money(newTypical)}: uma folga de ${money(saving)} por mês, ou ${money(saving * 12)} em 12 meses.`,
      ...goalImpactLines(impact),
    ];
    if (baseline.months_with_data < 2) lines.push("Ainda tenho pouco histórico nessa categoria, então trate como estimativa.");
    return { ...base, ok: true, reply: lines.join("\n"), facts, error: null };
  }

  if (scenario.lever === "extra_savings" || scenario.lever === "income_change") {
    if (amount == null || amount === 0) {
      return { ...base, ok: false, reply: "Qual valor por mês você quer considerar nessa simulação?", facts: {}, error: "magnitude_missing" };
    }
    const monthly = round2(amount);
    const impact = monthly > 0 ? await goalImpact(deps, calls, scenario.goal, monthly) : null;
    const facts = { lever: scenario.lever, monthly_delta: monthly, annual_delta: round2(monthly * 12), goal_impact: impact };
    const lines = scenario.lever === "extra_savings"
      ? [`Guardando ${money(monthly)} a mais por mês, em 12 meses você junta ${money(monthly * 12)}.`]
      : monthly >= 0
        ? [`Com ${money(monthly)} a mais de renda por mês, são ${money(monthly * 12)} a mais em 12 meses.`]
        : [`Uma perda de ${money(Math.abs(monthly))} por mês representa ${money(Math.abs(monthly) * 12)} a menos em 12 meses.`];
    lines.push(...goalImpactLines(impact));
    return { ...base, ok: true, reply: lines.join("\n"), facts, error: null };
  }

  // purchase
  if (amount == null || !(amount > 0)) {
    return { ...base, ok: false, reply: "Qual o valor da compra que você quer simular?", facts: {}, error: "magnitude_missing" };
  }
  const snapshot = await call(deps, calls, "get_financial_snapshot", {});
  if (!snapshot.ok || !snapshot.result) {
    return { ...base, ok: false, reply: `Uma compra de ${money(amount)}: não consegui carregar seu saldo agora para comparar. Tenta de novo em instantes?`, facts: { price: amount }, error: "snapshot_unavailable" };
  }
  const s = snapshot.result;
  const available = Number(s.available_today ?? 0);
  const projectedEnd = Number(s.projected_month_end_available ?? 0);
  const afterPurchase = round2(projectedEnd - amount);
  const facts = {
    lever: "purchase", price: amount, available_today: round2(available),
    projected_month_end_available: round2(projectedEnd), projected_after_purchase: afterPurchase,
  };
  const lines = [
    `A compra de ${money(amount)} comparada com hoje: você tem ${money(available)} disponível.`,
    `A projeção para o fim do mês é ${money(projectedEnd)}; com a compra à vista, ficaria em ${money(afterPurchase)}.`,
  ];
  if (afterPurchase < 0) lines.push("Ou seja, à vista ela deixaria o mês no negativo.");
  return { ...base, ok: true, reply: lines.join("\n"), facts, error: null };
}

async function executeDecision(
  deps: AdvisorDeps,
  contract: ConversationTurnContract,
): Promise<AdvisorOutcome> {
  const calls: AdvisorToolCall[] = [];
  const params = contract.advisory_params ?? null;
  const [snapshot, goal] = await Promise.all([
    call(deps, calls, "get_financial_snapshot", {}),
    call(deps, calls, "project_goal_completion", {}),
  ]);
  const scenario = params?.scenario ? await executeScenario(deps, params) : null;
  if (scenario) calls.push(...scenario.tool_calls);

  const s = snapshot.ok ? snapshot.result : null;
  const debts = Array.isArray(s?.active_debts) ? s.active_debts : [];
  const totalDebt = round2(debts.reduce((acc: number, d: any) => acc + Number(d.outstanding_balance ?? 0), 0));
  const biggest = [...debts].sort((a: any, b: any) => Number(b.outstanding_balance ?? 0) - Number(a.outstanding_balance ?? 0))[0] ?? null;
  const facts: Record<string, unknown> = {
    options: params?.options ?? [],
    available_today: s ? round2(Number(s.available_today ?? 0)) : null,
    projected_month_end_available: s ? round2(Number(s.projected_month_end_available ?? 0)) : null,
    cards_owed: s ? round2(Number(s.cards_owed ?? 0)) : null,
    invested: s ? round2(Number(s.net_worth_composition?.invested ?? 0)) : null,
    active_debts: debts.map((d: any) => ({
      name: d.name, outstanding_balance: round2(Number(d.outstanding_balance ?? 0)),
      installment_amount: d.installment_amount == null ? null : round2(Number(d.installment_amount)),
    })),
    total_debt: totalDebt,
    goal: goal.ok && goal.result ? {
      name: goal.result.name, remaining: goal.result.remaining,
      observed_pace_month: goal.result.observed_pace_month, projected_date: goal.result.projected_date,
    } : null,
    scenario: scenario?.facts ?? null,
  };

  const lines: string[] = [];
  if (s) {
    lines.push(`Seu quadro hoje: ${money(Number(s.available_today ?? 0))} disponível e projeção de ${money(Number(s.projected_month_end_available ?? 0))} no fim do mês.`);
    if (Number(s.cards_owed ?? 0) > 0) lines.push(`Fatura de cartão em aberto: ${money(Number(s.cards_owed))}.`);
    if (Number(s.net_worth_composition?.invested ?? 0) > 0) lines.push(`Investido: ${money(Number(s.net_worth_composition.invested))}.`);
  }
  if (debts.length) {
    lines.push(`Dívidas ativas: ${debts.length}, somando ${money(totalDebt)}${biggest ? `; a maior é ${biggest.name}, com ${money(Number(biggest.outstanding_balance ?? 0))}` : ""}.`);
  } else if (s) {
    lines.push("Não há dívidas ativas cadastradas.");
  }
  const g = facts.goal as any;
  if (g?.name && Number(g.remaining ?? 0) > 0) lines.push(`Meta ${g.name}: faltam ${money(Number(g.remaining))}.`);
  if (scenario?.ok) lines.push(scenario.reply);
  if (!lines.length) {
    return {
      version: ADVISOR_REASONING_VERSION, kind: "decision", ok: false, tool_calls: calls, facts,
      reply: "Não consegui carregar seus dados agora para pesar essa decisão com você. Tenta de novo em instantes?",
      error: "decision_evidence_unavailable",
    };
  }
  return { version: ADVISOR_REASONING_VERSION, kind: "decision", ok: true, reply: lines.join("\n"), tool_calls: calls, facts, error: null };
}

async function executeGoalProjection(
  deps: AdvisorDeps,
  contract: ConversationTurnContract,
): Promise<AdvisorOutcome> {
  const calls: AdvisorToolCall[] = [];
  const goal = contract.advisory_params?.goal ?? contract.focus.goal ?? null;
  const projection = await call(deps, calls, "project_goal_completion", goal ? { goal } : {});
  const base = { version: ADVISOR_REASONING_VERSION, kind: "goal_projection" as const, tool_calls: calls };
  if (!projection.ok || !projection.result) {
    const reply = projection.error === "goal_not_found"
      ? (goal ? `Não encontrei uma meta chamada "${goal}". Quer que eu liste suas metas?` : "Você ainda não tem uma meta ativa. Quer criar uma?")
      : "Não consegui calcular a projeção dessa meta agora. Tenta de novo em instantes?";
    return { ...base, ok: false, reply, facts: { goal }, error: String(projection.error ?? "projection_failed") };
  }
  const p = projection.result;
  const remaining = Number(p.remaining ?? 0);
  const observed = Number(p.observed_pace_month ?? 0);
  const required = p.required_pace_month == null ? null : Number(p.required_pace_month);
  const facts = {
    goal: p.name, current: p.current, target: p.target, remaining: p.remaining,
    observed_pace_month: p.observed_pace_month, required_pace_month: p.required_pace_month,
    projected_date: p.projected_date, days_ahead_or_late: p.days_ahead_or_late,
  };
  const lines: string[] = [];
  if (!(remaining > 0)) {
    lines.push(`A meta ${p.name} já está completa: ${money(Number(p.current ?? 0))} de ${money(Number(p.target ?? 0))}.`);
  } else {
    lines.push(`Meta ${p.name}: você tem ${money(Number(p.current ?? 0))} de ${money(Number(p.target ?? 0))}; faltam ${money(remaining)}.`);
    const when = monthYear(p.projected_date);
    if (observed > 0 && when) {
      lines.push(`No ritmo dos últimos 3 meses (${money(observed)} por mês), você chega lá por volta de ${when}.`);
      const late = Number(p.days_ahead_or_late ?? 0);
      if (p.days_ahead_or_late != null && late > 0) lines.push(`Isso fica depois do prazo que você definiu.`);
      else if (p.days_ahead_or_late != null && late < 0) lines.push(`Isso é antes do prazo que você definiu.`);
    } else {
      lines.push("Não houve aportes nos últimos 3 meses, então ainda não dá para projetar uma data pelo ritmo atual.");
    }
    if (required != null && required > 0) lines.push(`Para cumprir o prazo, o aporte necessário é de ${money(required)} por mês.`);
  }
  return { ...base, ok: true, reply: lines.join("\n"), facts, error: null };
}

export function isAdvisorReasoningKind(kind: string | null | undefined): kind is "scenario" | "decision" | "goal_projection" {
  return kind === "scenario" || kind === "decision" || kind === "goal_projection";
}

export async function executeAdvisorReasoning(
  contract: ConversationTurnContract,
  deps: AdvisorDeps,
): Promise<AdvisorOutcome | null> {
  if (contract.domain !== "advisory") return null;
  switch (contract.advisory_kind) {
    case "scenario":
      return await executeScenario(deps, contract.advisory_params);
    case "decision":
      return await executeDecision(deps, contract);
    case "goal_projection":
      return await executeGoalProjection(deps, contract);
    default:
      return null;
  }
}
