// ScopedSeriesHandler (`nino_scoped_series.v1`)
// Série de gastos por grão (dia, semana, trimestre) com o mesmo recorte da
// série mensal: categoria + estabelecimento, competência e estornos
// (collectScopedSpend). O motor só agrupa; o LLM nunca calcula os valores.
// deno-lint-ignore-file no-explicit-any
import { round2 } from "../../../finance-core/facts.ts";
import type { FinancialQueryV3 } from "../FinancialIRv3.ts";
import type { ExecutedIR } from "../SemanticPreservation.ts";
import { MAX_SERIES_POINTS, type ScopedSeriesGrain } from "../SeriesGrain.ts";
import { collectScopedSpend, type ScopedSpendArgs } from "./MonthlySeriesHandler.ts";

export const SCOPED_SERIES_VERSION = "nino_scoped_series.v1";
export const SCOPED_SERIES_FORMULA_VERSION = "scoped_spending_series.v1";
export const SCOPED_SERIES_ENGINE = "spending_timeseries_scoped";

export type ScopedSeriesPoint = {
  key: string;
  from: string;
  to: string;
  label: string;
  total: number;
  transaction_count: number;
};

export type ScopedSeriesResult = {
  version: typeof SCOPED_SERIES_VERSION;
  formula_version: typeof SCOPED_SERIES_FORMULA_VERSION;
  grain: ScopedSeriesGrain;
  points: ScopedSeriesPoint[];
  total: number;
  transaction_count: number;
  active_points: number;
  average_per_active_point: number;
  peak: ScopedSeriesPoint | null;
  window: { from: string; to: string; n: number };
  scope: { category: string | null; merchant: string | null };
};

const DAY_MS = 86_400_000;
const utc = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ddmm = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const minYmd = (a: string, b: string) => (a < b ? a : b);
const maxYmd = (a: string, b: string) => (a > b ? a : b);

function quarterOf(value: string): { year: number; q: number } {
  return { year: Number(value.slice(0, 4)), q: Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1 };
}

function quarterBounds(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3;
  const from = ymd(Date.UTC(year, startMonth, 1, 12));
  const to = ymd(Date.UTC(year, startMonth + 3, 0, 12));
  return { from, to };
}

/** Janela recortada ao limite legível do grão (mantém o início pedido). */
export function capSeriesWindow(grain: ScopedSeriesGrain, from: string, to: string): { from: string; to: string } {
  const buckets = seriesBuckets(grain, from, to);
  const max = MAX_SERIES_POINTS[grain];
  return buckets.length <= max ? { from, to } : { from, to: buckets[max - 1].to };
}

/** Baldes do grão cobrindo a janela, recortados às bordas pedidas. */
export function seriesBuckets(grain: ScopedSeriesGrain, from: string, to: string): Array<Omit<ScopedSeriesPoint, "total" | "transaction_count">> {
  const out: Array<Omit<ScopedSeriesPoint, "total" | "transaction_count">> = [];
  if (grain === "day") {
    for (let t = utc(from); t <= utc(to) && out.length < 400; t += DAY_MS) {
      const d = ymd(t);
      out.push({ key: d, from: d, to: d, label: ddmm(d) });
    }
    return out;
  }
  if (grain === "week") {
    // Semana de segunda a domingo; a primeira e a última são recortadas.
    const first = new Date(utc(from));
    const monday = utc(from) - ((first.getUTCDay() + 6) % 7) * DAY_MS;
    for (let t = monday; t <= utc(to) && out.length < 120; t += 7 * DAY_MS) {
      const start = maxYmd(ymd(t), from);
      const end = minYmd(ymd(t + 6 * DAY_MS), to);
      out.push({ key: ymd(t), from: start, to: end, label: ddmm(start) });
    }
    return out;
  }
  let { year, q } = quarterOf(from);
  while (out.length < 40) {
    const bounds = quarterBounds(year, q);
    if (bounds.from > to) break;
    out.push({
      key: `${year}-T${q}`,
      from: maxYmd(bounds.from, from),
      to: minYmd(bounds.to, to),
      label: `T${q}/${String(year).slice(-2)}`,
    });
    q += 1;
    if (q > 4) { q = 1; year += 1; }
  }
  return out;
}

