// IRCapabilityAdapter (`nino_semantic_ir.v2`)
// ÚNICO lugar onde IR semântico conhece a implementação atual.
// Regra crítica: filtro que o motor não suporta torna a query UNSUPPORTED.
// Nunca descartar filtro silenciosamente.
import type { CapabilityDecision } from "./CapabilityRouter.ts";
import type { FinancialFilter, FinancialQuery, FinancialQueryIR } from "./FinancialQueryIR.ts";

type Mapping = {
  tool: string;
  capability: CapabilityDecision["name"];
  execution: CapabilityDecision["execution"];
  args: Record<string, unknown>;
};

function filter(q: FinancialQuery, field: FinancialFilter["field"]): string | null {
  return q.filters.find((f) => f.field === field && f.op === "eq")?.value?.trim() || null;
}

function onlyFilters(q: FinancialQuery, allowed: FinancialFilter["field"][]): boolean {
  return q.filters.every((f) => allowed.includes(f.field) && f.op === "eq");
}

function spendingArgs(q: FinancialQuery, ir: FinancialQueryIR): Record<string, unknown> | null {
  if (!onlyFilters(q, ["category", "card", "account", "payment_method"])) return null;
  const payment = filter(q, "payment_method");
  if (payment && !["account", "credit_card"].includes(payment)) return null;
  const group = q.group_by[0] ?? "category";
  if (!["category", "card", "account"].includes(group)) return null;
  const view = q.operation === "rank" ? "rank"
    : q.operation === "breakdown" ? "breakdown"
    : "total";
  return {
    from: ir.period.from,
    to: ir.period.to,
    metric: q.metric === "income_amount" ? "income" : "expense",
    group_by: group,
    view,
    ...(q.limit ? { limit: q.limit } : {}),
    ...(filter(q, "category") ? { category: filter(q, "category") } : {}),
    ...(filter(q, "card") ? { card: filter(q, "card") } : {}),
    ...(filter(q, "account") ? { account: filter(q, "account") } : {}),
    ...(payment ? { payment_method: payment } : {}),
    // "por cartão" e "por conta" são dimensões de fonte; não misture "Sem cartão"
    // ou "Sem conta" no ranking se o usuário pediu explicitamente esse corte.
    ...(!payment && group === "card" ? { payment_method: "credit_card" } : {}),
    ...(!payment && group === "account" ? { payment_method: "account" } : {}),
  };
}

