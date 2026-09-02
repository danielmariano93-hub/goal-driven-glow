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

// ---------------------------------------------------------------------------
// financial_query_ir.v2 (`nino_semantic_ir.v3`)
// Multi-query com dependências, dialogue state multi-label e
// completeness_targets como objetos verificáveis.
// ---------------------------------------------------------------------------

export const MAX_IR_QUERIES = 4;

export const DIALOGUE_ACT_LABELS = [
  "new_query", "repair", "clarification", "followup", "constraint_update", "write", "conversational",
] as const;
export type DialogueActLabel = typeof DIALOGUE_ACT_LABELS[number];

export type IRDialogueState = {
  acts: DialogueActLabel[];
  topic_id: string | null;
  inherits_from_topic_id: string | null;
};

export const EVIDENCE_CLAIM_TYPES = [
  "money", "percentage", "rank", "entity", "absence", "count", "period", "direction",
] as const;
export type EvidenceClaimType = typeof EVIDENCE_CLAIM_TYPES[number];

export type CompletenessTarget = {
  id: string;
  query_id: string;
  claim: EvidenceClaimType;
  required: boolean;
};

export type FinancialQueryV2 = FinancialQuery & { depends_on: string[] };

export type FinancialQueryIRv2 = {
  version: "financial_query_ir.v2";
  intent: FinancialQueryIR["intent"];
  dialogue: IRDialogueState;
  needs_clarification: string[];
  assumptions: string[];
  queries: FinancialQueryV2[];
  completeness_targets: CompletenessTarget[];
  period: CanonicalPeriod;
  comparison_period: CanonicalPeriod | null;
  source: FinancialQueryIR["source"];
  unsupported_reason: string | null;
};

const CLAIM_TYPES = new Set<string>(EVIDENCE_CLAIM_TYPES);

function defaultClaimFor(q: FinancialQuery): EvidenceClaimType {
  if (q.operation === "rank") return "rank";
  if (q.operation === "breakdown") return "rank";
  if (q.operation === "compare") return "direction";
  if (q.operation === "explain") return "direction";
  return "money";
}

/** Normaliza v1 (ou v2 parcial) para o contrato v2, sem inventar semântica. */
export function normalizeToV2(
  ir: FinancialQueryIR | FinancialQueryIRv2,
  dialogue?: Partial<IRDialogueState>,
): FinancialQueryIRv2 {
  const any = ir as Record<string, unknown>;
  const queries: FinancialQueryV2[] = (Array.isArray(any.queries) ? any.queries : []).map((raw, index) => {
    const q = raw as FinancialQueryV2;
    return {
      id: String(q?.id ?? `q${index + 1}`),
      metric: q?.metric,
      operation: q?.operation,
      group_by: Array.isArray(q?.group_by) ? q.group_by : [],
      filters: Array.isArray(q?.filters) ? q.filters : [],
      limit: q?.limit ?? null,
      depends_on: Array.isArray(q?.depends_on) ? q.depends_on.map(String) : [],
    };
  });
  const rawTargets = Array.isArray(any.completeness_targets) ? any.completeness_targets : [];
  const targets: CompletenessTarget[] = rawTargets.map((raw, index) => {
    if (raw && typeof raw === "object") {
      const t = raw as CompletenessTarget;
      return {
        id: String(t.id ?? `t${index + 1}`),
        query_id: String(t.query_id ?? queries[0]?.id ?? "q1"),
        claim: CLAIM_TYPES.has(String(t.claim)) ? t.claim : defaultClaimFor(queries[0] ?? ({} as FinancialQuery)),
        required: t.required !== false,
      };
    }
    // v1: alvo era string tipo "q1.result".
    const label = String(raw ?? `t${index + 1}`);
    const queryId = label.includes(".") ? label.split(".")[0] : (queries[0]?.id ?? "q1");
    const query = queries.find((q) => q.id === queryId) ?? queries[0];
    return {
      id: label,
      query_id: query?.id ?? queryId,
      claim: query ? defaultClaimFor(query) : "money",
      required: true,
    };
  });
  const existingDialogue = (any.dialogue ?? {}) as Partial<IRDialogueState>;
  return {
    version: "financial_query_ir.v2",
    intent: (any.intent as FinancialQueryIR["intent"]) ?? "unsupported",
    dialogue: {
      acts: Array.isArray(dialogue?.acts) && dialogue!.acts!.length
        ? dialogue!.acts!
        : (Array.isArray(existingDialogue.acts) ? existingDialogue.acts : ["new_query"]),
      topic_id: dialogue?.topic_id ?? existingDialogue.topic_id ?? null,
      inherits_from_topic_id: dialogue?.inherits_from_topic_id ?? existingDialogue.inherits_from_topic_id ?? null,
    },
    needs_clarification: Array.isArray(any.needs_clarification) ? (any.needs_clarification as string[]) : [],
    assumptions: Array.isArray(any.assumptions) ? (any.assumptions as string[]) : [],
    queries,
    completeness_targets: targets,
    period: any.period as CanonicalPeriod,
    comparison_period: (any.comparison_period ?? null) as CanonicalPeriod | null,
    source: (any.source as FinancialQueryIR["source"]) ?? "semantic_compiler",
    unsupported_reason: (any.unsupported_reason ?? null) as string | null,
  };
}