/** Agrupamento puro — exportado para testes. */
export function buildScopedSeries(
  entries: Array<{ date: string; amount: number }>,
  args: { grain: ScopedSeriesGrain; from: string; to: string; category_label?: string | null; merchant?: string | null },
): ScopedSeriesResult {
  const buckets = seriesBuckets(args.grain, args.from, args.to);
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date < args.from || entry.date > args.to) continue;
    const bucket = buckets.find((b) => entry.date >= b.from && entry.date <= b.to);
    if (!bucket) continue;
    totals.set(bucket.key, round2((totals.get(bucket.key) ?? 0) + entry.amount));
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }
  const points = buckets.map((b) => ({
    ...b,
    total: round2(totals.get(b.key) ?? 0),
    transaction_count: counts.get(b.key) ?? 0,
  }));
  const total = round2(points.reduce((sum, p) => sum + p.total, 0));
  const active = points.filter((p) => p.transaction_count > 0);
  return {
    version: SCOPED_SERIES_VERSION,
    formula_version: SCOPED_SERIES_FORMULA_VERSION,
    grain: args.grain,
    points,
    total,
    transaction_count: points.reduce((sum, p) => sum + p.transaction_count, 0),
    active_points: active.length,
    average_per_active_point: active.length ? round2(total / active.length) : 0,
    peak: active.reduce<ScopedSeriesPoint | null>((best, p) => !best || p.total > best.total ? p : best, null),
    window: { from: args.from, to: args.to, n: points.length },
    scope: {
      category: args.category_label?.trim() || null,
      merchant: String(args.merchant ?? "").trim() || null,
    },
  };
}

export async function loadScopedSeries(
  sb: any,
  args: ScopedSpendArgs & { grain: ScopedSeriesGrain },
): Promise<ScopedSeriesResult> {
  return buildScopedSeries(await collectScopedSpend(sb, args), args);
}

export function isScopedSeriesResult(value: unknown): value is ScopedSeriesResult {
  const r = value as ScopedSeriesResult | null;
  return !!r && r.version === SCOPED_SERIES_VERSION && Array.isArray(r.points);
}

// ---------------------------------------------------------------------------
// Texto diagramado (mesmo vocabulário do template do gráfico).
// ---------------------------------------------------------------------------

export const GRAIN_WORDS: Record<ScopedSeriesGrain, { series: string; unit: string; units: string; peak: string; top: string }> = {
  day: { series: "dia a dia", unit: "dia", units: "Dias", peak: "Maior dia", top: "Dias que mais pesaram" },
  week: { series: "semana a semana", unit: "semana", units: "Semanas", peak: "Maior semana", top: "Semanas" },
  quarter: { series: "por trimestre", unit: "trimestre", units: "Trimestres", peak: "Maior trimestre", top: "Trimestres" },
};

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const count = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;

export function scopedSeriesScopeLabel(result: Pick<ScopedSeriesResult, "scope">): string {
  const { category, merchant } = result.scope;
  if (category && merchant) return `${category} no ${merchant}`;
  return category ?? merchant ?? "todos os gastos";
}

export function pointDisplayLabel(grain: ScopedSeriesGrain, point: ScopedSeriesPoint): string {
  if (grain === "week") return point.from === point.to ? ddmm(point.from) : `${ddmm(point.from)} a ${ddmm(point.to)}`;
  return point.label;
}

export function scopedSeriesText(result: ScopedSeriesResult): string {
  const words = GRAIN_WORDS[result.grain];
  const scope = scopedSeriesScopeLabel(result);
  const period = `${ddmm(result.window.from)} a ${ddmm(result.window.to)}`;
  if (!result.active_points) return `Não encontrei gastos de *${scope}* entre ${period}.`;
  // Dia: só os 5 que mais pesaram (a série inteira vai no gráfico). Semana e
  // trimestre: poucos pontos, a lista vai inteira.
  const listed = result.grain === "day"
    ? [...result.points].filter((p) => p.transaction_count > 0).sort((a, b) => b.total - a.total).slice(0, 5)
      .sort((a, b) => a.from.localeCompare(b.from))
    : result.points;
  const line = (p: ScopedSeriesPoint) => p.transaction_count
    ? `• ${pointDisplayLabel(result.grain, p)}: ${brl(p.total)} (${count(p.transaction_count)})`
    : `• ${pointDisplayLabel(result.grain, p)}: sem lançamentos`;
  return [
    `📊 *${scope}, ${words.series}* (${period})`,
    "",
    `*Total:* ${brl(result.total)} em ${count(result.transaction_count)}`,
    `*${words.units} com gasto:* ${result.active_points} de ${result.window.n}`,
    `*Média nos ${words.units.toLowerCase()} com gasto:* ${brl(result.average_per_active_point)}`,
    result.peak ? `*${words.peak}:* ${pointDisplayLabel(result.grain, result.peak)}, com ${brl(result.peak.total)}` : "",
    "",
    `*${words.top}*`,
    ...listed.map(line),
  ].filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n").trim();
}

export function scopedSeriesExecutedIR(query: FinancialQueryV3, result: ScopedSeriesResult): ExecutedIR {
  return {
    metric: "expense_amount",
    filters: query.filters ?? [],
    time: {
      aspect: query.time.aspect,
      from: result.window.from,
      to: result.window.to,
      n: query.time.n,
      exclude_partial: query.time.exclude_partial,
    },
    grain: result.grain,
    reduce: query.reduce,
    group_by: query.group_by ?? [],
    partial: false,
  };
}
