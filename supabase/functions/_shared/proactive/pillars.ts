// nino_comm_pillars.v1 — pilares de comunicação (função pura).
// A fila única por pontuação fazia o que é prazo (vencimento, caixa) ganhar sempre do que é prevenção (o dia em que
// a pessoa costuma gastar mais). Aqui cada tipo de comunicação pertence a um pilar, e cada pilar tem uma vaga
// reservada que só existe quando há algo elegível e material para dizer (vaga sem item não bloqueia ninguém).
// Documento: docs/NINO_PILARES_COMUNICACAO_REFINAMENTO_TECNICO.md
import type { FinancialSituation } from "./contracts.ts";
import type { RecentDelivery } from "./repetition.ts";

export const COMM_PILLARS_VERSION = "nino_comm_pillars.v1";

export type Pillar = "proteger" | "antecipar" | "metas" | "organizacao";
export const PILLARS: readonly Pillar[] = ["proteger", "antecipar", "metas", "organizacao"];

const PROTEGER = [
  "bill_due_reminder", "card_bill_pressure", "card_closing_soon", "debt_due_soon", "debt_installment_due",
  "debt_overdue", "forgotten_bill", "cash_flow_imbalance", "upcoming_cash_pressure",
  "recurring_commitment_pressure", "expected_recurring_payment",
];
const ANTECIPAR = [
  "weekday_spending_risk", "weekend_spending_risk", "spending_goal_weekend", "month_phase_spending_risk",
  "card_cycle_acceleration", "small_spend_acceleration", "spending_pace_change", "spending_spike",
  "emotional_spending", "impulsive_spending", "relapse_risk", "growing_category", "benefit_projection",
];
const METAS = [
  "spending_goal_pressure", "spending_goal_threshold", "spending_goal_weekly", "spending_goal_monthly",
  "spending_goal_zero_charge", "goal_at_risk", "goal_feasibility", "goal_progress", "debt_progress",
  "performance_improvement", "performance_deterioration", "financial_discipline", "saving_opportunity",
  "underused_subscription", "wealth_building_action", "investment_drawdown", "change_progress",
  "change_reframe", "recommendation_changed",
];
// Organização é o destino de qualquer tipo desconhecido: nunca fura a fila por engano.
const ORGANIZACAO = [
  "categorize_transaction", "data_quality", "duplicate_expense", "feature_discovery", "mid_month_checkin",
  "advisor_review_weekly", "advisor_review_monthly", "behavioral_reassessment_due", "emotional_checkin_due",
  "engagement_drop", "recurring_pattern", "split_payment_pending", "concentration_risk", "financial_procrastination",
];

const BY_KIND = new Map<string, Pillar>([
  ...PROTEGER.map((k) => [k, "proteger"] as const),
  ...ANTECIPAR.map((k) => [k, "antecipar"] as const),
  ...METAS.map((k) => [k, "metas"] as const),
  ...ORGANIZACAO.map((k) => [k, "organizacao"] as const),
]);

export function pillarOf(kind: string): Pillar {
  return BY_KIND.get(kind) ?? "organizacao";
}

/** Teto padrão do produto: mensagens de WhatsApp por dia (as críticas podem passar). */
export const WHATSAPP_DAILY_CAP = 5;

export type PillarPeriod = "day" | "week";
export type PillarRule = {
  /** Vaga reservada: enquanto não foi usada no período, o pilar passa na frente (se houver item elegível). */
  reserve?: { period: PillarPeriod; count: number };
  /** Máximo no WhatsApp por período. */
  max?: { period: PillarPeriod; count: number };
};

/** Cotas iniciais; calibradas pelo replay antes de ligar para qualquer pessoa. */
export const PILLAR_RULES: Record<Pillar, PillarRule> = {
  proteger: {},
  antecipar: { reserve: { period: "day", count: 1 }, max: { period: "day", count: 1 } },
  metas: { reserve: { period: "week", count: 1 }, max: { period: "week", count: 3 } },
  organizacao: { max: { period: "week", count: 2 } },
};