function mapQuery(q: FinancialQuery, ir: FinancialQueryIR): Mapping | null {
  if (q.metric === "expense_amount" || q.metric === "income_amount") {
    const metric = q.metric === "income_amount" ? "income" : "expense";
    const group = q.group_by[0] ?? null;

    if (["value", "sum", "rank", "breakdown"].includes(q.operation)) {
      if (group === "merchant") {
        if (metric !== "expense" || !onlyFilters(q, ["category"])) return null;
        return {
          tool: "analyze_merchants",
          capability: "financial_analysis",
          execution: "llm_scoped",
          args: {
            from: ir.period.from, to: ir.period.to,
            ...(filter(q, "category") ? { category_name: filter(q, "category") } : {}),
            ...(q.limit ? { limit: q.limit } : {}),
          },
        };
      }
      const args = spendingArgs(q, ir);
      if (!args) return null;
      return {
        tool: "analyze_spending",
        capability: "financial_analysis",
        execution: "deterministic",
        args,
      };
    }

    if (q.operation === "compare") {
      if (q.filters.length || (group && group !== "category") || !ir.comparison_period) return null;
      return {
        tool: "compare_periods",
        capability: "financial_comparison",
        execution: "llm_scoped",
        args: {
          metric,
          period_a: { from: ir.comparison_period.from, to: ir.comparison_period.to },
          period_b: { from: ir.period.from, to: ir.period.to },
        },
      };
    }

    if (q.operation === "trend") {
      // Trajetória mês a mês: motor longitudinal (ponto de virada, tendência).
      if (group === "month" && !q.filters.length) {
        return {
          tool: "analyze_longitudinal_trajectory",
          capability: "financial_analysis",
          execution: "deterministic",
          args: { from: ir.period.from, to: ir.period.to },
        };
      }
      // Tendência COM recorte (categoria/cartão): o motor de comparação canônica
      // suporta o corte; antes a query inteira virava `unsupported`.
      const cat = filter(q, "category");
      const card = filter(q, "card");
      if ((cat || card) && metric === "expense" && !group && ir.comparison_period) {
        return {
          tool: "compare_financial_metric",
          capability: "financial_comparison",
          execution: "llm_scoped",
          args: {
            metric: cat ? "category_spend" : "card_spend",
            mode: "CUSTOM_PERIOD",
            ...(cat ? { category_name: cat } : {}),
            from: ir.period.from,
            to: ir.period.to,
          },
        };
      }
      if (q.filters.length || group) return null;
      return metric === "expense"
        ? {
          tool: "spending_average_daily_trend",
          capability: "financial_analysis",
          execution: "llm_scoped",
          args: { from: ir.period.from, to: ir.period.to },
        }
        : {
          tool: "spending_timeseries_daily",
          capability: "financial_analysis",
          execution: "llm_scoped",
          args: { metric: "income", from: ir.period.from, to: ir.period.to },
        };
    }

    if (q.operation === "forecast") {
      if (metric !== "expense" || q.filters.length || group) return null;
      return {
        tool: "forecast_month_close",
        capability: "forecast_month_close",
        execution: "deterministic",
        args: {},
      };
    }

    if (q.operation === "explain") {
      if (metric !== "expense" || q.filters.length || group || !ir.comparison_period) return null;
      return {
        tool: "explain_spending_change",
        capability: "financial_analysis",
        execution: "llm_scoped",
        args: {
          period_a: { from: ir.comparison_period.from, to: ir.comparison_period.to },
          period_b: { from: ir.period.from, to: ir.period.to },
        },
      };
    }
    return null;
  }

  // Saúde financeira ("estou melhorando ou piorando?") é veredito holístico:
  // vale para value/sum e também para trend/compare/explain, porque o motor já
  // compõe direção, tendência, sobra, dívida e patrimônio numa única leitura.
  if (q.metric === "financial_health" && !q.filters.length && !q.group_by.length
    && ["value", "sum", "trend", "compare", "explain"].includes(q.operation)) {
    return { tool: "assess_financial_health", capability: "holistic_assessment", execution: "deterministic", args: {} };
  }

  if (q.filters.length || q.group_by.length || !["value", "sum"].includes(q.operation)) return null;
  if (q.metric === "balance") {
    return { tool: "get_financial_snapshot", capability: "financial_snapshot", execution: "deterministic", args: {} };
  }
  if (q.metric === "net_worth") {
    return { tool: "get_net_worth", capability: "financial_analysis", execution: "deterministic", args: {} };
  }
  if (q.metric === "debt_balance") {
    return { tool: "get_debt_status", capability: "debt_status", execution: "deterministic", args: {} };
  }
  if (q.metric === "goal_progress") {
    return { tool: "get_goals_overview", capability: "goals_overview", execution: "deterministic", args: {} };
  }
  if (q.metric === "future_installments") {
    return { tool: "get_future_installments", capability: "financial_analysis", execution: "deterministic", args: {} };
  }
  if (q.metric === "financial_health") {
    return { tool: "assess_financial_health", capability: "holistic_assessment", execution: "deterministic", args: {} };
  }
  return null;
}

export type IRCapabilityResult = {
  capability: CapabilityDecision | null;
  unsupported_queries: string[];
  mapped_tools: string[];
};

export function capabilityFromFinancialIR(ir: FinancialQueryIR): IRCapabilityResult {
  if (ir.intent === "unsupported" || ir.queries.length !== 1) {
    return { capability: null, unsupported_queries: ir.queries.map((q) => q.id), mapped_tools: [] };
  }
  const q = ir.queries[0];
  const mapped = mapQuery(q, ir);
  if (!mapped) return { capability: null, unsupported_queries: [q.id], mapped_tools: [] };
  return {
    capability: {
      name: mapped.capability,
      execution: mapped.execution,
      allowed_tools: [mapped.tool],
      required_tool: mapped.tool,
      tool_args: mapped.args,
      context: { metrics: true },
      reason: `semantic_ir_v2:${ir.intent}:${q.metric}/${q.operation}/${q.group_by.join("+") || "none"}`,
    },
    unsupported_queries: [],
    mapped_tools: [mapped.tool],
  };
}

