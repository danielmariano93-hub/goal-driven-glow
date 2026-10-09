// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Contrato puro das dimensões comportamentais (`behavior_observed.v2`).
// Fonte única de nomes, rótulos e tipos usados pelo app (página Emocional) e
// pelas Edge Functions (job semanal e Nino/WhatsApp), espelhada para
// `_shared/finance-core` por scripts/sync-finance-core.mjs. Sem I/O.

export type BehaviorDimensionKey =
  | "awareness"
  | "planning"
  | "control"
  | "consistency"
  | "security"
  | "wealth"
  | "calm"
  | "debt";

export const BEHAVIOR_DIMENSIONS: Array<{
  key: BehaviorDimensionKey;
  label: string;
  short: string;
  question: string;
}> = [
  { key: "awareness", label: "Consciência", short: "Consciência", question: "Quanto você entende hoje para onde seu dinheiro vai e por que você decide gastar?" },
  { key: "planning", label: "Planejamento", short: "Planejamento", question: "Quanto suas decisões financeiras costumam acontecer antes, e não depois do gasto?" },
  { key: "control", label: "Controle de impulso", short: "Controle", question: "Quanto você sente que consegue escolher antes de agir quando surge vontade de gastar?" },
  { key: "consistency", label: "Consistência", short: "Consistência", question: "Quanto seus bons hábitos financeiros sobrevivem às semanas mais corridas?" },
  { key: "security", label: "Segurança", short: "Segurança", question: "Quanto você sente que consegue absorver imprevistos sem perder o controle do mês?" },
  { key: "wealth", label: "Construção de patrimônio", short: "Patrimônio", question: "Quanto você está transformando renda em patrimônio de forma recorrente?" },
  { key: "calm", label: "Tranquilidade com dinheiro", short: "Tranquilidade", question: "Quanto o dinheiro ocupa sua cabeça de forma tranquila, sem pressão desnecessária?" },
  { key: "debt", label: "Relação com dívidas", short: "Dívidas", question: "Quanto você sente que suas dívidas e compromissos estão sob controle?" },
];

export type EmotionalCheckinRow = {
  id: string;
  occurred_at: string;
  mood: number;
  emotion_key?: string | null;
  declared_emotion_key?: string | null;
  trigger_label?: string | null;
  notes?: string | null;
  transaction_id?: string | null;
  financial_calm_score?: number | null;
  financial_control_score?: number | null;
  spending_urge_score?: number | null;
  context_key?: string | null;
};

/** Tranquilidade 0–10 de um check-in: escala direta; senão humor 1–5 × 2. */
export function emotionalScore(row: EmotionalCheckinRow): number {
  if (row.financial_calm_score != null) return Number(row.financial_calm_score);
  return Math.max(0, Math.min(10, Number(row.mood || 0) * 2));
}

export type ObservedFactor = {
  key: string;
  label: string;
  /** Nota 0–10 deste componente; null quando o Nino ainda não tem dado dele. */
  value: number | null;
  /** Peso fixo na nota; null quando o componente é só explicativo. */
  weight: number | null;
};

/** Qualidade da base de uma leitura: nota só com evidência suficiente. */
export type EvidenceState = "sufficient" | "partial" | "none";

/** Registro de proveniência de uma dimensão (`behavior_observed.v3`). */
export type ObservedEvidenceRecord = {
  state: EvidenceState;
  /** Classe de cada fonte: direta (registro do app), derivada (calculada), declarada (informada pelo usuário). */
  origin: Array<{ key: string; label: string; kind: "direct" | "derived" | "declared" }>;
  window: string;
  coverage: string;
  methodology_version: string;
  /** Até três fatos verificáveis que sustentam a leitura. */
  observed: string[];
  /** O que ainda não dá para saber com os dados atuais. */
  unknown: string[];
  /** O que esta dimensão NÃO prova. */
  limit: string;
  /** Por que não há nota (state != sufficient). */
  unavailable_reason: string | null;
};

export type ObservedDimension = {
  score: number | null;
  confidence: "low" | "medium" | "high";
  evidence: string;
  source: string;
  factors?: ObservedFactor[];
  /** v3: estado da evidência e registro explicável. Ausente nas leituras v2. */
  state?: EvidenceState;
  record?: ObservedEvidenceRecord;
};

export type ObservedBehaviorProfile = {
  overallScore: number | null;
  coverage: number;
  asOf: string | null;
  dimensions: Record<BehaviorDimensionKey, ObservedDimension>;
  methodologyVersion?: string;
  overallConfidence?: "low" | "medium" | "high";
  historyDays?: number;
  /** v3: dimensões com sinal parcial (sem nota). */
  partialCount?: number;
};
