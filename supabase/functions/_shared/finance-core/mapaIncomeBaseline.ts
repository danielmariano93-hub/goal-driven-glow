// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E1 — renda típica do Mapa Financeiro. Base de toda razão "sobre a renda". Puro.
import type { IncomeBaseline, IncomeRegularity } from "./mapaContracts.ts";
import { lastClosedActiveMonths, mapaMedian, mapaSampleStdev, type MapaMonthAgg } from "./mapaMonthly.ts";

export const INCOME_BASELINE_FORMULA = "income_baseline.v1";
/** Janela: até 6 meses fechados; mínimo 3 para falar em renda típica. */
export const INCOME_WINDOW_MONTHS = 6;
export const INCOME_MIN_MONTHS = 3;
/** Cortes de regularidade [provisório]: calibrar com dados reais. */
export const INCOME_CV_REGULAR = 0.25;
export const INCOME_CV_VARIABLE = 0.6;

export function classifyRegularity(cv: number | null): IncomeRegularity {
  if (cv === null) return "insuficiente";
  if (cv < INCOME_CV_REGULAR) return "regular";
  if (cv <= INCOME_CV_VARIABLE) return "variavel";
  return "irregular";
}

/**
 * Renda típica = mediana da renda operacional dos meses fechados (zeros contam: mês sem renda é informação).
 * O mês em andamento aparece só como `mtd_received`. Sem 3 meses fechados com registro, não há renda típica
 * (nunca se completa com o mês parcial).
 */
export function computeIncomeBaseline(months: MapaMonthAgg[]): IncomeBaseline {
  const current = months.find((m) => !m.closed);
  const mtd = current ? current.income : 0;
  const used = lastClosedActiveMonths(months, INCOME_WINDOW_MONTHS);
  if (used.length < INCOME_MIN_MONTHS) {
    return {
      typical: null, cv: null, regularity: "insuficiente", months_used: used.length, mtd_received: mtd,
      confidence: "insuficiente", reasons: ["poucos_meses_fechados"], formula_version: INCOME_BASELINE_FORMULA,
    };
  }
  const incomes = used.map((m) => m.income);
  const mean = incomes.reduce((a, b) => a + b, 0) / incomes.length;
  const sd = mapaSampleStdev(incomes);
  const reasons: string[] = [];
  let cv: number | null = null;
  if (mean > 0 && sd !== null) cv = sd / mean;
  else reasons.push("sem_renda_registrada");
  const typical = mapaMedian(incomes);
  return {
    typical: typical === null ? null : Math.round(typical * 100) / 100,
    cv: cv === null ? null : Math.round(cv * 1000) / 1000,
    regularity: classifyRegularity(cv),
    months_used: used.length,
    mtd_received: mtd,
    confidence: used.length >= 6 ? "alta" : "moderada",
    reasons,
    formula_version: INCOME_BASELINE_FORMULA,
  };
}
