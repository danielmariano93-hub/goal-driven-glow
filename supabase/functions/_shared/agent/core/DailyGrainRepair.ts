// DailyGrainRepair (`nino_daily_series.v1`)
//
// "gráfico diário de setembro de Transporte no Uber" é uma série DIÁRIA. Se a
// interpretação devolver a mesma leitura sem o grão (trend/sum/value sem
// group_by), o texto literal da pessoa decide o grão — de forma determinística
// e estreita: só com pedido explícito de série diária, nunca para "média por
// dia"/"ritmo diário", e só para gasto com recorte de categoria/estabelecimento.
import { inferChartRequest } from "../../intelligence/chartIntent.ts";
import type { FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import type { ConversationTurnContract } from "./ConversationTurnContract.ts";

const SERIES_WORDS = /\b(dia a dia|cada dia|todos os dias|diari[oa]s?)\b/;
const AVERAGE_WORDS = /\b(media|medio|ritmo|por dia em media)\b/;

function normalize(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** O texto pede explicitamente uma série dia a dia? */
export function requestsDailySeries(text: string): boolean {
  const t = normalize(text);
  if (AVERAGE_WORDS.test(t)) return false;
  return inferChartRequest(text)?.mode === "daily_series" || SERIES_WORDS.test(t);
}

type RepairableQuery = {
  metric: string;
  operation: string;
  group_by: readonly string[];
  filters: ReadonlyArray<{ field: string; op: string }>;
};

function eligibleForDaily(q: RepairableQuery): boolean {
  return q.metric === "expense_amount"
    && ["trend", "sum", "value"].includes(q.operation)
    && (q.group_by ?? []).length === 0
    && (q.filters ?? []).every((f) => (f.field === "category" || f.field === "merchant") && f.op === "eq");
}

/**
 * Reparo no CONTRATO do turno, antes de compilar: assim o pedido canônico, o IR
 * e o que executou continuam idênticos (o portão de cumprimento compara os três).
 */
export function repairDailyGrainInContract<T extends Pick<ConversationTurnContract, "financial_read">>(
  contract: T,
  text: string,
): T {
  const read = contract.financial_read;
  if (!read || read.queries.length !== 1 || !requestsDailySeries(text)) return contract;
  const q = read.queries[0];
  if (!eligibleForDaily(q as RepairableQuery)) return contract;
  return {
    ...contract,
    financial_read: { ...read, queries: [{ ...q, operation: "trend", group_by: ["day"] }] },
  };
}

export function repairDailyGrain(ir: FinancialQueryIRv2, text: string): { ir: FinancialQueryIRv2; repaired: boolean } {
  if (ir.queries.length !== 1 || !requestsDailySeries(text)) return { ir, repaired: false };
  const q = ir.queries[0];
  if (!eligibleForDaily(q as RepairableQuery)) return { ir, repaired: false };
  return {
    ir: {
      ...ir,
      queries: [{ ...q, operation: "trend", group_by: ["day"] }],
      assumptions: [...(ir.assumptions ?? []), "série dia a dia pedida explicitamente"],
    },
    repaired: true,
  };
}
