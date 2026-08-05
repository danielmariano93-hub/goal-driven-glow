/**
 * FONTE CANÔNICA — Média diária e Ritmo de gastos.
 * =================================================
 * Versão da fórmula: `spending_rhythm.v1`.
 *
 * Regras determinísticas (mesmas para Home, Relatórios, Assessor e WhatsApp):
 *
 * 1. Elegibilidade: só entra o que `behavioralMetricAmount(t,"expense")` considera
 *    consumo real. Ficam de fora transferências entre contas próprias, aplicações
 *    e resgates de investimento, aportes em metas e PAGAMENTO DE FATURA do cartão.
 *    A COMPRA no cartão entra no dia da compra (regime de competência do gasto);
 *    o pagamento da fatura é movimento de caixa, nunca despesa.
 * 2. Denominador: dias corridos do período, incluindo dias sem nenhum gasto.
 *    O período nunca passa de hoje — não projetamos dias futuros.
 * 3. Média total  = consumo elegível ÷ dias corridos.
 * 4. Ritmo típico = (consumo elegível − fixas − atípicos) ÷ dias corridos.
 *    - "fixas": lançamentos recorrentes, parcelados e categorias estruturais
 *      (moradia, escola, seguro, assinatura...). Não representam decisão diária.
 *    - "atípicos": outliers estatísticos (Tukey, Q3 + 1,5·IIQ) do próprio período,
 *      só aplicados com amostra mínima de 8 lançamentos.
 * 5. Comparação: mês/mês-até-hoje usa os mesmos índices do mês anterior;
 *    demais janelas usam o período imediatamente anterior com o mesmo tamanho.
 * 6. Uma queda no ritmo é sempre positiva; uma alta é sempre negativa.
 */
import { behavioralMetricAmount, round2, type TransactionRow } from "./facts";

export const RHYTHM_FORMULA_VERSION = "spending_rhythm.v4";

export interface DateRange { start: string; end: string }
export type Trend = "up" | "down" | "stable";

export type ExclusionReason = "fixed" | "installment" | "recurring" | "outlier";

export type RhythmTx = TransactionRow & {
  origin?: string | null;
  installments_total?: number | null;
  friendly_description?: string | null;
};

export interface RhythmExcludedItem {
  id: string;
  date: string;
  amount: number;
  label: string;
  reason: ExclusionReason;
}

export interface DailyPoint {
  date: string;
  /** despesa BRUTA do dia (nunca reduzida por reembolso) */
  grossAmount: number;
  /** reembolsos/estornos recebidos no dia (valor positivo) */
  refundAmount: number;
  /** consumo líquido do dia = grossAmount − refundAmount (pode ser negativo) */
  netAmount: number;
  /** @deprecated use grossAmount — mantido para compatibilidade de leitura */
  amount: number;
  /** parcela do consumo diário que compõe o ritmo típico */
  typicalAmount: number;
  /** acumulado líquido até o dia */
  cumulative: number;
  /** acumulado bruto até o dia */
  cumulativeGross: number;
  /** média líquida acumulada até o dia (cumulative / dias decorridos) */
  runningAverage: number;
  /** média bruta acumulada até o dia */
  runningAverageGross: number;
  /** ritmo típico acumulado até o dia, com o mesmo denominador da média total */
  typicalRunningAverage: number;
}

export interface RhythmResult {
  range: DateRange;
  days: number;
  /** consumo LÍQUIDO total do período (bruto − reembolsos). Pode ser negativo. */
  total: number;
  /** despesa bruta total do período */
  totalGross: number;
  /** reembolsos totais do período (positivo) */
  totalRefunds: number;
  /** média líquida = total / days */
  average: number;
  /** média bruta = totalGross / days */
  averageGross: number;
  /** consumo depois de remover fixas e atípicos */
  typicalTotal: number;
  /** ritmo típico = typicalTotal / days */
  typicalAverage: number;
  excludedTotal: number;
  excluded: RhythmExcludedItem[];
  /** total excluído agrupado por motivo — base da explicação na UI */
  excludedByReason: Array<{ reason: ExclusionReason; label: string; total: number; count: number }>;
  series: DailyPoint[];
  formulaVersion: string;
}


