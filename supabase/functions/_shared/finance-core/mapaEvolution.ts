// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E10 — Evolução. Compara cada indicador com a leitura anterior COMPARÁVEL e diz se melhorou, piorou ou ficou parecido,
// aplicando o sentido favorável de cada indicador (dívida que cai = melhorou). Nunca compara o que não é comparável.
import type { MapaChange, MapaIndicator, MapaReading, MapaStoredReading } from "./mapaContracts.ts";

export const EVOLUTION_FORMULA = "mapa_evolution.v1";
/** Leituras pontuais só se comparam com uma leitura de pelo menos esta distância (dias). */
export const POINT_MIN_GAP_DAYS = 6;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Quanto precisa mudar para deixar de ser "parecido". Em unidade do indicador. */
export function similarityMargin(unit: MapaIndicator["unit"], previous: number): number {
  const rel = Math.abs(previous) * 0.05;
  switch (unit) {
    case "pct": case "pct_pontos": return 2;
    case "pontos_cfpb": return 14;
    case "meses": return Math.max(0.25, rel);
    case "razao": return Math.max(0.03, rel);
    case "brl": return Math.max(100, rel);
    case "dias": return 1;
    case "contagem": return 0;
    default: return rel;
  }
}

/** Assinatura da qualidade dos dados: mudou = a completude mudou (conta nova, lacuna, conciliação). */
export function dqSignature(reading: Pick<MapaReading, "data_quality">): string {
  const dq = reading.data_quality;
  return [dq.closed_months, dq.gap_months, [...dq.flags].sort().join("+")].join("|");
}

function periodKey(ind: Pick<MapaIndicator, "window">, asOf: string): string {
  return ind.window.kind === "meses_fechados" && ind.window.end ? ind.window.end : asOf;
}

/** Leitura anterior comparável (mais recente de um período anterior), ou a mais recente de qualquer tipo para explicar o porquê. */
function pickPrevious(ind: MapaIndicator, history: MapaStoredReading[], asOf: string): MapaStoredReading | null {
  const current = periodKey(ind, asOf);
  const candidates = history
    .filter((h) => h.indicator_id === ind.id && h.as_of < asOf)
    .filter((h) => (h.window_kind === "meses_fechados" && h.window_end ? h.window_end < current : daysBetween(h.as_of, asOf) >= POINT_MIN_GAP_DAYS))
    .sort((a, b) => b.as_of.localeCompare(a.as_of));
  return candidates[0] ?? null;
}

export function computeChange(ind: MapaIndicator, history: MapaStoredReading[], asOf: string, signature: string): MapaChange | null {
  const prev = pickPrevious(ind, history, asOf);
  if (!prev) return null;
  const base = { previous: prev.value, delta: null as number | null };
  if (ind.value === null || prev.value === null) return { ...base, direction: "indefinido", comparable: false };
  if (prev.formula_version !== ind.formula_version) return { ...base, direction: "indefinido", comparable: false, not_comparable_reason: "formula_changed" };
  if (prev.window_kind !== ind.window.kind || (ind.window.kind === "meses_fechados" && prev.window_n !== ind.window.n)) {
    return { ...base, direction: "indefinido", comparable: false, not_comparable_reason: "window_mismatch" };
  }
  if (prev.dq_signature !== null && prev.dq_signature !== signature) {
    return { ...base, direction: "indefinido", comparable: false, not_comparable_reason: "data_completeness_changed" };
  }
  const delta = Math.round((ind.value - prev.value) * 100) / 100;
  if (ind.direction === "neutral") return { previous: prev.value, delta, direction: "parecido", comparable: true };
  if (Math.abs(delta) <= similarityMargin(ind.unit, prev.value)) return { previous: prev.value, delta, direction: "parecido", comparable: true };
  const improved = ind.direction === "higher_better" ? delta > 0 : delta < 0;
  return { previous: prev.value, delta, direction: improved ? "melhorou" : "piorou", comparable: true };
}

/** Preenche `change` de todos os indicadores (não muda valor, status nem confiança). */
export function applyEvolution(indicators: MapaIndicator[], history: MapaStoredReading[], asOf: string, signature: string): MapaIndicator[] {
  if (!history.length) return indicators;
  return indicators.map((ind) => ({ ...ind, change: computeChange(ind, history, asOf, signature) }));
}

/** Linhas a gravar em `map_readings` (uma por indicador por semana: reenviar no mesmo dia sobrescreve). */
export function storedRows(reading: MapaReading): Array<MapaStoredReading & { status: string; confidence: string; unit: string; inputs: MapaIndicator["inputs"] }> {
  const signature = dqSignature(reading);
  return reading.indicators.map((i) => ({
    indicator_id: i.id, as_of: reading.as_of, value: i.value, formula_version: i.formula_version,
    window_end: i.window.end || null, window_kind: i.window.kind, window_n: i.window.n, dq_signature: signature,
    status: i.status, confidence: i.confidence, unit: i.unit, inputs: i.inputs,
  }));
}
