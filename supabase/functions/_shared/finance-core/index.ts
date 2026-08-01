// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v1)
export const FINANCE_CONTRACT_VERSION = "finance_contract.v1";
export * from "./facts.ts";
export * from "./spendingRhythm.ts";
export * from "./dailyAverage.ts";
export * from "./cardExposure.ts";
export * from "./metrics.ts";
export type { DateRange, Trend } from "./spendingRhythm.ts";
export { daysInclusive, formatRangeShort } from "./spendingRhythm.ts";
