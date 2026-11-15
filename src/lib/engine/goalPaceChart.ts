// Gráfico "Como a meta fecha" dos tetos de categoria (puro, só para a interface; não é espelhado no servidor).
// A série diária usa EXATAMENTE as mesmas regras de `evaluateCategoryGoal` para decidir o que entra no gasto da meta
// (categoria efetiva com estornos, competência, movimento real, parcelas antigas fora). Um teste garante que a soma
// da série é igual a `actualSpend`, para o desenho nunca contradizer o número do card.
import {
  behavioralMetricAmount, buildCarriedInstallmentIds, buildRefundAttribution, effectiveCategoryId, isRealMonthlyMovement,
  reportingCompetenceDate, round2, type TransactionRow,
} from "./facts";
import { resolveGoalPeriod, type CategoryGoalEvaluation, type CategorySpendingGoalRow } from "./metrics";

const DAY_MS = 86_400_000;
const utcNoon = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
/** Posição do dia dentro do período: 1 = primeiro dia. */
const dayIndex = (startIso: string, iso: string) => Math.round((utcNoon(iso) - utcNoon(startIso)) / DAY_MS) + 1;

export interface DailySpend { day: number; date: string; amount: number }

/** Gasto líquido da meta por dia do período (estornos abatem no dia em que caem). A soma, limitada a 0, é o `actualSpend`. */
export function categoryGoalDailySpend(goal: CategorySpendingGoalRow, txs: TransactionRow[], today: Date): { days: DailySpend[]; total: number } {
  const period = resolveGoalPeriod(goal, today);
  const totalDays = Math.max(1, dayIndex(period.start, period.end));
  const amounts = new Array<number>(totalDays).fill(0);
  const attribution = buildRefundAttribution(txs);
  const carried = buildCarriedInstallmentIds(txs);
  for (const t of txs) {
    if (effectiveCategoryId(t, attribution) !== goal.category_id) continue;
    const date = reportingCompetenceDate(t);
    if (date < period.start || date > period.end) continue;
    const i = dayIndex(period.start, date) - 1;
    if (i < 0 || i >= totalDays) continue;
    const credit = behavioralMetricAmount(t, "expense");
    if (String(t.movement_kind ?? "") === "refund") {
      if (credit === 0) continue;
      amounts[i] += credit;
      continue;
    }
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    if (carried.has(t.id)) continue;
    amounts[i] += Number(t.amount || 0);
  }
  const days = amounts.map((a, k) => ({ day: k + 1, date: new Date(utcNoon(period.start) + k * DAY_MS).toISOString().slice(0, 10), amount: round2(a) }));
  return { days, total: round2(Math.max(0, days.reduce((s, d) => s + d.amount, 0))) };
}

export type PaceScenarioKind = "calmer" | "pace" | "limit";
export interface PaceScenario {
  kind: PaceScenarioKind;
  /** R$ por dia nos dias que restam. */
  rate: number;
  /** Onde a meta fecha gastando esse valor por dia. */
  final: number;
  /** teto − final: positivo = folga, negativo = acima do teto. */
  diff: number;
}

export interface GoalPaceModel {
  periodStart: string;
  periodEnd: string;
  todayIso: string;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  target: number;
  actual: number;
  projected: number;
  range: { low: number; high: number } | null;
  /** Acumulado ao fim de cada dia já decorrido (começa em 0, no dia 0). */
  cumulative: Array<{ day: number; value: number }>;
  /** Teto do período distribuído por igual: o "como deveria estar" vai de 0 ao teto no último dia. */
  idealAt: (day: number) => number;
  tiles: { pace: number; allowance: number | null; slack: number };
  scenarios: PaceScenario[];
  defaultScenario: number;
}

const INACTIVE = new Set(["scheduled", "paused", "cancelled", "completed_ok", "completed_over"]);

