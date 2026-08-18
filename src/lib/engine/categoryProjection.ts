/**
 * Política determinística de projeção por natureza da categoria
 * (`category_projection.v1`).
 *
 * Problema que este motor resolve: projetar TODA categoria por regra de três
 * diária ("gastei R$ 715 em 18 dias, logo fecho em R$ 1.232") é honesto para
 * consumo contínuo (transporte, alimentação) e sem sentido para compromissos
 * discretos (assinaturas, aluguel, academia, seguros), onde o que falta não é
 * "mais dias de ritmo", e sim cobranças conhecidas que ainda caem no período.
 *
 * Regras:
 * - `flow`        → ritmo observado × dias restantes (R$/dia faz sentido).
 * - `commitment`  → gasto confirmado + cobranças recorrentes ainda esperadas.
 * - `hybrid`      → recorrentes conhecidos + projeção só da parcela variável.
 * - `insufficient_data` → sem projeção afirmativa.
 *
 * A classificação sai de evidência do ledger (séries mensais estáveis por
 * estabelecimento canônico, origem `recurring`, frequência de dias com gasto),
 * nunca de lista fixa de nomes de categoria. Nada aqui é estimado por IA.
 */

import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  type TransactionRow,
} from "./facts";
import { buildMerchantResolver, type MerchantAliasRow, type MerchantResolver } from "./merchant";

export const CATEGORY_PROJECTION_VERSION = "category_projection.v1";

export type CategoryProjectionMethod = "flow" | "commitment" | "hybrid" | "insufficient_data";
export type CategoryProjectionConfidence = "high" | "medium" | "low";

export interface CategoryProjectionComponents {
  /** Gasto já confirmado no período (líquido de estorno). */
  confirmedSpend: number;
  /** Cobranças recorrentes conhecidas que ainda caem no período. */
  remainingKnownCommitments: number;
  /** Parcela variável projetada pelo ritmo observado. */
  variableProjection: number;
  /** Soma exata dos componentes acima. */
  projectedTotal: number;
}

export interface ExpectedCommitment {
  label: string;
  amount: number;
  /** Data esperada da cobrança (YYYY-MM-DD). */
  expectedAt: string;
}

export interface RecurringSeriesInCategory {
  label: string;
  typicalAmount: number;
  /** Dia do mês típico da cobrança. */
  expectedDayOfMonth: number;
  occurrences: number;
  /** Já foi cobrada dentro do período avaliado. */
  chargedInPeriod: boolean;
  chargedAmount: number;
}

export interface CategoryProjection {
  formula_version: typeof CATEGORY_PROJECTION_VERSION;
  method: CategoryProjectionMethod;
  confidence: CategoryProjectionConfidence;
  components: CategoryProjectionComponents;
  expectedCommitments: ExpectedCommitment[];
  series: RecurringSeriesInCategory[];
  /** Fração (0..1) do gasto do período explicada por séries recorrentes. */
  recurringShareOfSpend: number;
  /** Dias distintos com gasto na categoria dentro do período. */
  spendDaysInPeriod: number;
  /** Ritmo diário da parcela variável (0 quando não há parcela variável). */
  variableDailyRate: number;
  /** R$/dia e "corte por dia" só fazem sentido quando true. */
  supportsDailyBudget: boolean;
}

