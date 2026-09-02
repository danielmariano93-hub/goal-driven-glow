// Financial Query IR (`nino_semantic_ir.v2`)
// O Semantic Compiler emite esta linguagem. Nunca nomes de tools.

export const FINANCIAL_METRICS = [
  "expense_amount",
  "income_amount",
  "balance",
  "net_worth",
  "debt_balance",
  "goal_progress",
  "future_installments",
  "financial_health",
] as const;
export type FinancialMetric = typeof FINANCIAL_METRICS[number];

export const FINANCIAL_DIMENSIONS = [
  "category", "merchant", "card", "account", "month", "weekday",
] as const;
export type FinancialDimension = typeof FINANCIAL_DIMENSIONS[number];

export const FINANCIAL_OPERATIONS = [
  "value", "sum", "rank", "breakdown", "compare", "trend", "forecast", "explain",
] as const;
export type FinancialOperation = typeof FINANCIAL_OPERATIONS[number];

export type FinancialFilter = {
  field: "category" | "card" | "account" | "payment_method";
  op: "eq";
  value: string;
};

export type FinancialQuery = {
  id: string;
  metric: FinancialMetric;
  operation: FinancialOperation;
  group_by: FinancialDimension[];
  filters: FinancialFilter[];
  limit: number | null;
};

export type CanonicalPeriod = { from: string; to: string; label: string };

export type FinancialQueryIR = {
  version: "financial_query_ir.v1";
  intent: "lookup" | "analyze" | "investigate" | "unsupported";
  needs_clarification: string[];
  assumptions: string[];
  /**
   * Envelope já nasce como array para não criar breaking change depois, mas a
   * v1 executa UMA query canônica por turno. Multi-query determinístico fica
   * explicitamente fora do rollout inicial.
   */
  queries: FinancialQuery[];
  completeness_targets: string[];
  period: CanonicalPeriod;
  comparison_period: CanonicalPeriod | null;
  source: "fast_path" | "semantic_compiler";
  unsupported_reason: string | null;
};

const METRICS = new Set<string>(FINANCIAL_METRICS);
const DIMS = new Set<string>(FINANCIAL_DIMENSIONS);
const OPS = new Set<string>(FINANCIAL_OPERATIONS);
const FILTER_FIELDS = new Set(["category", "card", "account", "payment_method"]);

export function validateFinancialIR(value: unknown): string[] {
  const errors: string[] = [];
  const ir = value as Partial<FinancialQueryIR> | null;
  if (!ir || typeof ir !== "object") return ["ir_not_object"];
  if (!["lookup", "analyze", "investigate", "unsupported"].includes(String(ir.intent))) {
    errors.push("intent_invalid");
  }
  const queries = Array.isArray(ir.queries) ? ir.queries : [];
  if (ir.intent === "unsupported") {
    if (queries.length !== 0) errors.push("unsupported_must_have_zero_queries");
    return errors;
  }
  // Rollout v1: fail closed em consulta composta, em vez de executar metade.
  if (queries.length !== 1) {
    errors.push("v1_requires_exactly_one_query");
    return errors;
  }
  const q = queries[0];
  if (!q || typeof q !== "object") return [...errors, "q0_invalid"];
  if (!METRICS.has(String(q.metric))) errors.push("q0_metric_invalid");
  if (!OPS.has(String(q.operation))) errors.push("q0_operation_invalid");
  if (!Array.isArray(q.group_by) || q.group_by.length > 1 || q.group_by.some((d) => !DIMS.has(String(d)))) {
    errors.push("q0_group_by_invalid");
  }
  if (!Array.isArray(q.filters)) {
    errors.push("q0_filters_invalid");
  } else {
    const seen = new Set<string>();
    for (const f of q.filters) {
      if (!FILTER_FIELDS.has(String(f?.field)) || f?.op !== "eq" || typeof f?.value !== "string" || !f.value.trim()) {
        errors.push("q0_filter_invalid");
        break;
      }
      if (seen.has(f.field)) errors.push("q0_duplicate_filter");
      seen.add(f.field);
    }
  }
  if (q.limit != null && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 20)) {
    errors.push("q0_limit_invalid");
  }
  return errors;
}

export function fastFinancialIR(
  text: string,
  period: { from: string; to: string; label?: string },
  comparisonPeriod?: { from: string; to: string; label?: string } | null,
): FinancialQueryIR | null {
  const t = String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const make = (metric: FinancialMetric, target: string): FinancialQueryIR => ({
    version: "financial_query_ir.v1",
    intent: "lookup",
    needs_clarification: [],
    assumptions: [],
    queries: [{ id: "q1", metric, operation: "value", group_by: [], filters: [], limit: null }],
    completeness_targets: [target],
    period: { from: period.from, to: period.to, label: period.label ?? "período solicitado" },
    comparison_period: comparisonPeriod
      ? { from: comparisonPeriod.from, to: comparisonPeriod.to, label: comparisonPeriod.label ?? "período anterior comparável" }
      : null,
    source: "fast_path",
    unsupported_reason: null,
  });
  if (/^(qual (e )?(o )?)?(meu )?saldo\??$/.test(t) || /^quanto (eu )?tenho disponivel\??$/.test(t)) {
    return make("balance", "q1.balance");
  }
  if (/^(qual (e )?(o )?)?(meu )?patrimonio( liquido)?\??$/.test(t)) {
    return make("net_worth", "q1.net_worth");
  }
  if (/^quanto (eu )?devo\??$/.test(t)) {
    return make("debt_balance", "q1.debt_balance");
  }
  return null;
}

export function withCanonicalPeriods(
  ir: FinancialQueryIR,
  period: { from: string; to: string; label?: string },
  comparisonPeriod?: { from: string; to: string; label?: string } | null,
): FinancialQueryIR {
  return {
    ...ir,
    period: { from: period.from, to: period.to, label: period.label ?? "período solicitado" },
    comparison_period: comparisonPeriod
      ? { from: comparisonPeriod.from, to: comparisonPeriod.to, label: comparisonPeriod.label ?? "período anterior comparável" }
      : null,
  };
}
