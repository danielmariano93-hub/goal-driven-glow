// IRCapabilityAdapter (`nino_ontology.v1`)
// Executable ontology: one deterministic map from canonical IR to a real engine.
// deno-lint-ignore-file no-explicit-any
import type { FinancialQueryIR, FinancialQuery } from "./FinancialQueryIR.ts";

export type CapabilityMapping = {
  tool: string;
  capability: string;
  execution: "deterministic" | "llm_scoped";
  args: Record<string, unknown>;
};

function filter(q: FinancialQuery, field: string): string | null {
  return q.filters.find((f) => f.field === field)?.value ?? null;
}

function onlyFilters(q: FinancialQuery, allowed: string[]): boolean {
  return q.filters.every((f) => allowed.includes(f.field));
}

function metricName(metric: FinancialQuery["metric"]): "expense" | "income" | null {
  if (metric === "expense_amount") return "expense";
  if (metric === "income_amount") return "income";
  return null;
}

function spendingArgs(q: FinancialQuery, ir: FinancialQueryIR): Record<string, unknown> | null {
  if (q.metric !== "expense_amount") return null;
  const category = filter(q, "category");
  const merchant = filter(q, "merchant");
  const card = filter(q, "card");
  const account = filter(q, "account");
  const emotion = filter(q, "emotion");
  if (!onlyFilters(q, ["category", "merchant", "card", "account", "emotion"])) return null;
  return {
    from: ir.period.from,
    to: ir.period.to,
    ...(category ? { category_name: category } : {}),
    ...(merchant ? { merchant } : {}),
    ...(card ? { card_name: card } : {}),
    ...(account ? { account_name: account } : {}),
    ...(emotion ? { emotion } : {}),
  };
}

