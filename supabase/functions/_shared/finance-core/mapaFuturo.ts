// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E5 — Construção de futuro (saúde). Patrimônio, sua variação decomposta, progresso de metas e destino dos resgates.
import type { DataQuality, IncomeBaseline, MapaConfidence, MapaIndicator, MapaStatus } from "./mapaContracts.ts";
import { ledgerConfidence, noData, percent, pointWindow, reading, round, type IndicatorSpec } from "./mapaIndicator.ts";
import type { MapaDatedAmount, MapaSavingsGoalIn, MapaSnapshotInput } from "./mapaInputs.ts";
import { REDEMPTION_MATCH_DAYS } from "./mapaThresholds.ts";

export const FUTURO_FORMULA = "mapa_futuro.v1";

export interface FuturoInput {
  asOf: string;
  dq: DataQuality;
  income: IncomeBaseline;
  snapshot: MapaSnapshotInput | null;
  savingsGoals: MapaSavingsGoalIn[];
  redemptions90: MapaDatedAmount[];
  debtPayments90: MapaDatedAmount[];
}

const spec = (id: string, unit: IndicatorSpec["unit"], asOf: string, evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "futuro", layer: "saude", unit, direction: "higher_better", window: pointWindow(asOf), evidence, formula: FUTURO_FORMULA });

const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

/**
 * Liga resgates a pagamentos de dívida feitos até N dias depois (casamento guloso, cada pagamento usado uma vez).
 * É heurística [provisório]: o que sobra fica "sem destino identificado", nunca "patrimônio destruído".
 */
export function explainRedemptions(redemptions: MapaDatedAmount[], payments: MapaDatedAmount[], windowDays = REDEMPTION_MATCH_DAYS): { total: number; explained_by_debt: number; unexplained: number } {
  const pool = payments.map((p) => ({ ...p, left: p.amount })).sort((a, b) => a.date.localeCompare(b.date));
  let explained = 0, total = 0;
  for (const r of [...redemptions].sort((a, b) => a.date.localeCompare(b.date))) {
    total += r.amount;
    let need = r.amount;
    for (const p of pool) {
      if (need <= 0) break;
      const delta = (dayMs(p.date) - dayMs(r.date)) / DAY;
      if (delta < 0 || delta > windowDays || p.left <= 0) continue;
      const use = Math.min(need, p.left);
      p.left -= use; need -= use; explained += use;
    }
  }
  return { total: round(total), explained_by_debt: round(explained), unexplained: round(total - explained) };
}

const bridgeConf = (c: "high" | "medium" | "low" | null): Exclude<MapaConfidence, "insuficiente"> => (c === "high" ? "alta" : "moderada");

export function computeFuturo(i: FuturoInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];
  const snap = i.snapshot;
  const conf = ledgerConfidence(i.dq, i.income);

  const pSpec = spec("futuro.patrimonio_liquido", "brl", i.asOf, ["balance", "derived"]);
  if (!snap || snap.netWorthNet === null) out.push(noData(pSpec, { reasons: ["sem_snapshot_financeiro"], needs: { kind: "connect", code: "snapshot" } }));
  else out.push(reading(pSpec, { value: snap.netWorthNet, status: snap.netWorthNet >= 0 ? "ok" : "atencao", confidence: i.dq.eligibility.caixa === "ok" ? "alta" : "moderada", inputs: { patrimonio_liquido: round(snap.netWorthNet) } }));

  const vSpec = spec("futuro.variacao_mes", "brl", i.asOf, ["derived"]);
  const b = snap?.bridge;
  if (!b || b.netWorthChange === null) out.push(noData(vSpec, { reasons: ["sem_ponte_patrimonial"], needs: { kind: "connect", code: "snapshot" } }));
  else {
    const status: Exclude<MapaStatus, "sem_dados"> = b.netWorthChange >= 0 ? "ok" : "atencao";
    out.push(reading(vSpec, {
      value: b.netWorthChange, status, confidence: bridgeConf(b.confidence), reasons: ["mes_parcial"],
      inputs: {
        resultado_operacional: b.operationalResult, rendimento: b.investmentReturn, aplicacoes: b.investmentApplications, resgates: b.investmentRedemptions,
        amortizacao_de_divida: b.debtPrincipalChange, valorizacao: b.valuationAdjustments,
      },
    }));
  }

  const gSpec = spec("futuro.progresso_metas", "pct", i.asOf, ["goal"]);
  const goals = i.savingsGoals.filter((g) => g.target_amount > 0);
  if (!goals.length) out.push(noData(gSpec, { reasons: ["sem_metas_de_poupanca"], needs: { kind: "capture", code: "meta_de_poupanca" } }));
  else {
    const saved = goals.reduce((a, g) => a + g.saved_amount, 0), target = goals.reduce((a, g) => a + g.target_amount, 0);
    const progress = saved / target;
    // Ritmo esperado: fração do tempo decorrido entre criação e prazo (só metas com prazo).
    const timed = goals.filter((g) => g.target_date);
    let expected: number | null = null;
    if (timed.length) {
      const exp = timed.reduce((a, g) => {
        const start = dayMs(g.created_at), end = dayMs(g.target_date as string), now = dayMs(i.asOf);
        const frac = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
        return a + frac * g.target_amount;
      }, 0);
      expected = exp / timed.reduce((a, g) => a + g.target_amount, 0);
    }
    const onPace = expected === null || progress >= expected * 0.9;
    out.push(reading(gSpec, { value: percent(progress), status: onPace ? "ok" : "atencao", confidence: "alta", inputs: { metas: goals.length, guardado: round(saved), alvo: round(target), ritmo_esperado_pct: expected === null ? null : percent(expected) } }));
  }

  const rSpec = { ...spec("futuro.resgates_sem_destino", "brl", i.asOf, ["ledger", "derived"]), direction: "lower_better" as const };
  const ex = explainRedemptions(i.redemptions90, i.debtPayments90);
  out.push(reading(rSpec, {
    value: ex.unexplained, status: ex.unexplained <= 0 ? "ok" : "atencao", confidence: "moderada", reasons: ex.total === 0 ? ["sem_resgates_no_periodo"] : [],
    inputs: { resgates_90d: ex.total, usados_em_divida: ex.explained_by_debt },
  }));
  void conf;
  return out;
}
