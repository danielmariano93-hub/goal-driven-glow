// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E3 — Segurança e resiliência (saúde). Liquidez contra gasto típico de meses FECHADOS (nunca o mês parcial).
import type { DataQuality, IncomeBaseline, MapaIndicator, MapaStatus } from "./mapaContracts.ts";
import { closedWindow, ledgerConfidence, noData, pointWindow, reading, round, MAPA_ENGINE_VERSION, type IndicatorSpec } from "./mapaIndicator.ts";
import type { MapaDebtIn, MapaInvestmentIn, MapaSnapshotInput } from "./mapaInputs.ts";
import { lastClosedActiveMonths, mapaMedian, mapaMonthOf, type MapaMonthAgg, type MapaMonthlyEntry } from "./mapaMonthly.ts";
import { ESSENTIAL_COVERAGE_MIN, RESERVE_CRITICAL_MONTHS, RESERVE_TARGET_MONTHS, SHOCK_CRITICAL, SHOCK_OK } from "./mapaThresholds.ts";

export const SEGURANCA_FORMULA = "mapa_seguranca.v1";
/** Liquidez considerada disponível em até 30 dias. */
const LIQUID: ReadonlySet<string> = new Set(["d0", "d1", "d30"]);

export interface SegurancaInput {
  asOf: string;
  months: MapaMonthAgg[];
  entries: MapaMonthlyEntry[];
  dq: DataQuality;
  income: IncomeBaseline;
  snapshot: MapaSnapshotInput | null;
  categoryEssential: Record<string, boolean>;
  debts: MapaDebtIn[];
  investments: MapaInvestmentIn[];
}

export interface EssentialMonthly {
  /** Gasto mensal típico usado como denominador (inclui parcelas de dívida). */
  value: number;
  basis: "essenciais" | "gastos_totais";
  /** Parte do consumo com flag confirmada (essencial ou não). */
  coverage: number;
  months_used: number;
  debt_installments: number;
}

/**
 * Gasto mensal típico (mediana de meses fechados) + parcelas de dívida (que ficam fora do consumo no ledger).
 * Com ≥ 80% do consumo classificado pelo usuário, usa só os essenciais; senão usa os gastos totais e SEMPRE rotula assim.
 */
export function computeEssentialMonthly(months: MapaMonthAgg[], entries: MapaMonthlyEntry[], flags: Record<string, boolean>, debts: MapaDebtIn[]): EssentialMonthly | null {
  const window = lastClosedActiveMonths(months, 6);
  if (window.length < 3) return null;
  const inWindow = new Set(window.map((m) => m.month));
  const per = new Map<string, { total: number; essential: number; flagged: number }>();
  for (const e of entries) {
    if (e.kind !== "expense") continue;
    const m = mapaMonthOf(e.date);
    if (!inWindow.has(m)) continue;
    const row = per.get(m) ?? { total: 0, essential: 0, flagged: 0 };
    row.total += e.amount;
    const flag = e.category_id ? flags[e.category_id] : undefined;
    if (flag !== undefined) { row.flagged += e.amount; if (flag) row.essential += e.amount; }
    per.set(m, row);
  }
  const rows = window.map((m) => per.get(m.month) ?? { total: 0, essential: 0, flagged: 0 });
  const totalSum = rows.reduce((a, r) => a + r.total, 0);
  const flaggedSum = rows.reduce((a, r) => a + r.flagged, 0);
  const coverage = totalSum > 0 ? flaggedSum / totalSum : 0;
  const installments = debts.filter((d) => d.status === "active").reduce((a, d) => a + (d.installment_amount ?? 0), 0);
  const useEssential = coverage >= ESSENTIAL_COVERAGE_MIN;
  const typical = mapaMedian(rows.map((r) => (useEssential ? r.essential : r.total))) ?? 0;
  return { value: round(typical + installments), basis: useEssential ? "essenciais" : "gastos_totais", coverage: round(coverage), months_used: window.length, debt_installments: round(installments) };
}

