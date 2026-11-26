// Escolha determinística do insight e da ação (sem IA): candidatos por regra, ordem de prioridade fixa
// e desempate por severidade, prazo, impacto absoluto, evidência e ID. Frases vêm de uma biblioteca fechada.
import { clamp, fill } from "./format.ts";
import { TEXT_LIMITS, type InsightKind, type SummaryAction, type SummaryInsight, type Tone } from "./types.ts";

export const PRIORITY: InsightKind[] = [
  "cash_risk", "data_quality", "commitment_pressure", "consumption_change",
  "goal_risk", "sustained_improvement", "opportunity", "neutral",
];

/** Limiares versionados (a aprovar). */
export const SUMMARY_THRESHOLDS = {
  /** Mudança material de consumo: |Δ| ≥ 15% e ≥ R$ 50. */
  materialPct: 0.15,
  materialCents: 5000,
  /** Compromissos do próximo mês ≥ 50% da renda mensal. */
  commitmentPressurePct: 0.5,
  /** Meta em risco: ≥ 85% do limite com dias pela frente. */
  goalRiskPct: 0.85,
  /** Parte sem categoria que torna os números incompletos. */
  uncategorizedShare: 0.2,
} as const;

export const PHRASES = {
  cash_risk: {
    title: "Seu saldo pode ficar negativo em {date}",
    body: "O saldo projetado chega a {min} em {date}, antes da próxima entrada prevista. Segure o que puder esperar.",
    action: "Reserve {amount} até {date}",
    actionBody: "É o valor que falta para cobrir os vencimentos até a próxima entrada.",
  },
  data_quality: {
    title: "Alguns números deste resumo estão incompletos",
    body: "{reason} Os valores podem mudar quando os dados forem atualizados.",
    action: "Atualize seus lançamentos no app",
    actionBody: "Assim o próximo resumo sai completo.",
  },
  commitment_pressure: {
    title: "Vencimentos de {month} pedem {pct} da sua renda",
    body: "Os compromissos de {month} somam {amount}, o equivalente a {pct} da renda mensal informada.",
    action: "Separe {amount} para os vencimentos de {month}",
    actionBody: "Separar agora evita que o gasto do dia a dia ocupe esse espaço.",
  },
  commitment_week: {
    title: "{amount} vencem nos próximos 7 dias",
    body: "São {count} vencimentos até {date}. O maior é {top} ({topAmount}).",
    action: "Confira se o saldo cobre {amount} até {date}",
    actionBody: "São os vencimentos já conhecidos da próxima semana.",
  },
  consumption_up: {
    title: "Você gastou {delta} a mais que {ref}",
    body: "O consumo foi {total}, contra {refTotal}. A maior alta veio de {cat} ({catDelta}).",
    action: "Revise os gastos com {cat}",
    actionBody: "Foi a categoria que mais subiu no período.",
  },
  consumption_up_nocat: {
    title: "Você gastou {delta} a mais que {ref}",
    body: "O consumo foi {total}, contra {refTotal}.",
    action: "Revise os maiores gastos do período no app",
    actionBody: "Comece pelos lançamentos de maior valor.",
  },
  consumption_down: {
    title: "Você gastou {delta} a menos que {ref}",
    body: "O consumo foi {total}, contra {refTotal}. Uma semana só ainda não indica tendência.",
    action: "Mantenha o ritmo na próxima semana",
    actionBody: "Se a queda se repetir, ela vira tendência.",
  },
  goal_risk: {
    title: "A meta de {cat} está em {pct} do limite",
    body: "Faltam {days} dias para o fim do mês e já foram usados {pct} do limite de {cat}.",
    action: "Acompanhe a meta de {cat} até o fim do mês",
    actionBody: "Gastos novos nessa categoria contam direto no limite.",
  },
  goal_over: {
    title: "A meta de {cat} fechou o mês em {pct} do limite",
    body: "O gasto com {cat} passou do limite combinado em {month}. Vale rever o limite ou o que puxou o gasto.",
    action: "Revise o limite de {cat} para {next}",
    actionBody: "Ajuste o valor no app ou veja os lançamentos que mais pesaram.",
  },
  improvement: {
    title: "Seu consumo caiu pelo segundo período seguido",
    body: "{detail} A queda aparece tanto na semana quanto no mês até aqui.",
    action: "Mantenha o ritmo e registre os gastos",
    actionBody: "A comparação fica mais confiável com tudo registrado.",
  },
  improvement_month: {
    title: "Resultado do mês melhorou {delta}",
    body: "O resultado foi {result}, contra {ref} no mês anterior. {detail}",
    action: "Decida para onde vai a sobra de {month}",
    actionBody: "Defina no app se o valor vai para uma meta ou para a reserva.",
  },
  opportunity: {
    title: "{title}",
    body: "{body}",
    action: "{title}",
    actionBody: "O gasto recente está acima do seu padrão. Veja no app os lançamentos que puxaram o valor.",
  },
  neutral_week: {
    title: "Semana sem mudanças relevantes",
    body: "O consumo foi {total}, perto do mesmo período anterior ({refTotal}).",
    action: "Continue registrando seus gastos",
    actionBody: "Quanto mais completo, mais preciso fica o próximo resumo.",
  },
  neutral_month: {
    title: "Mês sem mudanças relevantes",
    body: "Receitas de {income} e consumo de {consumption}, perto do mês anterior.",
    action: "Continue registrando seus gastos",
    actionBody: "Quanto mais completo, mais preciso fica o próximo resumo.",
  },
  no_data: {
    title: "Nenhum lançamento registrado no período",
    body: "Não há lançamentos entre {start} e {end}. Se houve gastos, eles ainda não chegaram ao Nino.",
    action: "Registre ou importe seus lançamentos",
    actionBody: "Pelo WhatsApp ou pelo app, em poucos segundos.",
  },
} as const;

export type PhraseKey = keyof typeof PHRASES;

export interface Candidate {
  kind: InsightKind;
  phrase: PhraseKey;
  vars: Record<string, string | number>;
  tone: Tone;
  /** 0 baixa … 3 crítica. */
  severity: number;
  /** Data limite (ISO) — mais cedo vence. */
  deadline: string | null;
  impactCents: number;
  /** Força da evidência (0..1). */
  evidence: number;
  id: string;
}

export function rank(a: Candidate, b: Candidate): number {
  const pa = PRIORITY.indexOf(a.kind); const pb = PRIORITY.indexOf(b.kind);
  if (pa !== pb) return pa - pb;
  if (a.severity !== b.severity) return b.severity - a.severity;
  const da = a.deadline ?? "9999-12-31"; const db = b.deadline ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (Math.abs(a.impactCents) !== Math.abs(b.impactCents)) return Math.abs(b.impactCents) - Math.abs(a.impactCents);
  if (a.evidence !== b.evidence) return b.evidence - a.evidence;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function choose(cands: Candidate[], fallback: Candidate): { insight: SummaryInsight; action: SummaryAction; chosen: Candidate } {
  const chosen = [...cands].sort(rank)[0] ?? fallback;
  const p = PHRASES[chosen.phrase];
  return {
    chosen,
    insight: { kind: chosen.kind, rule_id: chosen.id, title: clamp(fill(p.title, chosen.vars), TEXT_LIMITS.title), body: clamp(fill(p.body, chosen.vars), TEXT_LIMITS.insight), tone: chosen.tone },
    action: { rule_id: chosen.id, title: clamp(fill(p.action, chosen.vars), 65), body: clamp(fill(p.actionBody, chosen.vars), TEXT_LIMITS.action) },
  };
}