export interface RhythmComparison {
  current: RhythmResult;
  previous: RhythmResult;
  /** variação da média total */
  averageDeltaPct: number | null;
  averageTrend: Trend;
  /** variação do ritmo típico */
  typicalDeltaPct: number | null;
  typicalTrend: Trend;
}

// ── datas ───────────────────────────────────────────────────────────────────

function parseLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function daysInclusive(start: string, end: string): number {
  const s = parseLocal(start);
  const e = parseLocal(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function addDays(iso: string, delta: number): string {
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + delta);
  return isoLocal(d);
}

/** Nunca projetar para o futuro: o fim do período é limitado a hoje. */
export function clampRangeToToday(range: DateRange, today = isoLocal(new Date())): DateRange {
  const end = range.end > today ? today : range.end;
  return { start: range.start, end };
}

function previousMonthSameDay(iso: string): string {
  const date = parseLocal(iso);
  if (isNaN(date.getTime())) return iso;
  const year = date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
  const month = date.getMonth() === 0 ? 11 : date.getMonth() - 1;
  const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
  return isoLocal(new Date(year, month, day));
}

/**
 * Intervalo comparável:
 * - mês/mês-até-hoje (início no dia 1): mesmos índices no mês anterior;
 * - demais janelas: mesmo número de dias, imediatamente antes do início.
 */
export function previousComparableRange(range: DateRange): DateRange {
  const n = daysInclusive(range.start, range.end);
  if (n <= 0) return range;
  const startDate = parseLocal(range.start);
  const endDate = parseLocal(range.end);
  const isCalendarMonthRange = !isNaN(startDate.getTime())
    && !isNaN(endDate.getTime())
    && startDate.getDate() === 1
    && startDate.getFullYear() === endDate.getFullYear()
    && startDate.getMonth() === endDate.getMonth();
  if (isCalendarMonthRange) {
    return { start: previousMonthSameDay(range.start), end: previousMonthSameDay(range.end) };
  }
  const end = addDays(range.start, -1);
  return { start: addDays(end, -(n - 1)), end };
}

// ── classificação declarativa de fixas / atípicos ───────────────────────────

/**
 * Registro declarativo de despesas estruturais.
 * A fonte preferida é `categoryKindById` (`structural`), configurável por
 * usuário/produto. O dicionário de padrões abaixo é apenas FALLBACK para
 * categorias que ainda não têm classificação declarada.
 */
export const STRUCTURAL_CATEGORY_KINDS = new Set(["structural", "fixed", "essential_fixed"]);

const FIXED_CATEGORY_PATTERNS = [
  "aluguel", "moradia", "condom", "financiamento", "prestac", "prestaç",
  "mensalidade", "escola", "faculdade", "educac", "educaç",
  "plano de saude", "plano de saúde", "saude/plano", "seguro",
  "energia", "luz", "agua", "água", "gas", "gás", "internet", "telefone",
  "assinatura", "streaming", "academia", "emprestimo", "empréstimo", "consorcio", "consórcio",
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isFixedCategoryName(name?: string | null): boolean {
  if (!name) return false;
  const n = normalize(name);
  return FIXED_CATEGORY_PATTERNS.some((p) => n.includes(normalize(p)));
}

function labelOf(t: RhythmTx): string {
  return (t.friendly_description || t.description || "Lançamento").toString();
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

const MIN_SAMPLE_FOR_OUTLIERS = 8;

/**
 * Parcelamento NÃO é mais exclusão automática: comprar em 3x continua sendo
 * decisão de consumo do período. Só sai do ritmo típico quando é parcela de
 * um compromisso recorrente (origem `recurring`) com mais de uma parcela.
 */
function isRecurringInstallment(t: RhythmTx): boolean {
  const origin = String(t.origin ?? "");
  return Number(t.installments_total ?? 0) > 1 && (origin === "recurring" || origin === "recurring_installment");
}

export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  fixed: "Despesa estrutural",
  recurring: "Conta recorrente",
  installment: "Parcela de compromisso recorrente",
  outlier: "Gasto atípico do período",
};

// ── cálculo ─────────────────────────────────────────────────────────────────

export interface RhythmOptions {
  /** id -> nome da categoria, usado apenas como fallback de classificação */
  categoryNameById?: Record<string, string>;
  /** id -> tipo declarado da categoria (`structural` sai do ritmo típico) */
  categoryKindById?: Record<string, string>;
  /** ids de categorias declaradas como estruturais */
  structuralCategoryIds?: string[];
  /** desligar a exclusão de fixas/atípicos (retorna typical == average) */
  disableTypical?: boolean;
}


export function computeRhythm(
  txs: RhythmTx[],
  rawRange: DateRange,
  opts: RhythmOptions = {},
): RhythmResult {
  const range = rawRange;
  const days = daysInclusive(range.start, range.end);
  const categoryNameById = opts.categoryNameById ?? {};

  const grossByDay = new Map<string, number>();
  const refundByDay = new Map<string, number>();
  const typicalByDay = new Map<string, number>();
  const positives: Array<{ t: RhythmTx; amount: number }> = [];
  let totalGross = 0;
  let totalRefunds = 0;

  for (const t of txs) {
    const d = String(t.occurred_at ?? "").slice(0, 10);
    if (!d || d < range.start || d > range.end) continue;
    const signed = behavioralMetricAmount(t, "expense");
    if (signed === 0) continue;
    if (signed > 0) {
      totalGross += signed;
      grossByDay.set(d, (grossByDay.get(d) ?? 0) + signed);
      positives.push({ t, amount: signed });
    } else {
      const refund = -signed;
      totalRefunds += refund;
      refundByDay.set(d, (refundByDay.get(d) ?? 0) + refund);
    }
  }
  totalGross = round2(totalGross);
  totalRefunds = round2(totalRefunds);
  // Consumo líquido pode ser negativo em períodos com estorno maior que a
  // despesa. Nunca clampamos: isso quebraria a reconciliação com a série.
  const total = round2(totalGross - totalRefunds);

  // Classificação declarativa: kind da categoria > lista de ids > fallback por nome.
  const categoryKindById = opts.categoryKindById ?? {};
  const structuralIds = new Set(opts.structuralCategoryIds ?? []);
  const isStructural = (categoryId?: string | null): boolean => {
    if (!categoryId) return false;
    if (structuralIds.has(categoryId)) return true;
    const kind = categoryKindById[categoryId];
    if (kind) return STRUCTURAL_CATEGORY_KINDS.has(kind);
    return isFixedCategoryName(categoryNameById[categoryId]);
  };

  // outliers de Tukey sobre lançamentos não-fixos
  const fixedFlag = new Map<string, ExclusionReason>();
  for (const { t } of positives) {
    if ((t.origin ?? "") === "recurring") fixedFlag.set(t.id, "recurring");
    else if (isRecurringInstallment(t)) fixedFlag.set(t.id, "installment");
    else if (isStructural(t.category_id)) fixedFlag.set(t.id, "fixed");
  }


  const variable = positives.filter((p) => !fixedFlag.has(p.t.id));
  let outlierThreshold = Infinity;
  if (variable.length >= MIN_SAMPLE_FOR_OUTLIERS) {
    const sorted = variable.map((p) => p.amount).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    outlierThreshold = q3 + 1.5 * iqr;
  }

  const excluded: RhythmExcludedItem[] = [];
  let excludedTotal = 0;
  if (!opts.disableTypical) {
    for (const { t, amount } of positives) {
      const fixed = fixedFlag.get(t.id);
      const isOutlier = !fixed && amount > outlierThreshold;
      if (!fixed && !isOutlier) continue;
      excluded.push({
        id: t.id,
        date: String(t.occurred_at).slice(0, 10),
        amount: round2(amount),
        label: labelOf(t),
        reason: fixed ?? "outlier",
      });
      excludedTotal += amount;
    }
  }
  excludedTotal = round2(excludedTotal);
  excluded.sort((a, b) => b.amount - a.amount);

  // Base típica sai da despesa BRUTA (reembolso não é decisão de consumo).
  const typicalTotal = round2(Math.max(0, totalGross - excludedTotal));
  const excludedIds = new Set(excluded.map((item) => item.id));
  for (const { t, amount } of positives) {
    if (excludedIds.has(t.id)) continue;
    const date = String(t.occurred_at ?? "").slice(0, 10);
    typicalByDay.set(date, round2((typicalByDay.get(date) ?? 0) + amount));
  }

  const series: DailyPoint[] = [];
  let cumulative = 0;
  let cumulativeGross = 0;
  let typicalCumulative = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(range.start, i);
    const grossAmount = round2(grossByDay.get(date) ?? 0);
    const refundAmount = round2(refundByDay.get(date) ?? 0);
    const netAmount = round2(grossAmount - refundAmount);
    const typicalAmount = round2(typicalByDay.get(date) ?? 0);
    cumulative = round2(cumulative + netAmount);
    cumulativeGross = round2(cumulativeGross + grossAmount);
    typicalCumulative = round2(typicalCumulative + typicalAmount);
    series.push({
      date,
      grossAmount,
      refundAmount,
      netAmount,
      amount: grossAmount,
      typicalAmount,
      cumulative,
      cumulativeGross,
      runningAverage: round2(cumulative / (i + 1)),
      runningAverageGross: round2(cumulativeGross / (i + 1)),
      typicalRunningAverage: round2(typicalCumulative / (i + 1)),
    });
  }

  return {
    range,
    days,
    total,
    totalGross,
    totalRefunds,
    average: days > 0 ? round2(total / days) : 0,
    averageGross: days > 0 ? round2(totalGross / days) : 0,
    typicalTotal,
    typicalAverage: days > 0 ? round2(typicalTotal / days) : 0,
    excludedTotal,
    excluded,
    excludedByReason: (["recurring", "installment", "fixed", "outlier"] as ExclusionReason[])
      .map((reason) => {
        const items = excluded.filter((e) => e.reason === reason);
        return {
          reason,
          label: EXCLUSION_REASON_LABEL[reason],
          total: round2(items.reduce((sum, e) => sum + e.amount, 0)),
          count: items.length,
        };
      })
      .filter((g) => g.count > 0),

    series,
    formulaVersion: RHYTHM_FORMULA_VERSION,
  };
}

function delta(current: number, previous: number): { pct: number | null; trend: Trend } {
  if (previous > 0) {
    const pct = round2(((current - previous) / previous) * 100);
    if (Math.abs(pct) < 1) return { pct, trend: "stable" };
    return { pct, trend: pct > 0 ? "up" : "down" };
  }
  return { pct: null, trend: current > 0 ? "up" : "stable" };
}

export function computeRhythmComparison(
  txs: RhythmTx[],
  range: DateRange,
  opts: RhythmOptions = {},
): RhythmComparison {
  const current = computeRhythm(txs, range, opts);
  const previous = computeRhythm(txs, previousComparableRange(range), opts);
  const a = delta(current.average, previous.average);
  const t = delta(current.typicalAverage, previous.typicalAverage);
  return {
    current,
    previous,
    averageDeltaPct: a.pct,
    averageTrend: a.trend,
    typicalDeltaPct: t.pct,
    typicalTrend: t.trend,
  };
}

const MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

export function formatRangeShort(range: DateRange): string {
  const s = parseLocal(range.start);
  const e = parseLocal(range.end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    if (s.getDate() === e.getDate()) return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]}`;
    return `${s.getDate()}–${e.getDate()} ${MONTHS_SHORT[s.getMonth()]}`;
  }
  return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}`;
}
