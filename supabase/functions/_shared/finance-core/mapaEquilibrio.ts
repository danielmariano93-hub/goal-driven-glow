// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E2 — Equilíbrio financeiro (saúde). Resultado e capacidade de honrar obrigações. Só meses fechados para razões.
import type { DataQuality, IncomeBaseline, MapaIndicator, MapaStatus } from "./mapaContracts.ts";
import { closedWindow, ledgerConfidence, noData, percent, pointWindow, reading, MAPA_ENGINE_VERSION, type IndicatorSpec } from "./mapaIndicator.ts";
import type { MapaSnapshotInput } from "./mapaInputs.ts";
import { lastClosedActiveMonths, type MapaMonthAgg } from "./mapaMonthly.ts";
import { COVERAGE_CRITICAL, COVERAGE_OK, SAVINGS_OK_PCT } from "./mapaThresholds.ts";

export const EQUILIBRIO_FORMULA = "mapa_equilibrio.v1";
const COVERAGE_CAP = 10;

export interface EquilibrioInput {
  asOf: string;
  months: MapaMonthAgg[];
  dq: DataQuality;
  income: IncomeBaseline;
  snapshot: MapaSnapshotInput | null;
}

const base = (id: string, unit: IndicatorSpec["unit"], direction: IndicatorSpec["direction"], window: IndicatorSpec["window"], evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "equilibrio", layer: "saude", unit, direction, window, evidence, formula: EQUILIBRIO_FORMULA });

/** Inclinação por mínimos quadrados de y em x = 0..n-1. */
export function olsSlope(y: number[]): number | null {
  const n = y.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  y.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
  return den === 0 ? null : num / den;
}

const stdev = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

export function computeEquilibrio(i: EquilibrioInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];
  const last3 = lastClosedActiveMonths(i.months, 3);
  const last6 = lastClosedActiveMonths(i.months, 6);
  const ratiosBlocked = i.dq.eligibility.razoes_de_renda === "bloqueado" || last3.length < 3;
  const hist = { reasons: ["poucos_meses_fechados"], needs: { kind: "history" as const, code: "meses_fechados" } };
  const conf = ledgerConfidence(i.dq, i.income);
  const irregular = i.income.regularity === "irregular" ? ["renda_irregular"] : [];

  // resultado dos 3 últimos meses fechados
  const rSpec = base("equilibrio.resultado_3m", "brl", "higher_better", closedWindow(last3), ["ledger"]);
  if (ratiosBlocked) out.push(noData(rSpec, hist));
  else {
    const results = last3.map((m) => m.income - m.consumption);
    const total = results.reduce((a, b) => a + b, 0);
    // Mesmo critério da taxa de poupança (são o mesmo fato em duas unidades): negativo = crítico; abaixo da referência = atenção.
    const income3r = last3.reduce((a, m) => a + m.income, 0);
    const pctr = income3r > 0 ? (total / income3r) * 100 : total < 0 ? -100 : 0;
    const status: Exclude<MapaStatus, "sem_dados"> = total < 0 ? "critico" : pctr >= SAVINGS_OK_PCT ? "ok" : "atencao";
    out.push(reading(rSpec, {
      value: total, status, confidence: conf, reasons: irregular,
      inputs: { renda_3m: last3.reduce((a, m) => a + m.income, 0), consumo_3m: last3.reduce((a, m) => a + m.consumption, 0), meses_negativos: results.filter((r) => r < 0).length },
    }));
  }

  // taxa de poupança agregada (Σresultado ÷ Σrenda), nunca com mês parcial
  const sSpec = base("equilibrio.taxa_poupanca_3m", "pct", "higher_better", closedWindow(last3), ["ledger"]);
  const income3 = last3.reduce((a, m) => a + m.income, 0);
  if (ratiosBlocked) out.push(noData(sSpec, hist));
  else if (income3 <= 0) out.push(noData(sSpec, { reasons: ["sem_renda_registrada"], needs: { kind: "capture", code: "renda" } }));
  else {
    const res = income3 - last3.reduce((a, m) => a + m.consumption, 0);
    const pct = percent(res / income3);
    out.push(reading(sSpec, { value: pct, status: pct >= SAVINGS_OK_PCT ? "ok" : pct >= 0 ? "atencao" : "critico", confidence: conf, reasons: irregular, inputs: { renda_3m: income3, resultado_3m: res } }));
  }

  // cobertura das obrigações até o fim do mês por dinheiro certo / com renda estimada
  const snap = i.snapshot;
  for (const withEstimate of [false, true]) {
    const spec = base(withEstimate ? "equilibrio.cobertura_mes_com_estimativa" : "equilibrio.cobertura_mes", "razao", "higher_better", pointWindow(i.asOf), withEstimate ? ["balance", "estimate"] : ["balance", "ledger"]);
    if (!snap || snap.availableToday === null || snap.knownFutureCommitments === null) { out.push(noData(spec, { reasons: ["sem_snapshot_financeiro"], needs: { kind: "connect", code: "snapshot" } })); continue; }
    const inflows = (snap.confirmedFutureInflows ?? 0) + (withEstimate ? snap.estimatedFixedInflows ?? 0 : 0);
    const obligations = snap.knownFutureCommitments + (snap.cardDueThisMonth ?? 0);
    const available = snap.availableToday + inflows;
    const ratio = obligations <= 0 ? COVERAGE_CAP : Math.min(COVERAGE_CAP, available / obligations);
    const status: Exclude<MapaStatus, "sem_dados"> = ratio >= COVERAGE_OK ? "ok" : ratio >= COVERAGE_CRITICAL ? "atencao" : "critico";
    out.push(reading(spec, {
      value: ratio, status, confidence: i.dq.eligibility.caixa === "ok" ? (withEstimate ? "moderada" : "alta") : "moderada",
      reasons: obligations <= 0 ? ["sem_obrigacoes_no_mes"] : [],
      inputs: { dinheiro_hoje: snap.availableToday, entradas: inflows, obrigacoes: obligations, fatura: snap.cardDueThisMonth ?? 0 },
    }));
  }

  // tendência do resultado mensal (4 a 6 meses fechados)
  const tSpec = base("equilibrio.tendencia", "brl", "higher_better", closedWindow(last6), ["ledger"]);
  if (i.dq.eligibility.tendencias === "bloqueado" || last6.length < 4) out.push(noData(tSpec, { reasons: ["poucos_meses_fechados"], needs: { kind: "history", code: "meses_fechados_4" } }));
  else {
    const results = last6.map((m) => m.income - m.consumption);
    const slope = olsSlope(results) ?? 0;
    const sd = stdev(results);
    out.push(reading(tSpec, { value: slope, status: slope < -0.5 * sd ? "atencao" : "ok", confidence: conf, reasons: irregular, inputs: { meses: last6.length, desvio_resultado: sd, significativa: Math.abs(slope) > 0.5 * sd ? 1 : 0 } }));
  }
  return out;
}
