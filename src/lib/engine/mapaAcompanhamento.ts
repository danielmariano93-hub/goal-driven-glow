// E8 — Acompanhamento (hábitos). EXPLORATÓRIO: construto novo, sem validação na literatura. Sempre rotulado assim na tela.
// A pessoa tem noção de quanto gasta? Compara o que ela ESTIMOU com o que o ledger mostra (mês fechado).
import type { MapaIndicator } from "./mapaContracts";
import { noData, pointWindow, reading, round, percent, type IndicatorSpec } from "./mapaIndicator";
import type { MapaMonthlyEstimate } from "./mapaInputs";
import { aggregateMonths, mapaMonthOf, type MapaMonthlyEntry } from "./mapaMonthly";
import { CALIBRATION_MIN_ANSWERS, CALIBRATION_OK_PCT, INTENT_MIN_ANSWERS } from "./mapaThresholds";

export const ACOMPANHAMENTO_FORMULA = "mapa_acompanhamento.v1";
const MAX_ESTIMATES = 6;

export interface AcompanhamentoInput {
  asOf: string;
  entries: MapaMonthlyEntry[];
  estimates: MapaMonthlyEstimate[];
  usefulEvents: number;
  notUsefulEvents: number;
}

const spec = (id: string, unit: IndicatorSpec["unit"], direction: IndicatorSpec["direction"], asOf: string, evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "acompanhamento", layer: "habitos", unit, direction, window: pointWindow(asOf), evidence, formula: ACOMPANHAMENTO_FORMULA });

/** Categoria de despesa que mais pesou no mês. */
export function topExpenseCategory(entries: MapaMonthlyEntry[], month: string): { id: string; amount: number } | null {
  const per = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== "expense" || !e.category_id || mapaMonthOf(e.date) !== month) continue;
    per.set(e.category_id, (per.get(e.category_id) ?? 0) + e.amount);
  }
  let best: { id: string; amount: number } | null = null;
  for (const [id, amount] of per) if (amount > 0 && (!best || amount > best.amount)) best = { id, amount };
  return best;
}

export function computeAcompanhamento(i: AcompanhamentoInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];
  const months = aggregateMonths(i.entries, i.asOf);
  const real = new Map(months.filter((m) => m.closed && m.entries > 0).map((m) => [m.month, m.consumption]));
  // uma estimativa por mês (a mais recente), só de meses fechados com gasto real conhecido
  const latest = new Map<string, MapaMonthlyEstimate>();
  for (const e of [...i.estimates].sort((a, b) => a.answered_at.localeCompare(b.answered_at))) latest.set(e.month, e);
  const usable = [...latest.values()].filter((e) => (real.get(e.month) ?? 0) > 0).sort((a, b) => b.month.localeCompare(a.month)).slice(0, MAX_ESTIMATES);

  const cSpec = spec("acompanhamento.calibragem_total", "pct", "lower_better", i.asOf, ["declared", "ledger"]);
  if (usable.length < CALIBRATION_MIN_ANSWERS) {
    out.push(noData(cSpec, { reasons: ["poucas_respostas", "exploratorio"], needs: { kind: "capture", code: "estimativa_mensal" }, inputs: { respostas: usable.length, minimo: CALIBRATION_MIN_ANSWERS } }));
  } else {
    const errors = usable.map((e) => Math.abs(e.estimate - real.get(e.month)!) / real.get(e.month)!);
    const mean = (errors.reduce((a, b) => a + b, 0) / errors.length) * 100;
    const signed = usable.reduce((a, e) => a + (e.estimate - real.get(e.month)!) / real.get(e.month)!, 0) / usable.length * 100;
    out.push(reading(cSpec, {
      value: round(mean, 1), status: mean <= CALIBRATION_OK_PCT ? "ok" : "atencao", confidence: "moderada",
      inputs: { respostas: usable.length, vies_medio_pct: round(signed, 1), ultimo_estimado: usable[0].estimate, ultimo_real: round(real.get(usable[0].month)!) },
      reasons: ["exploratorio"],
    }));
  }

  const tSpec = spec("acompanhamento.categoria_que_mais_pesou", "pct", "higher_better", i.asOf, ["declared", "ledger"]);
  const withTop = usable.filter((e) => e.top_category_id);
  if (withTop.length < CALIBRATION_MIN_ANSWERS) {
    out.push(noData(tSpec, { reasons: ["poucas_respostas", "exploratorio"], needs: { kind: "capture", code: "estimativa_mensal" }, inputs: { respostas: withTop.length, minimo: CALIBRATION_MIN_ANSWERS } }));
  } else {
    const hits = withTop.filter((e) => topExpenseCategory(i.entries, e.month)?.id === e.top_category_id).length;
    out.push(reading(tSpec, {
      value: percent(hits / withTop.length), status: hits / withTop.length >= 0.5 ? "ok" : "atencao", confidence: "moderada",
      inputs: { acertos: hits, respostas: withTop.length }, reasons: ["exploratorio"],
    }));
  }

  // Insights úteis: proxy do "isso faz sentido?" (a pessoa marca útil / não útil). Não mede percepção de padrão em si.
  const uSpec = spec("acompanhamento.reconhecimento_padroes", "pct", "neutral", i.asOf, ["declared"]);
  const total = i.usefulEvents + i.notUsefulEvents;
  if (total < INTENT_MIN_ANSWERS) {
    out.push(noData(uSpec, { reasons: ["poucas_respostas", "exploratorio"], inputs: { respostas: total, minimo: INTENT_MIN_ANSWERS } }));
  } else {
    out.push(reading(uSpec, { value: percent(i.usefulEvents / total), status: "ok", confidence: total >= 10 ? "alta" : "moderada", inputs: { uteis: i.usefulEvents, respondidas: total }, reasons: ["exploratorio"] }));
  }
  return out;
}
