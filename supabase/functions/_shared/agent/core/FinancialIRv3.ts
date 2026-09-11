// financial_query_ir.v3 (`nino_semantic_ir.v4`)
//
// Contrato COMPOSICIONAL de leitura financeira. A causa-raiz que este arquivo
// fecha: no v2 uma query era `metric × operation × group_by × filters` e o
// período era UM envelope global. Então "quanto eu gasto com alimentação por
// mês?" (hábito, 6 meses fechados, mediana) e "quanto gastei com alimentação?"
// (mês corrente parcial, soma) compilavam para a MESMA query — e o Nino
// respondia o parcial do mês como se fosse o hábito.
//
// No v3 cada query declara explicitamente:
//   metric   — o que medir
//   filters  — sobre o que (preservado ou fail closed, nunca descartado)
//   time     — QUAL recorte temporal, com aspecto semântico
//   grain    — granularidade da série (nenhuma, dia, mês)
//   reduce   — como colapsar a série (soma, típico, média, mediana, taxa)
//   group_by — dimensão de quebra
//
// v1/v2 continuam válidos como ENTRADA: `normalizeToV3` canonicaliza. Nunca
// existem duas semânticas vivas — só um canonicalizer.
import {
  FINANCIAL_DIMENSIONS,
  FINANCIAL_METRICS,
  type CanonicalPeriod,
  type CompletenessTarget,
  type FinancialDimension,
  type FinancialFilter,
  type FinancialMetric,
  type FinancialQueryIR,
  type FinancialQueryIRv2,
  type IRDialogueState,
  MAX_IR_QUERIES,
  normalizeToV2,
} from "./FinancialQueryIR.ts";

export const TIME_ASPECTS = [
  /** Estado num instante (saldo, patrimônio, dívida hoje). */
  "point_in_time",
  /** Mês corrente até hoje — parcial e declarado como parcial. */
  "mtd",
  /** Mês/meses de calendário fechados e explícitos. */
  "calendar",
  /** Janela móvel de N dias terminando hoje. */
  "rolling",
  /** Últimos N meses COMPLETOS, mês corrente excluído. */
  "last_n_complete",
  /** Comportamento habitual/típico — sempre sobre meses completos. */
  "habitual",
  /** Projeção de fechamento do período corrente. */
  "projection",
  /** Trajetória ao longo do tempo. */
  "trend",
] as const;
export type TimeAspect = typeof TIME_ASPECTS[number];

export const TIME_GRAINS = ["none", "day", "month"] as const;
export type TimeGrain = typeof TIME_GRAINS[number];

export const REDUCTIONS = ["none", "sum", "typical", "mean", "median", "rate"] as const;
export type Reduction = typeof REDUCTIONS[number];

export type IRTime = {
  aspect: TimeAspect;
  /** Datas resolvidas pelo resolver determinístico (nunca pela LLM). */
  from: string | null;
  to: string | null;
  /** Número de meses/dias da janela, quando o aspecto usa janela. */
  n: number | null;
  /** Mês corrente fora da janela (obrigatório em habitual/last_n_complete). */
  exclude_partial: boolean;
  label: string;
};

export type FinancialQueryV3 = {
  id: string;
  metric: FinancialMetric;
  filters: FinancialFilter[];
  time: IRTime;
  grain: TimeGrain;
  reduce: Reduction;
  group_by: FinancialDimension[];
  limit: number | null;
  depends_on: string[];
  /** Operação legada preservada só para o canonicalizer/compat. */
  legacy_operation: string | null;
};

export type FinancialQueryIRv3 = {
  version: "financial_query_ir.v3";
  intent: FinancialQueryIR["intent"];
  dialogue: IRDialogueState;
  needs_clarification: string[];
  assumptions: string[];
  queries: FinancialQueryV3[];
  completeness_targets: CompletenessTarget[];
  /** Período do turno — referência humana; a verdade executável é `query.time`. */
  period: CanonicalPeriod;
  comparison_period: CanonicalPeriod | null;
  source: FinancialQueryIR["source"];
  unsupported_reason: string | null;
};

const METRICS = new Set<string>(FINANCIAL_METRICS);
const DIMS = new Set<string>(FINANCIAL_DIMENSIONS);
const ASPECTS = new Set<string>(TIME_ASPECTS);
const GRAINS = new Set<string>(TIME_GRAINS);
const REDUCES = new Set<string>(REDUCTIONS);
const FILTER_FIELDS = new Set(["category", "card", "account", "payment_method"]);