export function mappingForQuery(q: FinancialQuery, ir: FinancialQueryIR): CapabilityMapping | null {
  const metric = metricName(q.metric);
  const group = q.group_by[0] ?? null;
  const period = ir.period;
  const merchant = filter(q, "merchant");

  if (q.metric === "financial_health") {
    if (q.filters.length || group) return null;
    return {
      tool: "assess_financial_health",
      capability: "financial_health",
      execution: "deterministic",
      args: { from: period.from, to: period.to },
    };
  }

  if (q.operation === "value") {
    if (merchant) {
      if (q.metric !== "expense_amount" || (group && group !== "merchant")) return null;
      const category = filter(q, "category");
      if (!onlyFilters(q, ["category", "merchant"])) return null;
      return {
        tool: "merchant_distribution",
        capability: "financial_analysis",
        execution: "deterministic",
        args: {
          from: period.from,
          to: period.to,
          merchant,
          ...(category ? { category } : {}),
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

  if (q.operation === "rank" || q.operation === "breakdown") {
    if (merchant) {
      if (q.metric !== "expense_amount" || group !== "merchant") return null;
      const category = filter(q, "category");
      if (!onlyFilters(q, ["category", "merchant"])) return null;
      return {
        tool: "merchant_distribution",
        capability: "financial_analysis",
        execution: "deterministic",
        args: {
          from: period.from,
          to: period.to,
          merchant,
          ...(category ? { category } : {}),
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
    // O motor canônico já aceita `category_scope`; o adaptador antigo negava
    // qualquer filtro e criava um falso "unsupported" para perguntas como
    // "compare Lazer com o período anterior". A ontologia deve refletir a
    // capacidade REAL do engine, não uma restrição histórica do adaptador.
    if ((group && group !== "category") || !onlyFilters(q, ["category"])) return null;
    const category = filter(q, "category");
    const categoryScope = category ? [category] : undefined;
    if (q.comparison_baseline === "mean_previous_complete_months") {
      const months = Number(q.comparison_baseline_window);
      if (!Number.isInteger(months) || months < 2 || months > 24) return null;
      return {
        tool: "compare_to_monthly_average",
        capability: "financial_comparison",
        execution: "deterministic",
        args: {
          metric,
          group_by: group === "category" ? "category" : "none",
          comparison_direction: q.comparison_direction ?? "any",
          limit: q.limit ?? null,
          months,
          target_period: { from: period.from, to: period.to, label: period.label },
          ...(categoryScope ? { category_scope: categoryScope } : {}),
        },
      };
    }
    if (!ir.comparison_period) return null;
    return {
      tool: "compare_periods",
      capability: "financial_comparison",
      execution: "llm_scoped",
      args: {
        metric,
        group_by: group === "category" ? "category" : "none",
        comparison_direction: q.comparison_direction ?? "any",
        limit: q.limit ?? null,
        period_a: { from: ir.comparison_period.from, to: ir.comparison_period.to },
        period_b: { from: period.from, to: period.to },
        ...(categoryScope ? { category_scope: categoryScope } : {}),
      },
    };
  }

  if (q.operation === "trend") {
    const monthlyCategory = filter(q, "category");
    // Only an EXPLICIT month grain is the factual month-by-month series. A
    // generic "tendência de Transporte" (no group) keeps the canonical
    // comparison engine below. This avoids conflating two different questions.
    if (metric === "expense"
      && group === "month"
      && (monthlyCategory || merchant)
      && onlyFilters(q, ["category", "merchant"])) {
      return {
        tool: "spending_timeseries_monthly",
        capability: "financial_analysis",
        execution: "deterministic",
        args: {
          from: period.from, to: period.to,
          ...(monthlyCategory ? { category_name: monthlyCategory } : {}),
          ...(merchant ? { merchant } : {}),
        },
      };
    }
    // Trajetória mês a mês: motor longitudinal (ponto de virada, tendência).
    if (group === "month" && !q.filters.length) {
      return {
        tool: "analyze_longitudinal_trajectory",
        capability: "financial_analysis",
        execution: "deterministic",
        args: { from: period.from, to: period.to },
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
        execution: "deterministic",
        args: {
          metric: cat ? "category_spend" : "card_spend",
          direction: q.comparison_direction ?? "any",
          current_period: { from: period.from, to: period.to },
          comparison_period: { from: ir.comparison_period.from, to: ir.comparison_period.to },
          ...(cat ? { category_name: cat } : {}),
          ...(card ? { card_name: card } : {}),
        },
      };
    }
    return null;
  }

  if (q.operation === "explain") {
    if (q.metric !== "expense_amount" || !group || q.filters.length) return null;
    if (group === "category") {
      return {
        tool: "analyze_spending",
        capability: "financial_analysis",
        execution: "deterministic",
        args: { from: period.from, to: period.to },
      };
    }
    return null;
  }

  return null;
}

export function ontologySignature(q: FinancialQuery): string {
  const filters = [...new Set(q.filters.map((f) => f.field))].sort().join(",") || "none";
  const group = q.group_by.join(",") || "none";
  return `${q.metric}/${q.operation}/group:${group}/filters:${filters}`;
}

export function ontologyHintFor(q: FinancialQuery): string | null {
  if (q.metric === "financial_health") return "financial_health + value|trend|compare|explain";
  if (q.metric === "expense_amount" && q.operation === "trend") return "expense_amount + trend group month";
  if (q.metric === "expense_amount" && q.operation === "value") return "expense_amount + value";
  if (q.metric === "expense_amount" && (q.operation === "rank" || q.operation === "breakdown")) {
    return "expense_amount + rank|breakdown group category|merchant";
  }
  if (q.operation === "compare") return "expense_amount|income_amount + compare (filtro opcional: category)";
  return null;
}

export function executableOntologyText(): string {
  return [
    "financial_health + value|trend|compare|explain (sem filtros/grupo) -> assess_financial_health",
    "expense_amount + value -> analyze_spending",
    "expense_amount + value/rank/breakdown group merchant (filtro opcional: category) -> merchant_distribution",
    "expense_amount + trend group month (sem filtros) -> analyze_longitudinal_trajectory",
    "expense_amount + trend group month com filtro category e/ou merchant -> spending_timeseries_monthly",
    "expense_amount + trend sem grupo + filtro category|card -> compare_financial_metric",
    "expense_amount|income_amount + compare -> compare_periods; baseline média N meses -> compare_to_monthly_average",
  ].join("\n");
}
