// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Montagem da leitura do Mapa Financeiro (`mapa_financeiro.v1`): E0, E1 e os motores de saúde financeira (E2 a E5).
import { MAPA_CONTRACT, type MapaIndicator, type MapaReading } from "./mapaContracts.ts";
import { computeDataQuality, type DataQualityInput } from "./mapaDataQuality.ts";
import { computeDividas } from "./mapaDividas.ts";
import { computeEquilibrio } from "./mapaEquilibrio.ts";
import { computeFuturo } from "./mapaFuturo.ts";
import { computeIncomeBaseline } from "./mapaIncomeBaseline.ts";
import { EMPTY_HEALTH_INPUTS, type MapaHealthInputs } from "./mapaInputs.ts";
import { aggregateMonths, type MapaMonthlyEntry } from "./mapaMonthly.ts";
import { computeSeguranca } from "./mapaSeguranca.ts";
import { computeStructural } from "./mapaStructural.ts";

export interface BuildMapaInput {
  asOf: string;
  entries: MapaMonthlyEntry[];
  lastSyncAgeDays?: DataQualityInput["lastSyncAgeDays"];
  reconciliationDifference?: DataQualityInput["reconciliationDifference"];
  health?: Partial<MapaHealthInputs>;
}

export function buildMapaReading(input: BuildMapaInput): MapaReading {
  const months = aggregateMonths(input.entries, input.asOf);
  const dq = computeDataQuality({ asOf: input.asOf, entries: input.entries, months, lastSyncAgeDays: input.lastSyncAgeDays, reconciliationDifference: input.reconciliationDifference });
  const income = computeIncomeBaseline(months);
  const h: MapaHealthInputs = { ...EMPTY_HEALTH_INPUTS, ...(input.health ?? {}) };

  const equilibrio = computeEquilibrio({ asOf: input.asOf, months, dq, income, snapshot: h.snapshot });
  const { indicators: seguranca, essential } = computeSeguranca({ asOf: input.asOf, months, entries: input.entries, dq, income, snapshot: h.snapshot, categoryEssential: h.categoryEssential, debts: h.debts, investments: h.investments });
  const dividas = computeDividas({ asOf: input.asOf, dq, income, debts: h.debts, overdue: h.debtOverdue, snapshot: h.snapshot });
  const futuro = computeFuturo({ asOf: input.asOf, dq, income, snapshot: h.snapshot, savingsGoals: h.savingsGoals, redemptions90: h.redemptions90, debtPayments90: h.debtPayments90 });
  const indicators: MapaIndicator[] = [...equilibrio, ...seguranca, ...dividas, ...futuro];

  return {
    contract: MAPA_CONTRACT,
    as_of: input.asOf,
    data_quality: dq,
    income,
    indicators,
    structural: computeStructural({ months, income, essential, indicators }),
    recommendation: null,
    questions_due: [],
  };
}