const POINT_IN_TIME_METRICS = new Set<string>([
  "balance", "net_worth", "debt_balance", "goal_progress", "future_installments", "financial_health",
]);

/** Aspecto + redução implícitos numa operação v1/v2. */
function aspectFromLegacy(
  operation: string,
  metric: FinancialMetric,
  period: CanonicalPeriod | null,
  today: string,
): { aspect: TimeAspect; grain: TimeGrain; reduce: Reduction } {
  if (POINT_IN_TIME_METRICS.has(metric)) {
    return { aspect: "point_in_time", grain: "none", reduce: "none" };
  }
  if (operation === "trend") return { aspect: "trend", grain: "month", reduce: "none" };
  if (operation === "forecast") return { aspect: "projection", grain: "none", reduce: "sum" };
  const partial = !!period && period.from <= today && period.to >= today;
  return {
    aspect: partial ? "mtd" : "calendar",
    grain: "none",
    reduce: operation === "value" ? "sum" : "sum",
  };
}

/**
 * Canonicaliza v1 / v2 / v3-parcial para o contrato v3. O período do envelope
 * desce para CADA query — é o que torna período uma propriedade da pergunta e
 * não do turno.
 */
export function normalizeToV3(
  ir: FinancialQueryIR | FinancialQueryIRv2 | FinancialQueryIRv3 | Record<string, unknown>,
  opts?: { dialogue?: Partial<IRDialogueState>; today?: string },
): FinancialQueryIRv3 {
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  const raw = ir as Record<string, unknown>;
  const v2 = normalizeToV2(ir as FinancialQueryIR, opts?.dialogue);
  const rawQueries = Array.isArray(raw.queries) ? (raw.queries as Record<string, unknown>[]) : [];

  const queries: FinancialQueryV3[] = v2.queries.map((q, index) => {
    const source = rawQueries[index] ?? {};
    const declaredTime = source.time as Partial<IRTime> | undefined;
    const legacyOperation = String(q.operation ?? "");
    const inferred = aspectFromLegacy(legacyOperation, q.metric, v2.period ?? null, today);
    const aspect = ASPECTS.has(String(declaredTime?.aspect)) ? declaredTime!.aspect as TimeAspect : inferred.aspect;
    const grain = GRAINS.has(String(source.grain)) ? source.grain as TimeGrain : inferred.grain;
    const reduce = REDUCES.has(String(source.reduce)) ? source.reduce as Reduction : inferred.reduce;
    const windowed = aspect === "habitual" || aspect === "last_n_complete";
    return {
      id: q.id,
      metric: q.metric,
      filters: q.filters ?? [],
      time: {
        aspect,
        from: declaredTime?.from ?? v2.period?.from ?? null,
        to: declaredTime?.to ?? v2.period?.to ?? null,
        n: declaredTime?.n ?? (windowed ? 6 : null),
        exclude_partial: windowed ? true : Boolean(declaredTime?.exclude_partial),
        label: String(declaredTime?.label ?? v2.period?.label ?? "período solicitado"),
      },
      grain,
      reduce,
      group_by: q.group_by ?? [],
      limit: q.limit ?? null,
      depends_on: q.depends_on ?? [],
      legacy_operation: legacyOperation || null,
    };
  });

  return {
    version: "financial_query_ir.v3",
    intent: v2.intent,
    dialogue: v2.dialogue,
    needs_clarification: v2.needs_clarification,
    assumptions: v2.assumptions,
    queries,
    completeness_targets: v2.completeness_targets,
    period: v2.period,
    comparison_period: v2.comparison_period,
    source: v2.source,
    unsupported_reason: v2.unsupported_reason,
  };
}

/**
 * Validação estrutural do v3. Combinação incoerente é IR INVÁLIDO — nunca
 * corrigida em silêncio, porque correção silenciosa é exatamente como o Nino
 * respondia uma pergunta diferente da feita.
 */
