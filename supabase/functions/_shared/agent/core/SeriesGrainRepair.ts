// SeriesGrainRepair (`nino_series_grain.v1`)
//
// "gráfico diário de setembro de Transporte no Uber" é uma série DIÁRIA; "semana
// a semana no iFood", semanal. Se a interpretação devolver a mesma leitura sem o
// grão (trend/sum/value sem group_by), o texto literal decide o grão — de forma
// determinística e estreita: só com pedido explícito de série (SeriesGrain), só
// para gasto com recorte opcional de categoria/estabelecimento. O mês continua
// no caminho próprio (a série mensal exige recorte e já é interpretada assim).
import type { FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import type { ConversationTurnContract } from "./ConversationTurnContract.ts";
import { isScopedSeriesGrain, requestedSeriesGrain, type ScopedSeriesGrain } from "./SeriesGrain.ts";

type RepairableQuery = {
  metric: string;
  operation: string;
  group_by: readonly string[];
  filters: ReadonlyArray<{ field: string; op: string }>;
};

function repairableGrain(q: RepairableQuery, text: string): ScopedSeriesGrain | null {
  const grain = requestedSeriesGrain(text);
  if (!isScopedSeriesGrain(grain)) return null;
  const groupBy = q.group_by ?? [];
  const eligible = q.metric === "expense_amount"
    && ["trend", "sum", "value"].includes(q.operation)
    // Sem grão, ou com o grão errado para uma série ("diário" que virou mês).
    && (groupBy.length === 0 || (groupBy.length === 1 && ["day", "week", "month", "quarter"].includes(groupBy[0])))
    && (q.filters ?? []).every((f) => (f.field === "category" || f.field === "merchant") && f.op === "eq");
  if (!eligible) return null;
  if (groupBy.length === 1 && groupBy[0] === grain && q.operation === "trend") return null;
  return grain;
}

/** O texto pede explicitamente uma série dia a dia? (compatibilidade) */
export function requestsDailySeries(text: string): boolean {
  return requestedSeriesGrain(text) === "day";
}

/**
 * Reparo no CONTRATO do turno, antes de compilar: assim o pedido canônico, o IR
 * e o que executou continuam idênticos (o portão de cumprimento compara os três).
 */
export function repairSeriesGrainInContract<T extends Pick<ConversationTurnContract, "financial_read">>(
  contract: T,
  text: string,
): T {
  const read = contract.financial_read;
  if (!read || read.queries.length !== 1) return contract;
  const q = read.queries[0];
  const grain = repairableGrain(q as RepairableQuery, text);
  if (!grain) return contract;
  return {
    ...contract,
    financial_read: { ...read, queries: [{ ...q, operation: "trend", group_by: [grain] }] },
  };
}

export function repairSeriesGrain(ir: FinancialQueryIRv2, text: string): { ir: FinancialQueryIRv2; repaired: boolean } {
  if (ir.queries.length !== 1) return { ir, repaired: false };
  const q = ir.queries[0];
  const grain = repairableGrain(q as RepairableQuery, text);
  if (!grain) return { ir, repaired: false };
  return {
    ir: {
      ...ir,
      queries: [{ ...q, operation: "trend", group_by: [grain] }],
      assumptions: [...(ir.assumptions ?? []), `série por ${grain} pedida explicitamente`],
    },
    repaired: true,
  };
}