function queryKey(q: FinancialQueryV2): string {
  const filters = [...q.filters]
    .map((f) => `${f.field}:${f.op}:${String(f.value).toLowerCase()}`)
    .sort()
    .join("|");
  return `${q.metric}/${q.operation}/${[...q.group_by].sort().join("+")}/${filters}/${q.limit ?? "null"}`;
}

/**
 * Validação estrutural do IR v2. Inconsistência é IR INVÁLIDO — nunca correção
 * silenciosa (que era como o Nino respondia outra pergunta sem ninguém ver).
 */
export function validateFinancialIRv2(value: unknown): string[] {
  const errors: string[] = [];
  const ir = value as Partial<FinancialQueryIRv2> | null;
  if (!ir || typeof ir !== "object") return ["ir_not_object"];
  if (!["lookup", "analyze", "investigate", "unsupported"].includes(String(ir.intent))) {
    errors.push("intent_invalid");
  }
  const queries = Array.isArray(ir.queries) ? (ir.queries as FinancialQueryV2[]) : [];
  if (ir.intent === "unsupported") {
    if (queries.length !== 0) errors.push("unsupported_must_have_zero_queries");
    return errors;
  }
  if (queries.length === 0) return [...errors, "queries_empty"];
  if (queries.length > MAX_IR_QUERIES) errors.push("queries_over_limit");

  const ids = new Set<string>();
  const shapes = new Set<string>();
  for (const q of queries.slice(0, MAX_IR_QUERIES)) {
    const id = String(q?.id ?? "");
    if (!id) { errors.push("query_id_missing"); continue; }
    if (ids.has(id)) errors.push(`duplicate_query_id:${id}`);
    ids.add(id);
    if (!METRICS.has(String(q.metric))) errors.push(`${id}_metric_invalid`);
    if (!OPS.has(String(q.operation))) errors.push(`${id}_operation_invalid`);
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
    // Combinações inválidas de métrica/operação/dimensão.
    if (q.operation === "compare" && !ir.comparison_period) errors.push(`${id}_compare_without_comparison_period`);
    if (q.operation === "explain" && !ir.comparison_period) errors.push(`${id}_explain_without_base`);
    if (["value", "sum"].includes(String(q.operation)) && (q.group_by?.length ?? 0) > 0) {
      errors.push(`${id}_value_with_group_by`);
    }
    if (["rank", "breakdown"].includes(String(q.operation)) && (q.group_by?.length ?? 0) === 0) {
      errors.push(`${id}_rank_without_dimension`);
    }
    if (q.metric === "financial_health" && q.operation !== "value") errors.push(`${id}_health_operation_invalid`);
    const shape = queryKey(q);
    if (shapes.has(shape)) errors.push(`duplicate_query:${id}`);
    shapes.add(shape);
  }

  // Dependências: existir, sem auto-referência e sem ciclo.
  for (const q of queries) {
    for (const dep of q.depends_on ?? []) {
      if (dep === q.id) errors.push(`${q.id}_depends_on_self`);
      else if (!ids.has(dep)) errors.push(`${q.id}_depends_on_missing:${dep}`);
    }
  }
  if (hasCycle(queries)) errors.push("dependency_cycle");

  const targets = Array.isArray(ir.completeness_targets) ? ir.completeness_targets : [];
  for (const t of targets) {
    if (!t || typeof t !== "object") { errors.push("target_invalid"); continue; }
    if (!ids.has(String(t.query_id))) errors.push(`target_query_missing:${String(t.id ?? "?")}`);
    if (!CLAIM_TYPES.has(String(t.claim))) errors.push(`target_claim_invalid:${String(t.id ?? "?")}`);
  }
  return errors;
}

function hasCycle(queries: FinancialQueryV2[]): boolean {
  const byId = new Map(queries.map((q) => [q.id, q.depends_on ?? []]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const current = state.get(id) ?? 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(id, 1);
    for (const dep of byId.get(id) ?? []) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const q of queries) if (visit(q.id)) return true;
  return false;
}

/** Ordem topológica estável; retorna null quando há ciclo. */
export function topologicalQueryOrder(queries: FinancialQueryV2[]): FinancialQueryV2[][] | null {
  if (hasCycle(queries)) return null;
  const pending = new Map(queries.map((q) => [q.id, q]));
  const done = new Set<string>();
  const waves: FinancialQueryV2[][] = [];
  while (pending.size > 0) {
    const wave = [...pending.values()].filter((q) =>
      (q.depends_on ?? []).every((d) => !pending.has(d) || done.has(d))
    );
    if (!wave.length) return null;
    for (const q of wave) { pending.delete(q.id); done.add(q.id); }
    waves.push(wave);
  }
  return waves;
}