export interface CategoryProjectionInput {
  txs: TransactionRow[];
  categoryId: string;
  period: { start: string; end: string };
  /** Gasto confirmado do período, já calculado pela avaliação da meta. */
  confirmedSpend: number;
  elapsedDays: number;
  remainingDays: number;
  todayIso: string;
  aliases?: MerchantAliasRow[];
  resolver?: MerchantResolver;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function shiftMonthStart(iso: string, delta: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function daysInMonthOf(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateInPeriodMonth(period: { start: string; end: string }, dayOfMonth: number): string {
  const base = period.end.slice(0, 7);
  const maxDay = daysInMonthOf(period.end);
  const day = Math.min(Math.max(1, dayOfMonth), maxDay);
  return `${base}-${String(day).padStart(2, "0")}`;
}

/** Intervalos em dias entre datas ordenadas. */
function intervalsOf(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const a = Date.parse(`${dates[i - 1]}T12:00:00Z`);
    const b = Date.parse(`${dates[i]}T12:00:00Z`);
    out.push(Math.round((b - a) / 86_400_000));
  }
  return out;
}

/**
 * Decide COMO projetar o fechamento de uma categoria e devolve o cálculo já
 * decomposto e auditável. `projectedTotal` sempre reconcilia exatamente com a
 * soma dos componentes e nunca é menor que o gasto já confirmado.
 */
export function computeCategoryProjection(input: CategoryProjectionInput): CategoryProjection {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const attribution = buildRefundAttribution(input.txs);
  const confirmedSpend = round2(Math.max(0, input.confirmedSpend));
  const lookbackStart = shiftMonthStart(input.period.start, -6);

  type Entry = { date: string; amount: number; recurringOrigin: boolean };
  const groups = new Map<string, { label: string; entries: Entry[] }>();
  const spendDays = new Set<string>();

  for (const tx of input.txs) {
    if (String((tx as { status?: string | null }).status ?? "confirmed") !== "confirmed") continue;
    if (effectiveCategoryId(tx, attribution) !== input.categoryId) continue;
    const date = String(tx.occurred_at ?? "").slice(0, 10);
    if (!date || date < lookbackStart || date > input.period.end) continue;
    if (String((tx as { movement_kind?: string | null }).movement_kind ?? "") === "refund") continue;
    if (tx.type !== "expense" || !isRealMonthlyMovement(tx)) continue;
    const amount = round2(Number(tx.amount || 0));
    if (!(amount > 0)) continue;

    if (date >= input.period.start && date <= input.period.end) spendDays.add(date);

    const source = (tx as { merchant_name?: string | null }).merchant_name
      ?? (tx as { description?: string | null }).description
      ?? null;
    const resolution = resolver.resolve(source);
    const key = resolution?.key ?? `raw:${String(source ?? "sem_descricao").trim().toLowerCase()}`;
    const label = resolution?.label ?? (String(source ?? "").trim() || "Sem descrição");
    const group = groups.get(key) ?? { label, entries: [] };
    group.entries.push({
      date,
      amount,
      recurringOrigin: String((tx as { origin?: string | null }).origin ?? "") === "recurring",
    });
    groups.set(key, group);
  }

  const series: RecurringSeriesInCategory[] = [];
  const expectedCommitments: ExpectedCommitment[] = [];
  let chargedRecurringInPeriod = 0;

  for (const group of groups.values()) {
    const entries = [...group.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const beforePeriod = entries.filter((e) => e.date < input.period.start);

    // Presença mensal é o sinal de série; valor por mês pode variar
    // (assinatura por consumo cobra várias vezes no mesmo ciclo).
    const monthlyTotals = new Map<string, { amount: number; count: number }>();
    for (const entry of beforePeriod) {
      const ym = entry.date.slice(0, 7);
      const bucket = monthlyTotals.get(ym) ?? { amount: 0, count: 0 };
      bucket.amount += entry.amount;
      bucket.count += 1;
      monthlyTotals.set(ym, bucket);
    }
    const declaredRecurring = beforePeriod.some((e) => e.recurringOrigin);
    const monthsPresent = monthlyTotals.size;
    if (!declaredRecurring && monthsPresent < 2) continue;

    const typical = round2(median([...monthlyTotals.values()].map((b) => b.amount)));
    if (!(typical > 0)) continue;
    const expectedDay = Math.round(median(beforePeriod.map((e) => Number(e.date.slice(8, 10))))) || 1;

    const inPeriod = entries.filter((e) => e.date >= input.period.start && e.date <= input.period.end);
    const chargedAmount = round2(inPeriod.reduce((sum, e) => sum + e.amount, 0));

    series.push({
      label: group.label,
      typicalAmount: typical,
      expectedDayOfMonth: expectedDay,
      occurrences: monthsPresent,
      chargedInPeriod: inPeriod.length > 0,
      chargedAmount,
    });

    // Já cobrada no ciclo: não se espera nova cobrança da mesma série.
    if (inPeriod.length > 0) {
      chargedRecurringInPeriod = round2(chargedRecurringInPeriod + chargedAmount);
      continue;
    }
    const expectedAt = dateInPeriodMonth(input.period, expectedDay);
    if (expectedAt >= input.todayIso && expectedAt <= input.period.end) {
      expectedCommitments.push({ label: group.label, amount: typical, expectedAt });
    }
  }

  expectedCommitments.sort((a, b) => (a.expectedAt < b.expectedAt ? -1 : 1));
  const remainingKnownCommitments = round2(expectedCommitments.reduce((sum, item) => sum + item.amount, 0));

  const variableSpend = round2(Math.max(0, confirmedSpend - chargedRecurringInPeriod));
  const recurringShareOfSpend = confirmedSpend > 0
    ? Math.round((chargedRecurringInPeriod / confirmedSpend) * 10_000) / 10_000
    : 0;
  const spendDaysInPeriod = spendDays.size;
  const elapsed = Math.max(0, input.elapsedDays);
  const remaining = Math.max(0, input.remainingDays);

  const hasSeries = series.length > 0;

  /**
   * A natureza da categoria sai da FREQUÊNCIA de gasto no período: consumo
   * contínuo aparece na maioria dos dias; compromisso aparece em poucos dias
   * do ciclo. Extrapolar ritmo diário só é honesto no primeiro caso.
   */
  const spendDayRatio = elapsed > 0 ? spendDaysInPeriod / elapsed : 0;

  let method: CategoryProjectionMethod;
  if (elapsed === 0 || (confirmedSpend === 0 && !hasSeries)) {
    method = "insufficient_data";
  } else if (spendDayRatio <= 0.25) {
    method = "commitment";
  } else if (spendDayRatio >= 0.5 && recurringShareOfSpend < 0.5) {
    method = "flow";
  } else {
    method = "hybrid";
  }

  let variableProjection = 0;
  let commitmentsInProjection = 0;
  let variableDailyRate = 0;

  if (method === "commitment") {
    commitmentsInProjection = remainingKnownCommitments;
  } else if (method === "hybrid") {
    commitmentsInProjection = remainingKnownCommitments;
    variableDailyRate = elapsed > 0 ? variableSpend / elapsed : 0;
    variableProjection = round2(variableDailyRate * remaining);
  } else if (method === "flow") {
    // O ritmo observado já embute qualquer cobrança recorrente da categoria:
    // somar compromissos aqui contaria o mesmo dinheiro duas vezes.
    variableDailyRate = elapsed > 0 ? confirmedSpend / elapsed : 0;
    variableProjection = round2(variableDailyRate * remaining);
  } else {
    commitmentsInProjection = remainingKnownCommitments;
  }

  const projectedTotal = round2(confirmedSpend + commitmentsInProjection + variableProjection);

  let confidence: CategoryProjectionConfidence;
  if (method === "insufficient_data") {
    confidence = "low";
  } else if (method === "commitment") {
    confidence = series.some((s) => s.occurrences >= 3) ? "high" : "medium";
  } else if (elapsed >= 10 && spendDaysInPeriod >= 5) {
    confidence = "high";
  } else if (elapsed >= 5 && spendDaysInPeriod >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    formula_version: CATEGORY_PROJECTION_VERSION,
    method,
    confidence,
    components: {
      confirmedSpend,
      remainingKnownCommitments: round2(commitmentsInProjection),
      variableProjection,
      projectedTotal,
    },
    expectedCommitments,
    series,
    recurringShareOfSpend,
    spendDaysInPeriod,
    variableDailyRate: round2(variableDailyRate),
    supportsDailyBudget: method === "flow" || method === "hybrid",
  };
}
