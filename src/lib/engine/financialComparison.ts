// Motor canônico de comparação financeira (`financial_comparison.v1`).
//
// FONTE ÚNICA de toda comparação temporal do produto: App, WhatsApp, Home,
// Relatórios, Advisor e Proatividade consomem este motor. Nenhuma superfície
// recalcula por conta própria e a LLM nunca escolhe período, dia útil ou
// percentual — apenas explica o `methodology` que sai daqui.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  round2,
  type TransactionRow,
} from "./facts";
import {
  CANONICAL_EXCLUSIONS,
  REFUND_EXCLUSION,
  type EngineConfidence,
} from "./engineEnvelope";
import {
  DEFAULT_JURISDICTION,
  addDays,
  businessDayIndex,
  businessDaysBetween,
  getEquivalentBusinessPeriod,
  getNthBusinessDay,
  type Jurisdiction,
} from "./brazilianCalendar";
import { monthOf, monthPeriod, previousMonth } from "./ninoClock";

export const FINANCIAL_COMPARISON_VERSION = "financial_comparison.v1";

export type ComparisonMetric =
  | "expense" | "income" | "net" | "savings_rate" | "category_spend" | "merchant_spend"
  | "transaction_count" | "average_ticket" | "card_spend" | "cash_flow" | "debt_payment"
  | "investment_flow" | "net_worth" | "commitment_load" | "goal_progress";

export type ComparisonScope = "overall" | "category" | "merchant" | "card" | "account" | "goal" | "debt";

export type ComparisonMode =
  | "PREVIOUS_EQUIVALENT_PERIOD"
  | "SAME_CALENDAR_DAYS_PREVIOUS_MONTH"
  | "SAME_NUMBER_OF_ELAPSED_DAYS"
  | "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH"
  | "SAME_BUSINESS_DAYS_RANGE"
  | "WEEK_OVER_WEEK"
  | "MONTH_OVER_MONTH"
  | "MTD"
  | "MTD_EQUIVALENT"
  | "ROLLING_WINDOW"
  | "SAME_CARD_CYCLE_POINT"
  | "YEAR_OVER_YEAR"
  | "CUSTOM_PERIOD";

export type Period = { from: string; to: string };

export type Comparability = "high" | "medium" | "low" | "invalid";

export type DataCoverage = {
  expected_days: number;
  observed_days: number;
  active_days: number;
  transaction_days: number;
  coverage_ratio: number;
  first_reliable_date: string | null;
  confidence: EngineConfidence;
};

export type ComparisonSide = {
  from: string;
  to: string;
  value: number;
  sample_size: number;
  days: number;
  business_days: number;
  coverage: DataCoverage;
};

export type ComparisonDriver = {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta_abs: number;
  delta_pct: number | null;
  share_of_delta: number;
};

export type FinancialComparisonRequest = {
  txs: TransactionRow[];
  categoryNames?: Map<string, string>;
  metric: ComparisonMetric;
  scope?: ComparisonScope;
  subject_id?: string | null;
  subject_label?: string | null;
  mode: ComparisonMode;
  /** Data de referência local do usuário (NinoClock). */
  as_of: string;
  /** Período atual explícito (obrigatório em CUSTOM_PERIOD). */
  current_period?: Period;
  comparison_period?: Period;
  /** Janela em dias para ROLLING_WINDOW (default 30). */
  window_days?: number;
  /** N de dias úteis para SAME_BUSINESS_DAYS_RANGE. */
  business_days?: number;
  /** Ciclo do cartão para SAME_CARD_CYCLE_POINT. */
  card_cycle?: { current_start: string; previous_start: string; cycle_day_index?: number };
  jurisdiction?: Jurisdiction;
  /** Métricas fora do ledger (patrimônio, meta) chegam prontas por período. */
  valueResolver?: (period: Period) => { value: number; sample_size: number } | null;
};

