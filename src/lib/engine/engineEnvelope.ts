// Envelope canônico dos motores determinísticos do Nino (`nino_engines.v1`).
// Toda resposta de motor carrega fatos + evidência + confiança. A LLM só explica:
// nenhum número pode nascer fora daqui.

export type EngineConfidence = "high" | "medium" | "low" | "insufficient_data";

export interface EnginePeriod {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface EngineEvidence {
  period: EnginePeriod;
  comparison_period: EnginePeriod | null;
  sample_size: number;
  exclusions: string[];
  formula_version: string;
  notes: string[];
}

export interface EngineEnvelope<F, B = unknown, D = unknown> {
  engine: string;
  facts: F;
  breakdown: B[];
  drivers: D[];
  evidence: EngineEvidence;
  confidence: EngineConfidence;
}

export const NINO_ENGINES_VERSION = "nino_engines.v1";

/** Exclusões contábeis comuns a todos os motores comportamentais. */
export const CANONICAL_EXCLUSIONS = [
  "transferências entre contas próprias",
  "aplicações e resgates de investimento",
  "pagamentos de fatura de cartão",
  "lançamentos supersedidos (corrigidos)",
  "lançamentos não confirmados",
];

/** Estorno abate a despesa original (categoria e estabelecimento da compra). */
export const REFUND_EXCLUSION = "estornos abatem a compra original (valor líquido)";

export function confidenceFromSample(
  sampleSize: number,
  opts?: { minSample?: number; goodSample?: number; hasComparison?: boolean },
): EngineConfidence {
  const min = opts?.minSample ?? 3;
  const good = opts?.goodSample ?? 12;
  if (sampleSize < min) return "insufficient_data";
  if (sampleSize >= good && opts?.hasComparison !== false) return "high";
  if (sampleSize >= Math.ceil(good / 2)) return "medium";
  return "low";
}

export function makeEvidence(input: {
  period: EnginePeriod;
  comparisonPeriod?: EnginePeriod | null;
  sampleSize: number;
  formulaVersion: string;
  exclusions?: string[];
  notes?: string[];
}): EngineEvidence {
  return {
    period: input.period,
    comparison_period: input.comparisonPeriod ?? null,
    sample_size: input.sampleSize,
    exclusions: input.exclusions ?? [...CANONICAL_EXCLUSIONS, REFUND_EXCLUSION],
    formula_version: input.formulaVersion,
    notes: input.notes ?? [],
  };
}

export function makeEnvelope<F, B = unknown, D = unknown>(input: {
  engine: string;
  facts: F;
  breakdown?: B[];
  drivers?: D[];
  evidence: EngineEvidence;
  confidence: EngineConfidence;
}): EngineEnvelope<F, B, D> {
  return {
    engine: input.engine,
    facts: input.facts,
    breakdown: input.breakdown ?? [],
    drivers: input.drivers ?? [],
    evidence: input.evidence,
    confidence: input.confidence,
  };
}

/** Diferença percentual segura (null quando não há base comparável). */
export function safePct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Desvio absoluto mediano — robusto a outliers, base das bandas pessoais. */
export function madOf(values: number[]): number {
  if (values.length === 0) return 0;
  const med = medianOf(values);
  return medianOf(values.map((v) => Math.abs(v - med)));
}

export function stdDevOf(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

export function shiftDays(date: string, days: number): string {
  const base = Date.parse(`${date}T12:00:00Z`);
  const next = new Date(base + days * 86400000);
  return next.toISOString().slice(0, 10);
}

/** Janela imediatamente anterior, de mesmo tamanho. */
export function previousWindow(period: EnginePeriod): EnginePeriod {
  const size = daysBetweenInclusive(period.from, period.to);
  return { from: shiftDays(period.from, -size), to: shiftDays(period.from, -1) };
}

export const WEEKDAY_LABELS_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}
