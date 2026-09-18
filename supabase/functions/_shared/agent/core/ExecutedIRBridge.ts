// ExecutedIRBridge (`nino_semantic_ir.v4`)
//
// Traduz o RESULTADO real de uma engine em `executed_ir` — o que de fato foi
// calculado. Sem isso, o gate de preservação não tem como saber que a engine
// respondeu outro recorte, e um filtro perdido virava "resposta confiante".
//
// Duas fontes, nesta ordem:
// 1. `result.executed_ir` declarado pela própria engine (verdade preferida);
// 2. leitura estrutural de resultados canônicos que já carregam período e
//    filtros (`spending_report`) — derivação determinística, nunca invenção.
// Nada além disso: engine que não declara nem carrega estrutura devolve `null`
// e a preservação falha fechada.
import type { FinancialQueryV3 } from "./FinancialIRv3.ts";
import type { ExecutedIR } from "./SemanticPreservation.ts";
import type { FinancialFilter } from "./FinancialQueryIR.ts";

const FILTER_FIELDS = ["category", "card", "account", "payment_method"] as const;

function filtersFromRecord(raw: unknown): FinancialFilter[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out: FinancialFilter[] = [];
  for (const field of FILTER_FIELDS) {
    const value = obj[field];
    if (value == null || value === "") continue;
    out.push({ field, op: "eq", value: String(value) });
  }
  return out;
}

function declared(result: unknown): ExecutedIR | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const e = r.executed_ir as Partial<ExecutedIR> | undefined;
  if (!e || typeof e !== "object" || !e.metric || !e.time) return null;
  return {
    metric: String(e.metric),
    filters: Array.isArray(e.filters) ? e.filters as FinancialFilter[] : [],
    time: {
      aspect: e.time.aspect!,
      from: e.time.from ?? null,
      to: e.time.to ?? null,
      n: e.time.n ?? null,
      exclude_partial: Boolean(e.time.exclude_partial),
    },
    grain: (e.grain ?? "none") as ExecutedIR["grain"],
    reduce: (e.reduce ?? "sum") as ExecutedIR["reduce"],
    group_by: Array.isArray(e.group_by) ? e.group_by.map(String) : [],
    comparison_baseline: e.comparison_baseline ?? "period",
    comparison_baseline_window: e.comparison_baseline_window ?? null,
    partial: Boolean(e.partial),
  };
}

/** Derivação estrutural de compare_periods. */
function fromPeriodComparison(requested: FinancialQueryV3, result: unknown): ExecutedIR | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.total_a == null || r.total_b == null || !Array.isArray(r.by_group)) return null;
  if (requested.legacy_operation !== "compare") return null;
  const requestedGroup = String(r.requested_group_by ?? "none") === "category" ? ["category"] : [];
  return {
    metric: requested.metric,
    filters: [],
    time: {
      aspect: requested.time.aspect,
      from: requested.time.from,
      to: requested.time.to,
      n: requested.time.n,
      exclude_partial: requested.time.exclude_partial,
    },
    grain: requested.grain,
    reduce: requested.reduce,
    group_by: requestedGroup,
    comparison_baseline: "period",
    comparison_baseline_window: null,
    partial: false,
  };
}

/** Derivação estrutural da comparação contra média histórica. */
function fromMonthlyAverageComparison(requested: FinancialQueryV3, result: unknown): ExecutedIR | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.baseline_statistic !== "mean" || !Array.isArray(r.by_group)) return null;
  if (requested.legacy_operation !== "compare") return null;
  const target = (r.target_period ?? {}) as Record<string, unknown>;
  return {
    metric: requested.metric,
    filters: [],
    time: {
      aspect: requested.time.aspect,
      from: target.from ? String(target.from) : requested.time.from,
      to: target.to ? String(target.to) : requested.time.to,
      n: requested.time.n,
      exclude_partial: requested.time.exclude_partial,
    },
    grain: requested.grain,
    reduce: requested.reduce,
    group_by: String(r.requested_group_by ?? "none") === "category" ? ["category"] : [],
    comparison_baseline: "mean_previous_complete_months",
    comparison_baseline_window: Number(r.baseline_window_months ?? r.requested_comparison_baseline_window ?? 0) || null,
    partial: false,
  };
}

/** Derivação estrutural da distribuição por estabelecimento. */
function fromMerchantDistribution(requested: FinancialQueryV3, result: unknown): ExecutedIR | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.engine !== "merchant_distribution" || !Array.isArray(r.merchants)) return null;
  const period = (r.period ?? {}) as Record<string, unknown>;
  const category = (r.category ?? {}) as Record<string, unknown>;
  const filters: FinancialFilter[] = [];
  if (category.name) filters.push({ field: "category", op: "eq", value: String(category.name) });
  return {
    metric: requested.metric,
    filters,
    time: {
      aspect: requested.time.aspect,
      from: period.from ? String(period.from) : null,
      to: period.to ? String(period.to) : null,
      n: requested.time.n,
      exclude_partial: requested.time.exclude_partial,
    },
    grain: requested.grain,
    reduce: requested.reduce,
    group_by: ["merchant"],
    comparison_baseline: requested.comparison_baseline ?? "period",
    comparison_baseline_window: requested.comparison_baseline_window ?? null,
    partial: false,
  };
}

/** Derivação estrutural de `spending_report` (analyze_spending). */
function fromSpendingReport(requested: FinancialQueryV3, result: unknown): ExecutedIR | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.kind !== "spending_report") return null;
  const period = (r.period ?? {}) as Record<string, unknown>;
  return {
    // A engine fala "expense"/"income"; o contrato fala `expense_amount`.
    metric: r.metric === "income" ? "income_amount" : r.metric === "expense" ? "expense_amount" : String(r.metric ?? requested.metric),
    filters: filtersFromRecord(r.filters),
    time: {
      aspect: requested.time.aspect,
      from: period.from ? String(period.from) : null,
      to: period.to ? String(period.to) : null,
      n: requested.time.n,
      exclude_partial: requested.time.exclude_partial,
    },
    grain: requested.grain,
    reduce: requested.reduce,
    // `breakdown` é a renderização DEFAULT da engine: quando a pergunta não
    // pediu dimensão, isso não é troca de recorte — só apresentação. Dimensão
    // pedida é comparada de verdade.
    group_by: (requested.group_by ?? []).length
      ? [String(r.group_by ?? "category")]
      : [],
    partial: r.data_limit === "no_data",
  };
}

export function executedIRFrom(
  requested: FinancialQueryV3,
  result: unknown,
): ExecutedIR | null {
  return declared(result)
    ?? fromMonthlyAverageComparison(requested, result)
    ?? fromPeriodComparison(requested, result)
    ?? fromMerchantDistribution(requested, result)
    ?? fromSpendingReport(requested, result);
}
