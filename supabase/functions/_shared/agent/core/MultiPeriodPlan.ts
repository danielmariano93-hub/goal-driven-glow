// MultiPeriodPlan (`period_truth.v2`)
//
// Leitura MULTI-PERÍODO como capacidade de primeira classe.
//
// Incidente real (14/09/2026): "quanto gastei em alimentação no mês de julho e
// agosto?" terminou em falha honesta pedindo o período — que já havia sido dado
// duas vezes. Causa: o contrato financeiro só sabia representar UM período, e o
// segundo recorte era descartado antes da execução.
//
// Princípio: a métrica, os filtros e as dimensões são compilados UMA vez; o
// backend vincula um período a CADA execução do mesmo contrato. Não existe
// special-case de mês: qualquer lista de períodos resolvidos vale.
import {
  MAX_IR_QUERIES,
  type CanonicalPeriod, type CompletenessTarget,
  type FinancialQueryIRv2, type FinancialQueryV2,
} from "./FinancialQueryIR.ts";

export type MultiPeriodMode = "none" | "fanout" | "comparison";

export type MultiPeriodExpansion = {
  version: "period_truth.v2";
  applied: boolean;
  mode: MultiPeriodMode;
  ir: FinancialQueryIRv2;
  /** Períodos efetivamente executados, na ordem pedida. */
  periods: CanonicalPeriod[];
  /** query_id → rótulo do período, para a resposta nomear cada recorte. */
  labels: Record<string, string>;
  reason: string | null;
};

const SEP = "@p";

function canonical(period: { from: string; to: string; label?: string }, index: number): CanonicalPeriod {
  return {
    from: period.from,
    to: period.to,
    label: String(period.label ?? `período ${index + 1}`),
  };
}

/** Comparação real (motor `compare_periods`) só existe sem filtro e sem dimensão. */
function comparableShape(ir: FinancialQueryIRv2): boolean {
  if (ir.queries.length !== 1) return false;
  const q = ir.queries[0];
  const group = q.group_by?.[0] ?? null;
  const comparisonByCategory = q.operation === "compare" && group === "category";
  return q.filters.length === 0
    && ((q.group_by?.length ?? 0) === 0 || comparisonByCategory)
    && ["value", "sum", "compare"].includes(String(q.operation))
    && ["expense_amount", "income_amount"].includes(String(q.metric));
}

export function expandIRForPeriods(
  ir: FinancialQueryIRv2 | null,
  rawPeriods: Array<{ from: string; to: string; label?: string }>,
  comparisonIntent: boolean,
): MultiPeriodExpansion {
  const periods = rawPeriods.map(canonical);
  const none = (reason: string | null): MultiPeriodExpansion => ({
    version: "period_truth.v2",
    applied: false,
    mode: "none",
    ir: ir as FinancialQueryIRv2,
    periods: [],
    labels: {},
    reason,
  });

  if (!ir) return none("ir_missing");
  if (periods.length < 2) return none("single_period");
  if (ir.intent === "unsupported" || ir.queries.length === 0) return none("no_queries");

  // Comparação explícita entre EXATAMENTE dois períodos usa a semântica de
  // comparação. Pedido de "valores em vários períodos" nunca vira comparação.
  if (comparisonIntent && periods.length === 2 && comparableShape(ir)) {
    const q = ir.queries[0];
    return {
      version: "period_truth.v2",
      applied: true,
      mode: "comparison",
      ir: {
        ...ir,
        queries: [{ ...q, operation: "compare", period: null }],
        period: periods[1],
        comparison_period: periods[0],
        completeness_targets: (ir.completeness_targets ?? []).map((t) => ({ ...t, claim: "direction" as const })),
        assumptions: [...new Set([...ir.assumptions, `comparação: ${periods[0].label} vs ${periods[1].label}`])],
      },
      periods,
      labels: { [q.id]: `${periods[0].label} vs ${periods[1].label}` },
      reason: null,
    };
  }

  // Fan-out: o mesmo contrato roda uma vez por período.
  const perPeriod = ir.queries.length;
  const maxPeriods = Math.max(2, Math.floor(MAX_IR_QUERIES / perPeriod));
  const used = periods.slice(0, maxPeriods);
  const truncated = used.length < periods.length;

  const queries: FinancialQueryV2[] = [];
  const labels: Record<string, string> = {};
  used.forEach((period, index) => {
    for (const q of ir.queries) {
      const id = `${q.id}${SEP}${index}`;
      queries.push({
        ...q,
        id,
        period,
        // Dependência só existe dentro do MESMO período.
        depends_on: (q.depends_on ?? []).map((dep) => `${dep}${SEP}${index}`),
      });
      labels[id] = period.label;
    }
  });

  const targets: CompletenessTarget[] = [];
  used.forEach((_, index) => {
    for (const t of ir.completeness_targets ?? []) {
      targets.push({ ...t, id: `${t.id}${SEP}${index}`, query_id: `${t.query_id}${SEP}${index}` });
    }
  });

  return {
    version: "period_truth.v2",
    applied: true,
    mode: "fanout",
    ir: {
      ...ir,
      queries: queries.slice(0, MAX_IR_QUERIES),
      completeness_targets: targets,
      period: used[0],
      comparison_period: null,
      assumptions: [...new Set([
        ...ir.assumptions,
        `períodos solicitados: ${used.map((p) => p.label).join(", ")}`,
      ])],
    },
    periods: used,
    labels,
    reason: truncated ? "periods_truncated_to_query_budget" : null,
  };
}