export function validateFinancialIRv3(value: unknown): string[] {
  const errors: string[] = [];
  const ir = value as Partial<FinancialQueryIRv3> | null;
  if (!ir || typeof ir !== "object") return ["ir_not_object"];
  if (!["lookup", "analyze", "investigate", "unsupported"].includes(String(ir.intent))) {
    errors.push("intent_invalid");
  }
  const queries = Array.isArray(ir.queries) ? ir.queries : [];
  if (ir.intent === "unsupported") {
    if (queries.length !== 0) errors.push("unsupported_must_have_zero_queries");
    return errors;
  }
  if (queries.length === 0) return [...errors, "queries_empty"];
  if (queries.length > MAX_IR_QUERIES) errors.push("queries_over_limit");

  const ids = new Set<string>();
  for (const q of queries.slice(0, MAX_IR_QUERIES)) {
    const id = String(q?.id ?? "");
    if (!id) { errors.push("query_id_missing"); continue; }
    if (ids.has(id)) errors.push(`duplicate_query_id:${id}`);
    ids.add(id);
    if (!METRICS.has(String(q.metric))) errors.push(`${id}_metric_invalid`);
    if (!GRAINS.has(String(q.grain))) errors.push(`${id}_grain_invalid`);
    if (!REDUCES.has(String(q.reduce))) errors.push(`${id}_reduce_invalid`);
    if (!Array.isArray(q.group_by) || q.group_by.length > 1 || q.group_by.some((d) => !DIMS.has(String(d)))) {
      errors.push(`${id}_group_by_invalid`);
    }
    if (!Array.isArray(q.filters)) errors.push(`${id}_filters_invalid`);
    else {
      const seen = new Set<string>();
      for (const f of q.filters) {
        if (!FILTER_FIELDS.has(String(f?.field)) || f?.op !== "eq"
          || typeof f?.value !== "string" || !f.value.trim()) {
          errors.push(`${id}_filter_invalid`);
          break;
        }
        if (seen.has(f.field)) errors.push(`${id}_duplicate_filter`);
        seen.add(f.field);
      }
    }
    if (q.limit != null && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 20)) {
      errors.push(`${id}_limit_invalid`);
    }

    const time = q.time;
    if (!time || typeof time !== "object" || !ASPECTS.has(String(time.aspect))) {
      errors.push(`${id}_time_invalid`);
      continue;
    }
    // Combinações proibidas — o coração do contrato.
    if ((time.aspect === "habitual" || time.aspect === "last_n_complete")) {
      if (q.grain !== "month") errors.push(`${id}_habitual_requires_month_grain`);
      if (!time.exclude_partial) errors.push(`${id}_habitual_requires_exclude_partial`);
      if (!Number.isInteger(time.n) || (time.n as number) < 2) errors.push(`${id}_habitual_requires_window`);
    }
    if ((q.reduce === "typical" || q.reduce === "median" || q.reduce === "mean") && q.grain === "none") {
      errors.push(`${id}_statistic_requires_series`);
    }
    if (q.reduce === "typical" && time.aspect !== "habitual" && time.aspect !== "last_n_complete") {
      errors.push(`${id}_typical_requires_complete_window`);
    }
    if (time.aspect === "point_in_time" && q.reduce !== "none") errors.push(`${id}_point_in_time_reduce_invalid`);
    if (time.aspect === "mtd" && time.exclude_partial) errors.push(`${id}_mtd_cannot_exclude_partial`);
    if (time.aspect === "rolling" && (!Number.isInteger(time.n) || (time.n as number) < 1)) {
      errors.push(`${id}_rolling_requires_days`);
    }
    if (POINT_IN_TIME_METRICS.has(String(q.metric)) && q.grain !== "none"
      && time.aspect !== "trend" && time.aspect !== "projection") {
      errors.push(`${id}_state_metric_with_series`);
    }
    if (!POINT_IN_TIME_METRICS.has(String(q.metric)) && time.aspect !== "trend"
      && (!time.from || !time.to)) {
      errors.push(`${id}_time_range_missing`);
    }
  }

  for (const q of queries) {
    for (const dep of q.depends_on ?? []) {
      if (dep === q.id) errors.push(`${q.id}_depends_on_self`);
      else if (!ids.has(dep)) errors.push(`${q.id}_depends_on_missing:${dep}`);
    }
  }

  for (const t of Array.isArray(ir.completeness_targets) ? ir.completeness_targets : []) {
    if (!t || typeof t !== "object") { errors.push("target_invalid"); continue; }
    if (!ids.has(String(t.query_id))) errors.push(`target_query_missing:${String(t.id ?? "?")}`);
  }
  return errors;
}

/** Shape canônico do "gasto típico mensal" (Fase 5). */
export function isTypicalMonthlyShape(q: FinancialQueryV3): boolean {
  return q.metric === "expense_amount"
    && q.grain === "month"
    && (q.time.aspect === "habitual" || q.time.aspect === "last_n_complete")
    && (q.reduce === "typical" || q.reduce === "median" || q.reduce === "mean")
    && (q.group_by?.length ?? 0) === 0;
}