/** Pode mostrar o gráfico? Só em meta ativa, de consumo contínuo (R$/dia faz sentido) e já iniciada. */
export function goalPaceApplies(ev: CategoryGoalEvaluation): boolean {
  return !INACTIVE.has(ev.status) && ev.supportsDailyBudget && ev.elapsedDays >= 1 && ev.targetAmount > 0;
}

/** Meta ativa de categoria "em degraus" (aluguel, assinatura): sem linha reta de "como deveria estar". */
export function goalPaceIsStepped(ev: CategoryGoalEvaluation): boolean {
  return !INACTIVE.has(ev.status) && !ev.supportsDailyBudget && ev.targetAmount > 0;
}

export function goalPaceModel(ev: CategoryGoalEvaluation, txs: TransactionRow[], today: Date): GoalPaceModel | null {
  if (!goalPaceApplies(ev)) return null;
  const { days } = categoryGoalDailySpend(ev.goal, txs, today);
  const elapsed = Math.min(ev.totalDays, ev.elapsedDays);
  const cumulative: GoalPaceModel["cumulative"] = [{ day: 0, value: 0 }];
  let run = 0;
  for (let k = 0; k < elapsed; k++) {
    run += days[k]?.amount ?? 0;
    cumulative.push({ day: k + 1, value: Math.max(0, round2(run)) });
  }
  // O último ponto é sempre o gasto oficial da meta (mesma conta do card).
  cumulative[cumulative.length - 1] = { day: elapsed, value: ev.actualSpend };

  const target = ev.targetAmount;
  const projected = Math.max(ev.actualSpend, ev.projectedFinalSpend);
  const remaining = ev.remainingDays;
  const pace = remaining > 0 ? Math.max(0, round2((projected - ev.actualSpend) / remaining)) : 0;
  const allowance = ev.dailyAllowance > 0 ? ev.dailyAllowance : null;

  const scenarios: PaceScenario[] = [];
  if (remaining > 0 && allowance != null) {
    const raw: Array<{ kind: PaceScenarioKind; rate: number }> = [
      { kind: "calmer", rate: round2(pace * 0.75) }, { kind: "pace", rate: pace }, { kind: "limit", rate: allowance },
    ];
    const kept: typeof raw = [];
    for (const r of [...raw].sort((a, b) => a.rate - b.rate)) {
      if (kept.length && Math.abs(kept[kept.length - 1].rate - r.rate) < 0.01) {
        if (r.kind === "pace") kept[kept.length - 1] = r; // em empate, o rótulo "ritmo" tem prioridade
        continue;
      }
      kept.push(r);
    }
    if (kept.length >= 2) {
      for (const r of kept) {
        // O cenário do ritmo é a projeção do card e o do limite é o teto, por definição: nada de centavos de arredondamento a mais.
        const final = r.kind === "pace" ? round2(projected) : r.kind === "limit" ? round2(target) : round2(ev.actualSpend + r.rate * remaining);
        scenarios.push({ kind: r.kind, rate: r.rate, final, diff: round2(target - final) });
      }
    }
  }
  const paceIdx = scenarios.findIndex((s) => s.kind === "pace");
  const defaultScenario = paceIdx >= 0
    ? paceIdx
    : scenarios.reduce((best, s, i, arr) => (Math.abs(s.rate - pace) < Math.abs(arr[best].rate - pace) ? i : best), 0);

  return {
    periodStart: ev.period.start,
    periodEnd: ev.period.end,
    todayIso: ev.calculationReferenceDate,
    totalDays: ev.totalDays,
    elapsedDays: elapsed,
    remainingDays: remaining,
    target,
    actual: ev.actualSpend,
    projected,
    range: ev.projection.range ?? null,
    cumulative,
    idealAt: (day) => round2((Math.min(Math.max(day, 0), ev.totalDays) / ev.totalDays) * target),
    tiles: { pace, allowance, slack: round2(target - projected) },
    scenarios,
    defaultScenario,
  };
}
