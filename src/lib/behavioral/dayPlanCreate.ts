import { behavioralDayAmount } from "@/lib/engine/facts";
import type { TransactionRow } from "@/lib/engine/facts";

// day_plan_create.v1 — sugestão do plano de um dia da semana (função pura).
// Convenção herdada do "combinado de sexta": plano na SEXTA vale o fim de semana (sex a dom); nos demais dias vale o dia.

const DAY_MS = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => fmt(parse(iso) + n * DAY_MS);
export const weekdayIndex = (iso: string) => new Date(parse(iso)).getUTCDay();

/** Quantos dias o plano cobre: sexta = fim de semana (3 dias); outros dias da semana = 1 dia. */
export function planSpanDays(weekday: number): number {
  return weekday === 5 ? 3 : 1;
}

/** Próxima data (hoje inclusive) em que cai o dia da semana escolhido (0 = domingo). */
export function nextOccurrence(today: string, weekday: number): string {
  const delta = (weekday - weekdayIndex(today) + 7) % 7;
  return addDaysIso(today, delta);
}

/** Corte máximo pedido de uma vez; acima disso o plano propõe um degrau no meio do caminho. */
export const MAX_DIRECT_CUT = 0.25;
/** Sem meta, a sugestão é uma redução pequena e testável sobre o padrão. */
export const NO_GOAL_CUT = 0.1;

export type PlanSuggestion = {
  typical: number;
  /** O que a meta permite neste dia (null sem meta ou sem dado para calcular). */
  goalRoom: number | null;
  target: number;
  /** Quanto o teto sugerido corta do padrão (0..1). */
  cutPct: number;
  kind: "goal_fits" | "goal_direct" | "goal_step" | "average_cut" | "no_history";
};

export function suggestTarget(input: { typical: number; goalRoom: number | null }): PlanSuggestion {
  const typical = Math.max(0, input.typical);
  const room = input.goalRoom == null ? null : Math.max(0, input.goalRoom);
  if (typical <= 0) return { typical: 0, goalRoom: room, target: room != null ? Math.round(room) : 0, cutPct: 0, kind: "no_history" };
  if (room == null) {
    const target = Math.round(typical * (1 - NO_GOAL_CUT));
    return { typical, goalRoom: null, target, cutPct: 1 - target / typical, kind: "average_cut" };
  }
  if (room >= typical) return { typical, goalRoom: room, target: Math.round(typical), cutPct: 0, kind: "goal_fits" };
  const cut = 1 - room / typical;
  if (cut <= MAX_DIRECT_CUT) return { typical, goalRoom: room, target: Math.round(room), cutPct: cut, kind: "goal_direct" };
  const step = Math.round(typical - (typical - room) / 2);
  return { typical, goalRoom: room, target: step, cutPct: 1 - step / typical, kind: "goal_step" };
}

type Tx = Pick<TransactionRow, "occurred_at" | "category_id" | "type" | "status" | "amount"> & Partial<TransactionRow>;

const expenseOn = (t: Tx) => behavioralDayAmount(t as TransactionRow, "expense");

/** Gasto da categoria no intervalo [from, to] (datas AAAA-MM-DD, datas de compra; parcela 2+ não conta). */
export function categorySpendBetween(txs: Tx[], categoryId: string, from: string, to: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.category_id !== categoryId) continue;
    const day = String(t.occurred_at).slice(0, 10);
    if (day < from || day > to) continue;
    total += expenseOn(t);
  }
  return Math.round(total * 100) / 100;
}

/** Média por ocorrência do dia (com o fim de semana inteiro na sexta) nas últimas `weeks` semanas, sem contar hoje. */
export function typicalForWeekday(txs: Tx[], categoryId: string, weekday: number, today: string, weeks = 8): number {
  const span = planSpanDays(weekday);
  let total = 0;
  let counted = 0;
  let cursor = addDaysIso(today, -1);
  while (weekdayIndex(cursor) !== weekday) cursor = addDaysIso(cursor, -1);
  for (let i = 0; i < weeks; i += 1) {
    const start = addDaysIso(cursor, -7 * i);
    const end = addDaysIso(start, span - 1);
    if (end >= today) continue; // ocorrência ainda em curso
    total += categorySpendBetween(txs, categoryId, start, end);
    counted += 1;
  }
  return counted > 0 ? Math.round((total / counted) * 100) / 100 : 0;
}

/** Ocorrências do dia (início do plano) entre hoje e o fim do período, inclusive. */
export function occurrencesLeft(today: string, periodEnd: string, weekday: number): number {
  let n = 0;
  for (let d = today; d <= periodEnd; d = addDaysIso(d, 1)) if (weekdayIndex(d) === weekday) n += 1;
  return n;
}

/**
 * O que a meta permite neste dia: o que ainda sobra do teto, menos o gasto esperado nos outros dias, dividido pelas
 * ocorrências que restam. Aproximação honesta: usa o ritmo dos últimos 56 dias nos outros dias.
 */
export function goalRoomPerOccurrence(input: {
  txs: Tx[]; categoryId: string; weekday: number; today: string; periodEnd: string; remainingAmount: number;
}): number | null {
  const { txs, categoryId, weekday, today, periodEnd, remainingAmount } = input;
  const span = planSpanDays(weekday);
  const left = occurrencesLeft(today, periodEnd, weekday);
  if (left <= 0) return null;
  const windowStart = addDaysIso(today, -56);
  const all = categorySpendBetween(txs, categoryId, windowStart, addDaysIso(today, -1));
  let onPlanDays = 0;
  let planDays = 0;
  for (let d = windowStart; d < today; d = addDaysIso(d, 1)) {
    if (weekdayIndex(d) !== weekday) continue;
    const end = addDaysIso(d, span - 1);
    onPlanDays += categorySpendBetween(txs, categoryId, d, end < today ? end : addDaysIso(today, -1));
    planDays += span;
  }
  const otherDays = 56 - planDays;
  const otherRate = otherDays > 0 ? Math.max(0, all - onPlanDays) / otherDays : 0;
  const remainingDays = Math.max(0, Math.round((parse(periodEnd) - parse(today)) / DAY_MS) + 1);
  const planDaysLeft = left * span;
  const expectedOther = otherRate * Math.max(0, remainingDays - planDaysLeft);
  return Math.max(0, Math.round(((remainingAmount - expectedOther) / left) * 100) / 100);
}

/** Gasto medido de um plano já terminado (dia, ou fim de semana na sexta). Null se ainda não terminou. */
export function measurePlanSpend(txs: Tx[], categoryId: string, planDate: string, today: string): number | null {
  const span = planSpanDays(weekdayIndex(planDate));
  const end = addDaysIso(planDate, span - 1);
  if (end >= today) return null;
  return categorySpendBetween(txs, categoryId, planDate, end);
}
