// Montagem da leitura do Mapa Financeiro (`mapa_financeiro.v1`). Fase 1: E0 + E1; os indicadores entram nas fases 2-4.
import { MAPA_CONTRACT, type MapaReading, type StructuralFlags } from "./mapaContracts";
import { computeDataQuality, type DataQualityInput } from "./mapaDataQuality";
import { computeIncomeBaseline } from "./mapaIncomeBaseline";
import { aggregateMonths, type MapaMonthlyEntry } from "./mapaMonthly";

export interface BuildMapaInput {
  asOf: string;
  entries: MapaMonthlyEntry[];
  lastSyncAgeDays?: DataQualityInput["lastSyncAgeDays"];
  reconciliationDifference?: DataQualityInput["reconciliationDifference"];
}

const EMPTY_STRUCTURAL: StructuralFlags = { essential_share_of_income: null, debt_service_ratio: null, negative_result_streak: null, structural: null };

export function buildMapaReading(input: BuildMapaInput): MapaReading {
  const months = aggregateMonths(input.entries, input.asOf);
  return {
    contract: MAPA_CONTRACT,
    as_of: input.asOf,
    data_quality: computeDataQuality({ asOf: input.asOf, entries: input.entries, months, lastSyncAgeDays: input.lastSyncAgeDays, reconciliationDifference: input.reconciliationDifference }),
    income: computeIncomeBaseline(months),
    indicators: [],
    structural: EMPTY_STRUCTURAL,
    recommendation: null,
    questions_due: [],
  };
}