export function capabilityExistsForIR(ir: FinancialQueryIR): boolean {
  const result = capabilityFromFinancialIR(ir);
  return !!result.capability && result.unsupported_queries.length === 0;
}

export function isFalseCapabilityDenial(reply: string, ir: FinancialQueryIR | null): boolean {
  if (!ir || !capabilityExistsForIR(ir)) return false;
  return /\b(n[aã]o (?:tenho|possuo) (?:a )?(?:ferramenta|capacidade)|n[aã]o consigo (?:consultar|calcular|acessar)|n[aã]o (?:d[aá]|e poss[ií]vel) (?:para mim )?(?:calcular|consultar))\b/i
    .test(String(reply ?? ""));
}

// ---------------------------------------------------------------------------
// `nino_semantic_ir.v3` — mapeamento por query, usado pelo FinancialPlanValidator
// e pelo SemanticQueryExecutor. Continua sendo o ÚNICO lugar onde o IR conhece
// a implementação atual das ferramentas.
// ---------------------------------------------------------------------------
export type IRQueryMapping = Mapping;

export function mappingForQuery(
  q: FinancialQuery,
  ir: Pick<FinancialQueryIR, "period" | "comparison_period">,
): IRQueryMapping | null {
  return mapQuery(q, ir as FinancialQueryIR);
}

export function mappingsFromIR(
  ir: FinancialQueryIR & { queries: FinancialQuery[] },
): Array<{ query_id: string; mapping: IRQueryMapping | null }> {
  return ir.queries.map((q) => ({ query_id: q.id, mapping: mappingForQuery(q, ir) }));
}

// ---------------------------------------------------------------------------
// Ontologia executável (`nino_ontology.v1`)
//
// Causa-raiz que esta seção fecha: o compilador não sabia o que é executável,
// gerava queries sem motor, o status virava `unsupported` e o Nino devolvia
// falha honesta mesmo tendo motor canônico para a pergunta. Agora o catálogo é
// DERIVADO deste arquivo (nunca escrito à mão em prompt) e a lacuna vira
// telemetria auditável em vez de print de conversa.
// ---------------------------------------------------------------------------

/** Assinatura determinística da query — chave de lacuna de ontologia. */
export function ontologySignature(q: FinancialQuery): string {
  const group = q.group_by.length ? q.group_by.join("+") : "none";
  const filters = q.filters.length
    ? [...q.filters].map((f) => f.field).sort().join("+")
    : "none";
  return `${q.metric}/${q.operation}/group:${group}/filters:${filters}`;
}

/** Combinações realmente mapeadas, para o prompt do compilador. */
export const EXECUTABLE_ONTOLOGY: string[] = [
  "expense_amount|income_amount + value|sum|rank|breakdown (group: category|card|account, filtros: category|card|account|payment_method)",
  "expense_amount + rank|breakdown group merchant (filtro opcional: category)",
  "expense_amount|income_amount + compare (sem filtro, exige período de comparação)",
  "expense_amount|income_amount + trend (sem filtro) ou trend group month (trajetória mês a mês)",
  "expense_amount + trend com filtro category|card (exige período de comparação)",
  "expense_amount + forecast (fechamento do mês)",
  "expense_amount + explain (exige período de comparação)",
  "balance | net_worth | debt_balance | goal_progress | future_installments + value|sum",
  "financial_health + value|sum|trend|compare|explain (veredito holístico: 'estou melhorando ou piorando?')",
];

export function executableOntologyText(): string {
  return EXECUTABLE_ONTOLOGY.map((line) => `- ${line}`).join("\n");
}

/** Sugestão canônica quando a combinação pedida não tem motor. */
export function ontologyHintFor(q: FinancialQuery): string | null {
  if (q.metric === "financial_health") return "financial_health + value";
  if (q.operation === "trend" && q.group_by.length && q.group_by[0] !== "month") {
    return `${q.metric} + trend group month`;
  }
  if (q.operation === "compare" && q.filters.length) return `${q.metric} + compare sem filtro`;
  if (q.group_by[0] === "weekday") return `${q.metric} + breakdown group category`;
  return null;
}