export type PillarUsage = {
  /** Mensagens de WhatsApp enviadas no dia local (todas, de qualquer pilar). */
  whatsappToday: number;
  today: Record<Pillar, number>;
  week: Record<Pillar, number>;
};

const emptyCounts = (): Record<Pillar, number> => ({ proteger: 0, antecipar: 0, metas: 0, organizacao: 0 });

export function emptyUsage(): PillarUsage {
  return { whatsappToday: 0, today: emptyCounts(), week: emptyCounts() };
}

const SP = "America/Sao_Paulo";
const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: SP, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Quanto cada pilar já falou no WhatsApp hoje (dia de São Paulo) e nos últimos 7 dias. */
export function usageFromDeliveries(recent: RecentDelivery[], now: Date): PillarUsage {
  const usage = emptyUsage();
  const today = localDay(now);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  for (const row of recent) {
    if (row.channel !== "whatsapp") continue;
    const at = Date.parse(row.delivered_at);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const pillar = pillarOf(row.kind);
    if (at >= weekAgo) usage.week[pillar] += 1;
    if (localDay(new Date(at)) === today) {
      usage.today[pillar] += 1;
      usage.whatsappToday += 1;
    }
  }
  return usage;
}

/**
 * Só o pilar Proteger fura teto e cota (atraso, risco crítico e vencimento em até 3 dias): risco de prazo e de caixa
 * não se negocia. "Crítico" fora do Proteger NÃO fura: a conta dona mostrou severidade inflada (meta com impacto de
 * R$ 26 marcada como crítica), e deixar isso furar a fila reproduziria o problema que os pilares existem para resolver.
 */
export function bypassesCap(situation: Pick<FinancialSituation, "severity" | "days_until" | "communication_kind">): boolean {
  if (pillarOf(situation.communication_kind) !== "proteger") return false;
  if (situation.severity === "critical") return true;
  if (situation.communication_kind === "debt_overdue") return true;
  return situation.days_until != null && situation.days_until <= 3;
}

function reserveUnmet(pillar: Pillar, usage: PillarUsage): boolean {
  const reserve = PILLAR_RULES[pillar].reserve;
  if (!reserve) return false;
  const used = reserve.period === "day" ? usage.today[pillar] : usage.week[pillar];
  return used < reserve.count;
}

/** 0 = fura a fila; 1 = pilar com vaga reservada ainda não usada; 2 = disputa por pontuação. */
export function pillarTier(situation: FinancialSituation, usage: PillarUsage): 0 | 1 | 2 {
  if (bypassesCap(situation)) return 0;
  return reserveUnmet(pillarOf(situation.communication_kind), usage) ? 1 : 2;
}

/** Ordena preservando a ordem de pontuação dentro de cada faixa (ordenação estável). */
export function orderByPillars(ranked: FinancialSituation[], usage: PillarUsage): FinancialSituation[] {
  return ranked
    .map((situation, index) => ({ situation, index, tier: pillarTier(situation, usage) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((row) => row.situation);
}

export type PillarRound = { total: number; byPillar: Record<Pillar, number> };
export const newPillarRound = (): PillarRound => ({ total: 0, byPillar: emptyCounts() });

/** Motivo de retenção do WhatsApp por teto diário ou cota do pilar; null = pode falar. */
export function pillarGate(situation: FinancialSituation, usage: PillarUsage, round: PillarRound): string | null {
  if (bypassesCap(situation)) return null;
  if (usage.whatsappToday + round.total >= WHATSAPP_DAILY_CAP) return "daily_cap_reached";
  const pillar = pillarOf(situation.communication_kind);
  const max = PILLAR_RULES[pillar].max;
  if (max) {
    const used = (max.period === "day" ? usage.today[pillar] : usage.week[pillar]) + round.byPillar[pillar];
    if (used >= max.count) return `pillar_quota_reached:${pillar}`;
  }
  return null;
}

export function recordPillarPick(round: PillarRound, situation: FinancialSituation): void {
  round.total += 1;
  round.byPillar[pillarOf(situation.communication_kind)] += 1;
}