export function liquidResources(snapshot: MapaSnapshotInput | null, investments: MapaInvestmentIn[]): { cash: number; invested: number; total: number } | null {
  if (!snapshot || snapshot.availableToday === null) return null;
  const invested = investments.filter((v) => v.liquidity !== null && LIQUID.has(v.liquidity)).reduce((a, v) => a + v.current_value, 0);
  const cash = snapshot.availableToday;
  return { cash, invested: round(invested), total: round(cash + invested) };
}

const base = (id: string, unit: IndicatorSpec["unit"], window: IndicatorSpec["window"], evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "seguranca", layer: "saude", unit, direction: "higher_better", window, evidence, formula: SEGURANCA_FORMULA });

export function computeSeguranca(i: SegurancaInput): { indicators: MapaIndicator[]; essential: EssentialMonthly | null } {
  const essential = computeEssentialMonthly(i.months, i.entries, i.categoryEssential, i.debts);
  const liquid = liquidResources(i.snapshot, i.investments);
  const window = closedWindow(lastClosedActiveMonths(i.months, 6));
  const conf = ledgerConfidence(i.dq, i.income);
  const hist = { reasons: ["poucos_meses_fechados"], needs: { kind: "history" as const, code: "meses_fechados" } };
  const noSnap = { reasons: ["sem_snapshot_financeiro"], needs: { kind: "connect" as const, code: "snapshot" } };
  const indicators: MapaIndicator[] = [];

  const mSpec = base("seguranca.meses_cobertos", "meses", window, ["balance", "ledger"]);
  if (!essential || i.dq.eligibility.razoes_de_renda === "bloqueado") indicators.push(noData(mSpec, hist));
  else if (!liquid) indicators.push(noData(mSpec, noSnap));
  else if (essential.value <= 0) indicators.push(noData(mSpec, { reasons: ["sem_gasto_tipico"], inputs: { gasto_mensal: essential.value } }));
  else {
    const months = liquid.total / essential.value;
    const target = RESERVE_TARGET_MONTHS[i.income.regularity];
    const status: Exclude<MapaStatus, "sem_dados"> = months >= target ? "ok" : months >= RESERVE_CRITICAL_MONTHS ? "atencao" : "critico";
    const reasons: string[] = [];
    if (essential.basis === "gastos_totais") reasons.push("essential_flag_missing");
    if (i.income.regularity === "irregular") reasons.push("renda_irregular");
    const liquidityUnknown = i.investments.filter((v) => v.liquidity === null || v.liquidity === "desconhecida").length;
    if (liquidityUnknown > 0) reasons.push("liquidez_de_investimentos_desconhecida");
    const needs = essential.basis === "gastos_totais" ? { kind: "capture" as const, code: "essencial_categoria" } : liquidityUnknown > 0 ? { kind: "capture" as const, code: "liquidez_investimento" } : undefined;
    indicators.push(reading(mSpec, {
      value: months, status, confidence: conf, reasons, needs,
      inputs: { dinheiro_em_conta: liquid.cash, investimentos_liquidos: liquid.invested, gasto_mensal_tipico: essential.value, base: essential.basis, cobertura_de_classificacao: essential.coverage, meta_meses: target },
    }));
  }

  const sSpec = base("seguranca.choque_1_renda", "razao", pointWindow(i.asOf), ["balance", "ledger"]);
  if (i.income.typical === null) indicators.push(noData(sSpec, hist));
  else if (!liquid) indicators.push(noData(sSpec, noSnap));
  else if (i.income.typical <= 0) indicators.push(noData(sSpec, { reasons: ["sem_renda_registrada"], needs: { kind: "capture", code: "renda" } }));
  else {
    const ratio = liquid.total / i.income.typical;
    indicators.push(reading(sSpec, {
      value: ratio, status: ratio >= SHOCK_OK ? "ok" : ratio >= SHOCK_CRITICAL ? "atencao" : "critico", confidence: conf,
      reasons: i.income.regularity === "irregular" ? ["renda_irregular"] : [],
      inputs: { liquidez: liquid.total, renda_tipica: i.income.typical },
    }));
  }
  return { indicators, essential };
}
