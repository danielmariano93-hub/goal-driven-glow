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
  reportingCompetenceDate,
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
  includedByDaySelection,
  profileOf,
  BRAZILIAN_CALENDAR_VERSION,
  DAY_SELECTION_LABEL_PT,
  type DaySelection,
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

/**
 * Base explícita da comparação. A causa-raiz que isso fecha: em `CUSTOM_PERIOD`
 * o motor escolhia SILENCIOSAMENTE a janela imediatamente anterior de mesmo
 * tamanho. Perguntar "julho contra o mês anterior" devolvia 31/05–30/06, e a
 * resposta parecia certa para um recorte que ninguém pediu.
 */
export type ComparisonBasis =
  | "calendar_previous_month"
  | "preceding_window"
  | "mode_default";

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

export type DriverNature = "structural" | "behavioral" | "timing" | "unknown";

export type ComparisonDriver = {
  key: string;
  label: string;
  /** Eixo do driver — nunca só categoria. */
  driver_type: "category" | "merchant" | "flexibility" | "card" | "movement" | "residual";
  nature: DriverNature;
  current: number;
  previous: number;
  delta_abs: number;
  delta_pct: number | null;
  share_of_delta: number;
  /** Confiança do driver isolado (amostra pequena não vira explicação forte). */
  confidence: EngineConfidence;
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
  /**
   * Seleção de dias DENTRO da janela. `CHRONOLOGICAL` soma todos os dias
   * corridos; `BUSINESS_DAYS_ONLY` soma apenas dias úteis. Nunca implícito no
   * texto da resposta: aparece no `methodology`.
   */
  day_selection?: DaySelection;
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
  /** Eixos de driver desejados. Default: categoria + estabelecimento + fixo/flexível. */
  driver_axes?: Array<"category" | "merchant" | "flexibility" | "card" | "movement">;
  /** Categorias recorrentes conhecidas — usadas para classificar natureza. */
  recurring_labels?: string[];
  /**
   * Base de comparação desejada em `CUSTOM_PERIOD`. Default: mês calendário
   * anterior no mesmo recorte de dias quando o período atual cabe num único
   * mês. Janela deslizante só quando pedida explicitamente.
   */
  comparison_basis?: ComparisonBasis;
};


