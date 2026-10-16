// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E6 — Execução (hábitos). Regularidade de cumprir o que a pessoa combinou (metas por categoria e fim de semana).
// Repetição = regularidade, nunca "hábito formado". Só períodos FECHADOS e comparáveis (mesmo tipo de compromisso).
import type { MapaIndicator } from "./mapaContracts.ts";
import { lastDayOf, noData, reading, type IndicatorSpec } from "./mapaIndicator.ts";
import type { MapaCommitmentPeriod } from "./mapaInputs.ts";
import { mapaAddMonths, mapaMonthOf } from "./mapaMonthly.ts";
import { ADHERENCE_MIN_PERIODS, ADHERENCE_OK_PCT } from "./mapaThresholds.ts";

export const EXECUCAO_FORMULA = "mapa_execucao.v1";
const MONTHS_WINDOW = 6;
const WEEKS_WINDOW = 12;

export interface ExecucaoInput {
  asOf: string;
  goalPeriods: MapaCommitmentPeriod[];
  weekendPeriods: MapaCommitmentPeriod[];
}

const spec = (id: string, unit: IndicatorSpec["unit"], direction: IndicatorSpec["direction"], window: IndicatorSpec["window"]): IndicatorSpec =>
  ({ id, pillar: "execucao", layer: "habitos", unit, direction, window, evidence: ["goal", "ledger"], formula: EXECUCAO_FORMULA });

const shiftDay = (iso: string, d: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

function adherence(periods: MapaCommitmentPeriod[]): { met: number; missed: number; pct: number } | null {
  const met = periods.filter((p) => p.status === "cumprido").length;
  const missed = periods.length - met;
  return periods.length ? { met, missed, pct: (met / periods.length) * 100 } : null;
}

export function computeExecucao(i: ExecucaoInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];
  const current = mapaMonthOf(i.asOf);
  const from = mapaAddMonths(current, -MONTHS_WINDOW);
  const goals = i.goalPeriods.filter((p) => p.period < current && p.period >= from);
  const window = { start: `${from}-01`, end: lastDayOf(mapaAddMonths(current, -1)), kind: "meses_fechados" as const, n: MONTHS_WINDOW };

  const adh = adherence(goals);
  const aSpec = spec("execucao.aderencia", "pct", "higher_better", window);
  if (!adh || goals.length < ADHERENCE_MIN_PERIODS) {
    out.push(noData(aSpec, { reasons: ["poucos_periodos_comparaveis"], needs: { kind: "history", code: "metas_fechadas" }, inputs: { periodos: goals.length, minimo: ADHERENCE_MIN_PERIODS } }));
  } else {
    out.push(reading(aSpec, {
      value: adh.pct, status: adh.pct >= ADHERENCE_OK_PCT ? "ok" : "atencao", confidence: goals.length >= 6 ? "alta" : "moderada",
      inputs: { cumpridos: adh.met, estourados: adh.missed, periodos: goals.length },
      reasons: adh.pct < 25 ? ["aderencia_muito_baixa_revisar_meta"] : [],
    }));
  }

  // Sequência: meses consecutivos (do mais recente para trás) em que TODAS as metas do mês foram cumpridas.
  const byMonth = new Map<string, MapaCommitmentPeriod[]>();
  for (const p of i.goalPeriods) if (p.period < current) (byMonth.get(p.period) ?? byMonth.set(p.period, []).get(p.period)!).push(p);
  const sSpec = spec("execucao.sequencia", "contagem", "neutral", window);
  if (!byMonth.size || goals.length < ADHERENCE_MIN_PERIODS) {
    out.push(noData(sSpec, { reasons: ["poucos_periodos_comparaveis"], needs: { kind: "history", code: "metas_fechadas" } }));
  } else {
    let streak = 0;
    for (let m = mapaAddMonths(current, -1); ; m = mapaAddMonths(m, -1)) {
      const ps = byMonth.get(m);
      if (!ps || ps.some((p) => p.status !== "cumprido")) break;
      streak += 1;
      if (streak > 60) break;
    }
    out.push(reading(sSpec, { value: streak, status: "ok", confidence: goals.length >= 6 ? "alta" : "moderada", inputs: { meses_seguidos: streak } }));
  }

  // Fim de semana: aderência dos combinados (semanal), tipo próprio.
  const since = shiftDay(i.asOf, -7 * WEEKS_WINDOW);
  const weekend = i.weekendPeriods.filter((p) => p.period >= since && p.period < i.asOf);
  const wSpec = spec("execucao.aderencia_fim_de_semana", "pct", "higher_better", { start: since, end: i.asOf, kind: "movel_dias", n: WEEKS_WINDOW * 7 });
  const wAdh = adherence(weekend);
  if (!wAdh || weekend.length < ADHERENCE_MIN_PERIODS) {
    out.push(noData(wSpec, { reasons: ["poucos_periodos_comparaveis"], needs: { kind: "history", code: "combinados_fim_de_semana" }, inputs: { periodos: weekend.length, minimo: ADHERENCE_MIN_PERIODS } }));
  } else {
    out.push(reading(wSpec, {
      value: wAdh.pct, status: wAdh.pct >= ADHERENCE_OK_PCT ? "ok" : "atencao", confidence: weekend.length >= 6 ? "alta" : "moderada",
      inputs: { cumpridos: wAdh.met, estourados: wAdh.missed, periodos: weekend.length },
    }));
  }
  return out;
}