export type FinancialComparisonResult = {
  metric: ComparisonMetric;
  scope: ComparisonScope;
  subject_id: string | null;
  subject_label: string | null;
  mode: ComparisonMode;
  current: ComparisonSide;
  previous: ComparisonSide;
  delta_abs: number;
  delta_pct: number | null;
  direction: "up" | "down" | "flat";
  comparability: Comparability;
  confidence: EngineConfidence;
  drivers: ComparisonDriver[];
  exclusions: string[];
  /** Frase pt-BR que descreve exatamente o recorte usado. */
  methodology: string;
  evidence: {
    current_period: Period;
    previous_period: Period;
    business_calendar: string;
    jurisdiction: Jurisdiction;
    notes: string[];
  };
  formula_version: string;
};

// ---------------------------------------------------------------------------
// Resolução de períodos
// ---------------------------------------------------------------------------
function calendarDays(p: Period): number {
  return Math.max(0, Math.round((Date.parse(`${p.to}T12:00:00Z`) - Date.parse(`${p.from}T12:00:00Z`)) / 86400000) + 1);
}

function shiftMonthKeep(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function resolvePeriods(req: FinancialComparisonRequest): {
  current: Period;
  previous: Period;
  methodology: string;
  notes: string[];
} {
  const jur = req.jurisdiction ?? DEFAULT_JURISDICTION;
  const today = req.as_of;
  const month = monthOf(today);
  const prev = previousMonth(month);
  const notes: string[] = [];

  switch (req.mode) {
    case "ROLLING_WINDOW":
    case "PREVIOUS_EQUIVALENT_PERIOD": {
      const size = req.current_period ? calendarDays(req.current_period) : (req.window_days ?? 30);
      const current = req.current_period ?? { from: addDays(today, -(size - 1)), to: today };
      const previous = req.comparison_period ?? {
        from: addDays(current.from, -size),
        to: addDays(current.from, -1),
      };
      return {
        current, previous,
        methodology: `Comparei os ${size} dias de ${current.from} a ${current.to} com os ${size} dias imediatamente anteriores (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "MTD": {
      const current = { from: `${month}-01`, to: today };
      const previous = { from: `${prev}-01`, to: shiftMonthKeep(today, -1) };
      return {
        current, previous,
        methodology: `Comparei do dia 1º até hoje (${current.from} a ${current.to}) com o mesmo intervalo de dias do mês anterior (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "SAME_CALENDAR_DAYS_PREVIOUS_MONTH":
    case "MTD_EQUIVALENT":
    case "SAME_NUMBER_OF_ELAPSED_DAYS": {
      const current = req.current_period ?? { from: `${month}-01`, to: today };
      const elapsed = calendarDays(current);
      const prevStart = `${previousMonth(monthOf(current.from))}-01`;
      const previous = req.comparison_period ?? { from: prevStart, to: addDays(prevStart, elapsed - 1) };
      return {
        current, previous,
        methodology: `Comparei os primeiros ${elapsed} dias do período (${current.from} a ${current.to}) com os primeiros ${elapsed} dias do mês anterior (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH": {
      const current = req.current_period ?? { from: `${month}-01`, to: today };
      const n = req.business_days ?? businessDaysBetween(current.from, current.to, jur);
      const [py, pm] = previousMonth(monthOf(current.from)).split("-").map(Number);
      const start = getNthBusinessDay(py, pm, 1, jur);
      const end = getNthBusinessDay(py, pm, n, jur);
      if (!start || !end) {
        notes.push("O mês anterior não tem dias úteis suficientes para um recorte equivalente.");
        return { current, previous: { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: current.to }, methodology: "Comparação por dias úteis indisponível para o mês anterior.", notes };
      }
      return {
        current, previous: { from: start, to: end },
        methodology: `Comparei os primeiros ${n} dias úteis deste mês (${current.from} a ${current.to}) com os primeiros ${n} dias úteis do mês anterior (${start} a ${end}). Sábados, domingos e feriados nacionais brasileiros ficaram fora do recorte.`,
        notes,
      };
    }
    case "SAME_BUSINESS_DAYS_RANGE": {
      const n = req.business_days ?? (businessDayIndex(today, jur) || 1);
      const [cy, cm] = monthOf(req.current_period?.from ?? today).split("-").map(Number);
      const cStart = getNthBusinessDay(cy, cm, 1, jur);
      const cEnd = getNthBusinessDay(cy, cm, n, jur);
      const current = cStart && cEnd ? { from: cStart, to: cEnd } : (req.current_period ?? { from: `${month}-01`, to: today });
      const equiv = getEquivalentBusinessPeriod(current, previousMonth(monthOf(current.from)), jur);
      const previous = req.comparison_period ?? equiv ?? { from: `${prev}-01`, to: `${prev}-01` };
      if (!equiv) notes.push("Mês anterior sem dias úteis equivalentes suficientes.");
      return {
        current, previous,
        methodology: `Comparei os primeiros ${n} dias úteis de ${monthOf(current.from)} (${current.from} a ${current.to}) com os primeiros ${n} dias úteis de ${monthOf(previous.from)} (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "WEEK_OVER_WEEK": {
      const weekday = new Date(Date.parse(`${today}T12:00:00Z`)).getUTCDay();
      const weekStart = addDays(today, -weekday);
      const current = req.current_period ?? { from: weekStart, to: today };
      const previous = req.comparison_period ?? { from: addDays(current.from, -7), to: addDays(current.to, -7) };
      return {
        current, previous,
        methodology: `Comparei a semana atual até hoje (${current.from} a ${current.to}) com o mesmo ponto da semana anterior (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "MONTH_OVER_MONTH": {
      const current = req.current_period ?? monthPeriod(prev);
      const previous = req.comparison_period ?? monthPeriod(previousMonth(monthOf(current.from)));
      if (monthOf(current.from) === month) notes.push("O mês atual ainda está incompleto — trate como MTD para conclusões.");
      return {
        current, previous,
        methodology: `Comparei o mês fechado de ${monthOf(current.from)} com o mês fechado de ${monthOf(previous.from)}.`,
        notes,
      };
    }
    case "SAME_CARD_CYCLE_POINT": {
      const cycleDay = req.card_cycle?.cycle_day_index
        ?? (req.card_cycle ? calendarDays({ from: req.card_cycle.current_start, to: today }) : 1);
      const cs = req.card_cycle?.current_start ?? `${month}-01`;
      const ps = req.card_cycle?.previous_start ?? `${prev}-01`;
      const current = { from: cs, to: addDays(cs, cycleDay - 1) };
      const previous = { from: ps, to: addDays(ps, cycleDay - 1) };
      return {
        current, previous,
        methodology: `Comparei o ${cycleDay}º dia do ciclo atual da fatura (${current.from} a ${current.to}) com o ${cycleDay}º dia do ciclo anterior (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "YEAR_OVER_YEAR": {
      const current = req.current_period ?? { from: `${month}-01`, to: today };
      const previous = req.comparison_period ?? {
        from: `${Number(current.from.slice(0, 4)) - 1}${current.from.slice(4)}`,
        to: `${Number(current.to.slice(0, 4)) - 1}${current.to.slice(4)}`,
      };
      return {
        current, previous,
        methodology: `Comparei ${current.from} a ${current.to} com o mesmo intervalo do ano anterior (${previous.from} a ${previous.to}).`,
        notes,
      };
    }
    case "CUSTOM_PERIOD":
    default: {
      const current = req.current_period ?? { from: `${month}-01`, to: today };
      const size = calendarDays(current);
      const previous = req.comparison_period ?? { from: addDays(current.from, -size), to: addDays(current.from, -1) };
      return {
        current, previous,
        methodology: `Comparei ${current.from} a ${current.to} com ${previous.from} a ${previous.to}.`,
        notes,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Métrica
// ---------------------------------------------------------------------------
function matchesScope(t: TransactionRow, req: FinancialComparisonRequest, attribution: Map<string, string | null>): boolean {
  const scope = req.scope ?? "overall";
  if (scope === "overall") return true;
  if (!req.subject_id) return true;
  switch (scope) {
    case "category": return effectiveCategoryId(t, attribution) === req.subject_id;
    case "merchant": {
      const raw = String((t as { merchant_name?: string | null }).merchant_name ?? t.description ?? "").toLowerCase();
      return raw.includes(String(req.subject_id).toLowerCase());
    }
    case "card": return (t as { credit_card_id?: string | null }).credit_card_id === req.subject_id;
    case "account": return t.account_id === req.subject_id;
    default: return true;
  }
}

type Aggregate = {
  value: number;
  sample_size: number;
  transaction_days: Set<string>;
  byDriver: Map<string, number>;
};

function aggregate(
  req: FinancialComparisonRequest,
  period: Period,
  ledger: TransactionRow[],
  attribution: Map<string, string | null>,
): Aggregate {
  const names = req.categoryNames ?? new Map<string, string>();
  const out: Aggregate = { value: 0, sample_size: 0, transaction_days: new Set(), byDriver: new Map() };
  let income = 0;
  let expense = 0;
  let count = 0;
  let cardExpense = 0;

  for (const t of ledger) {
    const d = t.occurred_at.slice(0, 10);
    if (d < period.from || d > period.to) continue;
    if (!matchesScope(t, req, attribution)) continue;
    const inc = behavioralMetricAmount(t, "income");
    const exp = behavioralMetricAmount(t, "expense");
    if (inc === 0 && exp === 0) continue;
    income += inc;
    expense += exp;
    count += 1;
    if ((t as { credit_card_id?: string | null }).credit_card_id) cardExpense += exp;
    out.transaction_days.add(d);
    if (exp !== 0) {
      const catId = effectiveCategoryId(t, attribution);
      const label = catId ? (names.get(catId) ?? "Sem categoria") : "Sem categoria";
      out.byDriver.set(label, round2((out.byDriver.get(label) ?? 0) + exp));
    }
  }

  switch (req.metric) {
    case "income": out.value = round2(income); break;
    case "net":
    case "cash_flow": out.value = round2(income - expense); break;
    case "savings_rate": out.value = income > 0 ? round2(((income - expense) / income) * 100) : 0; break;
    case "transaction_count": out.value = count; break;
    case "average_ticket": out.value = count > 0 ? round2(expense / count) : 0; break;
    case "card_spend": out.value = round2(cardExpense); break;
    default: out.value = round2(expense); break;
  }
  out.sample_size = count;
  return out;
}

function coverageOf(period: Period, agg: Aggregate, allDates: string[]): DataCoverage {
  const expected = calendarDays(period);
  const observed = allDates.filter((d) => d >= period.from && d <= period.to).length;
  const txDays = agg.transaction_days.size;
  const ratio = expected > 0 ? Math.min(1, txDays / expected) : 0;
  const first = allDates.length ? allDates[0] : null;
  let confidence: EngineConfidence = "insufficient_data";
  if (agg.sample_size >= 12 && ratio >= 0.4) confidence = "high";
  else if (agg.sample_size >= 6 && ratio >= 0.2) confidence = "medium";
  else if (agg.sample_size >= 3) confidence = "low";
  return {
    expected_days: expected,
    observed_days: observed,
    active_days: txDays,
    transaction_days: txDays,
    coverage_ratio: Math.round(ratio * 10000) / 10000,
    first_reliable_date: first,
    confidence,
  };
}

function rank(c: EngineConfidence): number {
  return c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
}

function comparabilityOf(current: ComparisonSide, previous: ComparisonSide, notes: string[]): Comparability {
  if (previous.sample_size === 0 && current.sample_size === 0) return "invalid";
  const sameDays = Math.abs(current.days - previous.days) <= 1;
  const sameBusiness = Math.abs(current.business_days - previous.business_days) <= 1;
  const bothCovered = current.coverage.coverage_ratio >= 0.2 && previous.coverage.coverage_ratio >= 0.2;
  const enough = current.sample_size >= 5 && previous.sample_size >= 5;
  if (sameDays && sameBusiness && bothCovered && enough && notes.length === 0) return "high";
  if ((sameDays || sameBusiness) && (current.sample_size >= 3 && previous.sample_size >= 3)) return "medium";
  if (current.sample_size === 0 || previous.sample_size === 0) return "low";
  return "low";
}

export function computeFinancialComparison(req: FinancialComparisonRequest): FinancialComparisonResult {
  const jur = req.jurisdiction ?? DEFAULT_JURISDICTION;
  const { current: cp, previous: pp, methodology, notes } = resolvePeriods(req);
  const ledger = (req.txs ?? []).filter((t) => String(t.status ?? "confirmed") !== "superseded");
  const attribution = buildRefundAttribution(ledger);
  const allDates = [...new Set(ledger.map((t) => t.occurred_at.slice(0, 10)))].sort();

  const external = req.valueResolver;
  const aggC = aggregate(req, cp, ledger, attribution);
  const aggP = aggregate(req, pp, ledger, attribution);
  const extC = external?.(cp) ?? null;
  const extP = external?.(pp) ?? null;

  const current: ComparisonSide = {
    from: cp.from, to: cp.to,
    value: extC ? round2(extC.value) : aggC.value,
    sample_size: extC ? extC.sample_size : aggC.sample_size,
    days: calendarDays(cp),
    business_days: businessDaysBetween(cp.from, cp.to, jur),
    coverage: coverageOf(cp, aggC, allDates),
  };
  const previous: ComparisonSide = {
    from: pp.from, to: pp.to,
    value: extP ? round2(extP.value) : aggP.value,
    sample_size: extP ? extP.sample_size : aggP.sample_size,
    days: calendarDays(pp),
    business_days: businessDaysBetween(pp.from, pp.to, jur),
    coverage: coverageOf(pp, aggP, allDates),
  };

  const delta_abs = round2(current.value - previous.value);
  const delta_pct = previous.value !== 0
    ? Math.round((delta_abs / Math.abs(previous.value)) * 10000) / 100
    : null;

  const driverKeys = new Set<string>([...aggC.byDriver.keys(), ...aggP.byDriver.keys()]);
  const totalDelta = Math.abs(delta_abs) || 1;
  const drivers: ComparisonDriver[] = [...driverKeys].map((label) => {
    const cur = aggC.byDriver.get(label) ?? 0;
    const pre = aggP.byDriver.get(label) ?? 0;
    const d = round2(cur - pre);
    return {
      key: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      current: cur,
      previous: pre,
      delta_abs: d,
      delta_pct: pre > 0 ? Math.round((d / pre) * 10000) / 100 : null,
      share_of_delta: Math.round((Math.abs(d) / totalDelta) * 10000) / 10000,
    };
  }).sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs)).slice(0, 8);

  if (Math.abs(current.days - previous.days) > 1) {
    notes.push(`Períodos com tamanhos diferentes (${current.days}d vs ${previous.days}d).`);
  }
  const comparability = comparabilityOf(current, previous, notes);
  const confidence: EngineConfidence = (() => {
    const base = Math.min(rank(current.coverage.confidence), rank(previous.coverage.confidence));
    const cap = comparability === "high" ? 3 : comparability === "medium" ? 2 : comparability === "low" ? 1 : 0;
    const score = Math.min(base, cap);
    return score >= 3 ? "high" : score === 2 ? "medium" : score === 1 ? "low" : "insufficient_data";
  })();

  return {
    metric: req.metric,
    scope: req.scope ?? "overall",
    subject_id: req.subject_id ?? null,
    subject_label: req.subject_label ?? null,
    mode: req.mode,
    current,
    previous,
    delta_abs,
    delta_pct,
    direction: delta_abs > 0 ? "up" : delta_abs < 0 ? "down" : "flat",
    comparability,
    confidence,
    drivers,
    exclusions: [...CANONICAL_EXCLUSIONS, REFUND_EXCLUSION],
    methodology,
    evidence: {
      current_period: cp,
      previous_period: pp,
      business_calendar: "brazilian_business_calendar.v1",
      jurisdiction: jur,
      notes,
    },
    formula_version: FINANCIAL_COMPARISON_VERSION,
  };
}