export type FinancialComparisonResult = {
  metric: ComparisonMetric;
  scope: ComparisonScope;
  subject_id: string | null;
  subject_label: string | null;
  mode: ComparisonMode;
  day_selection: DaySelection;
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
  /** Base da comparação efetivamente usada — auditável, nunca implícita. */
  comparison_basis: ComparisonBasis;
  evidence: {
    current_period: Period;
    previous_period: Period;
    business_calendar: string;
    calendar_profile: string;
    day_selection: DaySelection;
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
  basis?: ComparisonBasis;
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
      // Período dentro de um único mês calendário → "o mês anterior" é o mês
      // calendário anterior no MESMO recorte de dias, não a janela deslizante.
      const sameMonth = monthOf(current.from) === monthOf(current.to);
      const wantsWindow = req.comparison_basis === "preceding_window";
      const useCalendar = !wantsWindow && sameMonth;
      const previous = req.comparison_period
        ?? (useCalendar
          ? { from: shiftMonthKeep(current.from, -1), to: shiftMonthKeep(current.to, -1) }
          : { from: addDays(current.from, -size), to: addDays(current.from, -1) });
      const basis: ComparisonBasis = req.comparison_period
        ? "mode_default"
        : (useCalendar ? "calendar_previous_month" : "preceding_window");
      return {
        current, previous,
        methodology: basis === "calendar_previous_month"
          ? `Comparei ${current.from} a ${current.to} com o mesmo recorte de dias do mês calendário anterior (${previous.from} a ${previous.to}).`
          : `Comparei ${current.from} a ${current.to} com os ${size} dias imediatamente anteriores (${previous.from} a ${previous.to}).`,
        notes,
        basis,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Registro de métricas — sem `default => expense`
// ---------------------------------------------------------------------------
/**
 * Toda métrica declarada precisa ter implementação explícita. Métrica sem
 * implementação FALHA com `metric_not_implemented` — jamais cai silenciosamente
 * em despesa, que era a origem de respostas "corretas para a métrica errada".
 */
export type MetricSource = "ledger" | "external";

export const METRIC_REGISTRY: Record<ComparisonMetric, {
  source: MetricSource;
  label: string;
  unit: "BRL" | "percent" | "count";
  /** Métrica externa exige `valueResolver` (patrimônio, metas, compromissos). */
  requires_resolver: boolean;
}> = {
  expense: { source: "ledger", label: "gasto", unit: "BRL", requires_resolver: false },
  income: { source: "ledger", label: "entradas", unit: "BRL", requires_resolver: false },
  net: { source: "ledger", label: "resultado", unit: "BRL", requires_resolver: false },
  cash_flow: { source: "ledger", label: "fluxo de caixa", unit: "BRL", requires_resolver: false },
  savings_rate: { source: "ledger", label: "taxa de poupança", unit: "percent", requires_resolver: false },
  category_spend: { source: "ledger", label: "gasto na categoria", unit: "BRL", requires_resolver: false },
  merchant_spend: { source: "ledger", label: "gasto no estabelecimento", unit: "BRL", requires_resolver: false },
  transaction_count: { source: "ledger", label: "número de lançamentos", unit: "count", requires_resolver: false },
  average_ticket: { source: "ledger", label: "ticket médio", unit: "BRL", requires_resolver: false },
  card_spend: { source: "ledger", label: "gasto no cartão", unit: "BRL", requires_resolver: false },
  debt_payment: { source: "ledger", label: "pagamento de dívidas", unit: "BRL", requires_resolver: false },
  investment_flow: { source: "ledger", label: "aporte líquido em investimentos", unit: "BRL", requires_resolver: false },
  net_worth: { source: "external", label: "patrimônio líquido", unit: "BRL", requires_resolver: true },
  commitment_load: { source: "external", label: "carga de compromissos", unit: "BRL", requires_resolver: true },
  goal_progress: { source: "external", label: "progresso das metas", unit: "BRL", requires_resolver: true },
};

export class MetricNotImplementedError extends Error {
  readonly code = "metric_not_implemented";
  constructor(readonly metric: string, readonly detail: string) {
    super(`metric_not_implemented:${metric}:${detail}`);
  }
}

const DEBT_PAYMENT_KINDS = new Set(["debt_payment", "loan_payment"]);
const INVESTMENT_IN_KINDS = new Set(["investment_application"]);
const INVESTMENT_OUT_KINDS = new Set(["investment_redemption"]);

function merchantKeyOf(t: TransactionRow): string {
  const raw = (t as { merchant_name?: string | null }).merchant_name ?? t.description ?? "";
  return String(raw).trim().toLowerCase() || "sem estabelecimento";
}

function matchesScope(t: TransactionRow, req: FinancialComparisonRequest, attribution: Map<string, string | null>): boolean {
  const scope = req.scope ?? "overall";
  if (scope === "overall") return true;
  if (!req.subject_id) return true;
  switch (scope) {
    case "category": return effectiveCategoryId(t, attribution) === req.subject_id;
    case "merchant": {
      // Escopo de estabelecimento é EXCLUSIVO: identidade canônica, não substring solta.
      const key = merchantKeyOf(t);
      const subject = String(req.subject_id).trim().toLowerCase();
      return key === subject || key.split(/\s+/).join(" ").includes(subject);
    }
    case "card": return (t as { credit_card_id?: string | null }).credit_card_id === req.subject_id;
    case "account": return t.account_id === req.subject_id;
    default: return true;
  }
}

type DriverAxis = "category" | "merchant" | "flexibility" | "card" | "movement";

type Aggregate = {
  value: number;
  sample_size: number;
  transaction_days: Set<string>;
  byAxis: Map<DriverAxis, Map<string, number>>;
};

function bump(agg: Aggregate, axis: DriverAxis, label: string, amount: number) {
  const map = agg.byAxis.get(axis) ?? new Map<string, number>();
  map.set(label, round2((map.get(label) ?? 0) + amount));
  agg.byAxis.set(axis, map);
}

function aggregate(
  req: FinancialComparisonRequest,
  period: Period,
  ledger: TransactionRow[],
  attribution: Map<string, string | null>,
): Aggregate {
  const names = req.categoryNames ?? new Map<string, string>();
  const jur = req.jurisdiction ?? DEFAULT_JURISDICTION;
  const daySelection = resolveDaySelection(req);
  const meta = METRIC_REGISTRY[req.metric];
  if (!meta) throw new MetricNotImplementedError(req.metric, "metrica_desconhecida");
  const out: Aggregate = { value: 0, sample_size: 0, transaction_days: new Set(), byAxis: new Map() };
  let income = 0;
  let expense = 0;
  let count = 0;
  let cardExpense = 0;
  let debtPayment = 0;
  let investmentIn = 0;
  let investmentOut = 0;

  for (const t of ledger) {
    // Competência de relatório: compra de cartão pertence ao mês da fatura
    // (`competence_date`), o resto segue a data econômica. Mesma regra usada em
    // meta por categoria e fechamento mensal.
    const d = reportingCompetenceDate(t);
    if (d < period.from || d > period.to) continue;
    if (!includedByDaySelection(d, daySelection, jur)) continue;
    if (!matchesScope(t, req, attribution)) continue;
    const mk = String((t as { movement_kind?: string | null }).movement_kind ?? "transaction");
    const gross = Number(t.amount || 0);
    const confirmed = String(t.status ?? "confirmed") === "confirmed";

    // Movimentos patrimoniais/dívida não são "gasto comportamental", mas SÃO a
    // métrica quando a pergunta é sobre eles.
    if (confirmed && DEBT_PAYMENT_KINDS.has(mk)) debtPayment += gross;
    if (confirmed && INVESTMENT_IN_KINDS.has(mk)) investmentIn += gross;
    if (confirmed && INVESTMENT_OUT_KINDS.has(mk)) investmentOut += gross;
    if (confirmed && (DEBT_PAYMENT_KINDS.has(mk) || INVESTMENT_IN_KINDS.has(mk) || INVESTMENT_OUT_KINDS.has(mk))) {
      out.transaction_days.add(d);
      bump(out, "movement", mk, gross);
    }

    const inc = behavioralMetricAmount(t, "income");
    const exp = behavioralMetricAmount(t, "expense");
    if (inc === 0 && exp === 0) continue;
    income += inc;
    expense += exp;
    count += 1;
    const cardId = (t as { credit_card_id?: string | null }).credit_card_id ?? null;
    if (cardId) cardExpense += exp;
    out.transaction_days.add(d);
    if (exp !== 0) {
      const catId = effectiveCategoryId(t, attribution);
      const label = catId ? (names.get(catId) ?? "Sem categoria") : "Sem categoria";
      bump(out, "category", label, exp);
      bump(out, "merchant", merchantKeyOf(t), exp);
      bump(out, "flexibility", isStructuralLabel(label) ? "fixo" : "flexível", exp);
      if (cardId) bump(out, "card", cardId, exp);
    }
    if (inc !== 0) bump(out, "movement", "entrada", inc);
  }

  switch (req.metric) {
    case "income": out.value = round2(income); break;
    case "net":
    case "cash_flow": out.value = round2(income - expense); break;
    case "savings_rate": out.value = income > 0 ? round2(((income - expense) / income) * 100) : 0; break;
    case "transaction_count": out.value = count; break;
    case "average_ticket": out.value = count > 0 ? round2(expense / count) : 0; break;
    case "card_spend": out.value = round2(cardExpense); break;
    case "debt_payment": out.value = round2(debtPayment); break;
    case "investment_flow": out.value = round2(investmentIn - investmentOut); break;
    case "expense": out.value = round2(expense); break;
    case "category_spend":
    case "merchant_spend": {
      if (!req.subject_id) {
        throw new MetricNotImplementedError(req.metric, "subject_id_obrigatorio");
      }
      out.value = round2(expense);
      break;
    }
    case "net_worth":
    case "commitment_load":
    case "goal_progress":
      // Métricas de estoque/agenda não nascem do ledger: exigem `valueResolver`.
      throw new MetricNotImplementedError(req.metric, "value_resolver_obrigatorio");
    default:
      throw new MetricNotImplementedError(String(req.metric), "sem_implementacao");
  }
  out.sample_size = count || out.transaction_days.size;
  return out;
}

/** Rótulos estruturais (custo fixo) — espelha `classifyFlexibility` do custo. */
function isStructuralLabel(label: string): boolean {
  return /aluguel|condom|financ|presta|energia|luz|agua|água|internet|telefon|plano de saude|plano de saúde|escola|mensalidade|seguro|assinatura|streaming|academia/i
    .test(label);
}

function resolveDaySelection(req: FinancialComparisonRequest): DaySelection {
  if (req.day_selection) return req.day_selection;
  // O único modo cuja intenção é intrinsecamente "somente dias úteis".
  return req.mode === "SAME_BUSINESS_DAYS_RANGE" ? "BUSINESS_DAYS_ONLY" : "CHRONOLOGICAL";
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
/**
 * Drivers multi-eixo com RESIDUAL: a soma dos drivers de um eixo mais o
 * residual reconcilia exatamente a variação total. Sem residual, um top-8
 * mentia por omissão ("o aumento veio daí" quando vinha da cauda).
 */
function buildDrivers(
  req: FinancialComparisonRequest,
  aggC: Aggregate,
  aggP: Aggregate,
  deltaTotal: number,
): ComparisonDriver[] {
  const axes = req.driver_axes ?? ["category", "merchant", "flexibility"];
  const recurring = (req.recurring_labels ?? []).map((s) => s.toLowerCase());
  const total = Math.abs(deltaTotal) || 1;
  const out: ComparisonDriver[] = [];

  for (const axis of axes) {
    const cur = aggC.byAxis.get(axis) ?? new Map<string, number>();
    const pre = aggP.byAxis.get(axis) ?? new Map<string, number>();
    const keys = new Set<string>([...cur.keys(), ...pre.keys()]);
    const rows = [...keys].map((label) => {
      const c = cur.get(label) ?? 0;
      const p = pre.get(label) ?? 0;
      const d = round2(c - p);
      const isRecurring = recurring.includes(label.toLowerCase()) || isStructuralLabel(label);
      // Desaparecimento total de um desembolso recorrente é CALENDÁRIO, não hábito.
      const nature: DriverNature = isRecurring
        ? (d < 0 && c === 0 && p > 0 ? "timing" : "structural")
        : (Math.abs(d) > 0 ? "behavioral" : "unknown");
      const samples = Math.abs(c) > 0 && Math.abs(p) > 0 ? 2 : 1;
      return {
        key: `${axis}:${label.toLowerCase().replace(/\s+/g, "_")}`,
        label,
        driver_type: axis,
        nature,
        current: round2(c),
        previous: round2(p),
        delta_abs: d,
        delta_pct: p > 0 ? Math.round((d / p) * 10000) / 100 : null,
        share_of_delta: Math.round((Math.abs(d) / total) * 10000) / 10000,
        confidence: samples >= 2 ? "medium" : "low",
      } satisfies ComparisonDriver;
    }).sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));

    const top = rows.slice(0, 8);
    const explained = round2(top.reduce((s, r) => s + r.delta_abs, 0));
    const axisTotal = round2(rows.reduce((s, r) => s + r.delta_abs, 0));
    const residual = round2(axisTotal - explained);
    out.push(...top);
    if (Math.abs(residual) >= 0.01) {
      out.push({
        key: `${axis}:residual`,
        label: `Outros (${axis})`,
        driver_type: "residual",
        nature: "unknown",
        current: 0,
        previous: 0,
        delta_abs: residual,
        delta_pct: null,
        share_of_delta: Math.round((Math.abs(residual) / total) * 10000) / 10000,
        confidence: "low",
      });
    }
  }
  return out;
}


export function computeFinancialComparison(req: FinancialComparisonRequest): FinancialComparisonResult {
  const jur = req.jurisdiction ?? DEFAULT_JURISDICTION;
  const { current: cp, previous: pp, methodology, notes, basis } = resolvePeriods(req);
  const ledger = (req.txs ?? []).filter((t) => String(t.status ?? "confirmed") !== "superseded");
  const attribution = buildRefundAttribution(ledger);
  const allDates = [...new Set(ledger.map((t) => t.occurred_at.slice(0, 10)))].sort();

  const meta = METRIC_REGISTRY[req.metric];
  if (!meta) throw new MetricNotImplementedError(String(req.metric), "metrica_desconhecida");
  const external = req.valueResolver;
  if (meta.requires_resolver && !external) {
    throw new MetricNotImplementedError(req.metric, "value_resolver_obrigatorio");
  }
  const emptyAgg = (): Aggregate => ({ value: 0, sample_size: 0, transaction_days: new Set(), byAxis: new Map() });
  const aggC = meta.source === "external" ? emptyAgg() : aggregate(req, cp, ledger, attribution);
  const aggP = meta.source === "external" ? emptyAgg() : aggregate(req, pp, ledger, attribution);
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

  const drivers = buildDrivers(req, aggC, aggP, delta_abs);
  const daySelection = resolveDaySelection(req);

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

  // A metodologia é PARTE DA RESPOSTA: métrica + recorte + seleção de dias.
  const fullMethodology = `${METRIC_REGISTRY[req.metric].label}: ${methodology} Considerei ${DAY_SELECTION_LABEL_PT[daySelection]}`
    + (daySelection === "BUSINESS_DAYS_ONLY"
      ? ` (${current.business_days} dias úteis contra ${previous.business_days}).`
      : ` (${current.days} dias contra ${previous.days}).`);

  return {
    metric: req.metric,
    scope: req.scope ?? "overall",
    subject_id: req.subject_id ?? null,
    subject_label: req.subject_label ?? null,
    mode: req.mode,
    day_selection: daySelection,
    current,
    previous,
    delta_abs,
    delta_pct,
    direction: delta_abs > 0 ? "up" : delta_abs < 0 ? "down" : "flat",
    comparability,
    confidence,
    drivers,
    exclusions: [...CANONICAL_EXCLUSIONS, REFUND_EXCLUSION],
    methodology: fullMethodology,
    comparison_basis: basis ?? "mode_default",
    evidence: {
      current_period: cp,
      previous_period: pp,
      business_calendar: BRAZILIAN_CALENDAR_VERSION,
      calendar_profile: profileOf(jur),
      day_selection: daySelection,
      jurisdiction: jur,
      notes,
    },
    formula_version: FINANCIAL_COMPARISON_VERSION,
  };
}

