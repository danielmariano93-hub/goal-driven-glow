// Fábrica de indicadores do Mapa Financeiro: garante que toda leitura nasce válida pelo contrato.
import type {
  DataQuality, IncomeBaseline, MapaConfidence, MapaDirection, MapaEvidenceKind, MapaIndicator, MapaLayer, MapaPillarId,
  MapaStatus, MapaUnit, MapaWindow,
} from "./mapaContracts";
import type { MapaMonthAgg } from "./mapaMonthly";

export const MAPA_ENGINE_VERSION = "mapa_engines.v1";

export const lastDayOf = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function closedWindow(months: MapaMonthAgg[]): MapaWindow {
  const first = months[0]?.month, last = months[months.length - 1]?.month;
  return first && last
    ? { start: `${first}-01`, end: lastDayOf(last), kind: "meses_fechados", n: months.length }
    : { start: "", end: "", kind: "meses_fechados", n: 0 };
}

export function pointWindow(date: string): MapaWindow {
  return { start: date, end: date, kind: "pontual", n: 1 };
}

export interface IndicatorSpec {
  id: string;
  pillar: MapaPillarId;
  layer: MapaLayer;
  unit: MapaUnit;
  direction: MapaDirection;
  window: MapaWindow;
  evidence: MapaEvidenceKind[];
  formula: string;
}

export function reading(spec: IndicatorSpec, r: {
  value: number; status: Exclude<MapaStatus, "sem_dados">; confidence: Exclude<MapaConfidence, "insuficiente">;
  inputs: Record<string, number | string | null>; reasons?: string[]; needs?: MapaIndicator["needs"];
}): MapaIndicator {
  return {
    id: spec.id, pillar: spec.pillar, layer: spec.layer, value: round(r.value), unit: spec.unit, direction: spec.direction,
    status: r.status, confidence: r.confidence, window: spec.window, evidence: spec.evidence, inputs: r.inputs,
    reasons: r.reasons ?? [], ...(r.needs ? { needs: r.needs } : {}), change: null, formula_version: spec.formula,
  };
}

export function noData(spec: IndicatorSpec, r: { reasons: string[]; needs?: MapaIndicator["needs"]; inputs?: Record<string, number | string | null> }): MapaIndicator {
  return {
    id: spec.id, pillar: spec.pillar, layer: spec.layer, value: null, unit: spec.unit, direction: spec.direction,
    status: "sem_dados", confidence: "insuficiente", window: spec.window, evidence: spec.evidence, inputs: r.inputs ?? {},
    reasons: r.reasons, ...(r.needs ? { needs: r.needs } : {}), change: null, formula_version: spec.formula,
  };
}

export const round = (v: number, d = 2) => {
  const p = 10 ** d;
  return Math.round((v + Number.EPSILON) * p) / p;
};

/** Confiança de indicadores calculados sobre o ledger: limitada por conciliação, lacunas, sync e renda irregular. */
export function ledgerConfidence(dq: DataQuality, income: IncomeBaseline): Exclude<MapaConfidence, "insuficiente"> {
  const degraded = dq.flags.includes("conciliacao_divergente") || dq.flags.includes("meses_sem_registro") || dq.flags.includes("sync_desatualizado");
  if (degraded || income.regularity === "irregular" || dq.closed_months < 6) return "moderada";
  return "alta";
}

export const percent = (fraction: number) => round(fraction * 100, 1);
