// Mapa Financeiro — contratos (`mapa_financeiro.v1`). Especificação: docs/mapa-financeiro-especificacao-tecnica.md.
// Puro, sem I/O. Espelhado para as Edge Functions por scripts/sync-finance-core.mjs.

export const MAPA_CONTRACT = "mapa_financeiro.v1";

export type MapaLayer = "saude" | "habitos" | "bem_estar";
export type MapaPillarId =
  | "equilibrio" | "seguranca" | "dividas" | "futuro"          // saúde financeira
  | "execucao" | "planejamento" | "acompanhamento"             // hábitos
  | "bem_estar";                                               // bem-estar percebido
export type MapaDirection = "higher_better" | "lower_better" | "neutral";
export type MapaStatus = "ok" | "atencao" | "critico" | "sem_dados";
export type MapaConfidence = "alta" | "moderada" | "insuficiente";
export type MapaEvidenceKind = "ledger" | "balance" | "goal" | "declared" | "estimate" | "derived";
export type MapaUnit = "meses" | "pct" | "pct_pontos" | "brl" | "dias" | "contagem" | "pontos_cfpb" | "razao";

export interface MapaWindow {
  start: string;
  end: string;
  kind: "meses_fechados" | "movel_dias" | "pontual";
  n: number;
}

export interface MapaChange {
  previous: number | null;
  delta: number | null;
  direction: "melhorou" | "piorou" | "parecido" | "indefinido";
  comparable: boolean;
  not_comparable_reason?: "formula_changed" | "data_completeness_changed" | "window_mismatch" | "within_measurement_error";
}

export interface MapaIndicator {
  /** ex.: "seguranca.meses_cobertos" */
  id: string;
  pillar: MapaPillarId;
  layer: MapaLayer;
  value: number | null;
  unit: MapaUnit;
  direction: MapaDirection;
  status: MapaStatus;
  confidence: MapaConfidence;
  window: MapaWindow;
  evidence: MapaEvidenceKind[];
  /** Numerador, denominador e demais insumos: tudo auditável. */
  inputs: Record<string, number | string | null>;
  /** Códigos de motivo: "no_income_history", "essential_flag_missing"... */
  reasons: string[];
  /** O que destrava um indicador sem dados. */
  needs?: { kind: "capture" | "history" | "connect"; code: string };
  change?: MapaChange | null;
  formula_version: string;
}

// ---- E0: qualidade dos dados -------------------------------------------------------------------------------------
export type DataQualityFlag =
  | "sem_dados"
  | "poucos_meses_fechados"
  | "sem_lancamentos_recentes"
  | "meses_sem_registro"
  | "sync_desatualizado"
  | "conciliacao_divergente";

export type Eligibility = "ok" | "parcial" | "bloqueado";

/** Grupos de indicadores que dependem da mesma condição de dados. */
export type EligibilityGroup = "razoes_de_renda" | "tendencias" | "caixa" | "recencia";

export interface DataQuality {
  /** Meses civis entre o primeiro lançamento e a data de referência (inclui o mês corrente). */
  months_history: number;
  /** Meses fechados com algum registro. */
  closed_months: number;
  /** Meses fechados dentro do período de uso sem nenhum registro (lacuna). */
  gap_months: number;
  last_entry_age_days: number | null;
  last_sync_age_days: number | null;
  reconciliation_difference: number | null;
  flags: DataQualityFlag[];
  eligibility: Record<EligibilityGroup, Eligibility>;
}

// ---- E1: renda típica ---------------------------------------------------------------------------------------------
export type IncomeRegularity = "regular" | "variavel" | "irregular" | "insuficiente";

export interface IncomeBaseline {
  /** Mediana da renda operacional dos meses fechados (até 6). null sem histórico mínimo. */
  typical: number | null;
  /** Coeficiente de variação (desvio-padrão amostral ÷ média). */
  cv: number | null;
  regularity: IncomeRegularity;
  months_used: number;
  /** Renda recebida no mês em andamento. Informativo: nunca entra em razão. */
  mtd_received: number;
  confidence: MapaConfidence;
  reasons: string[];
  formula_version: string;
}

// ---- E11/E13 (tipos mínimos, preenchidos nas fases seguintes) ----------------------------------------------------
export interface StructuralFlags {
  essential_share_of_income: number | null;
  debt_service_ratio: number | null;
  negative_result_streak: number | null;
  structural: boolean | null;
}

export type MapaRecommendationKind = "estrutural" | "comportamento";
export type MapaActionType =
  | "renegociar_dividas" | "regularizar_atrasos" | "revisar_essenciais" | "fechar_a_conta"
  | "criar_reserva" | "ajustar_meta" | "cadastrar_contas_fixas" | "plano_de_pagamento";

export interface MapaRecommendation {
  /** Estável por situação (ex.: "estrutural:revisar_essenciais"): é a chave de supressão. */
  id: string;
  kind: MapaRecommendationKind;
  indicator_ids: string[];
  rationale_keys: string[];
  action: { type: MapaActionType; deeplink: string; params?: Record<string, string | number> };
  /** severidade × reversibilidade × confiança (apenas para ordenar; não é mostrado). */
  priority_score: number;
  suppress_until?: string;
  guardrails: string[];
}

/** Leitura guardada em `map_readings` (insumo do E10). */
export interface MapaStoredReading {
  indicator_id: string;
  /** Data da leitura (YYYY-MM-DD). */
  as_of: string;
  value: number | null;
  formula_version: string;
  /** Fim da janela do indicador quando é de meses fechados (identifica o período). */
  window_end: string | null;
  window_kind: "meses_fechados" | "movel_dias" | "pontual" | null;
  window_n: number | null;
  /** Qualidade dos dados na hora da leitura (para detectar mudança de completude). */
  dq_signature: string | null;
}

/** Feedback da pessoa sobre uma recomendação (insumo do E11). */
export interface MapaRecommendationFeedback {
  rec_id: string;
  event: "shown" | "accepted" | "dismissed" | "useful" | "not_useful";
  at: string;
}

export interface MapaQuestionDue {
  kind: "cfpb" | "estimativa_mensal" | "planejado_vs_hora" | "taxa_divida" | "essencial_categoria" | "liquidez_investimento";
  reason: string;
  priority: number;
}

export interface MapaReading {
  contract: typeof MAPA_CONTRACT;
  as_of: string;
  data_quality: DataQuality;
  income: IncomeBaseline;
  indicators: MapaIndicator[];
  structural: StructuralFlags;
  recommendation: MapaRecommendation | null;
  questions_due: MapaQuestionDue[];
}

/**
 * Invariantes do contrato (testadas e usáveis como guarda em tempo de execução). Devolve a lista de violações.
 *  - value === null ⇔ status === "sem_dados"
 *  - status !== "sem_dados" ⇒ confidence !== "insuficiente"
 *  - nenhum número NaN/Infinity
 *  - id começa pelo pilar
 *  - change.direction coerente com a direção favorável do indicador
 */
export function validateMapaReading(reading: MapaReading): string[] {
  const out: string[] = [];
  if (reading.contract !== MAPA_CONTRACT) out.push("contract_invalid");
  const bad = (n: unknown) => typeof n === "number" && !Number.isFinite(n);
  const seen = new Set<string>();
  for (const ind of reading.indicators) {
    const tag = `indicator:${ind.id}`;
    if (seen.has(ind.id)) out.push(`${tag}:duplicated`);
    seen.add(ind.id);
    if (!ind.id.startsWith(`${ind.pillar}.`)) out.push(`${tag}:id_not_prefixed_by_pillar`);
    if ((ind.value === null) !== (ind.status === "sem_dados")) out.push(`${tag}:value_status_mismatch`);
    if (ind.status !== "sem_dados" && ind.confidence === "insuficiente") out.push(`${tag}:confidence_insufficient_with_status`);
    if (bad(ind.value)) out.push(`${tag}:non_finite_value`);
    for (const [k, v] of Object.entries(ind.inputs)) if (bad(v)) out.push(`${tag}:non_finite_input:${k}`);
    if (ind.status === "sem_dados" && !ind.needs && ind.reasons.length === 0) out.push(`${tag}:sem_dados_without_reason`);
    const ch = ind.change;
    if (ch && ch.comparable && ch.direction !== "indefinido" && ch.direction !== "parecido" && ind.direction === "neutral") out.push(`${tag}:direction_on_neutral`);
    if (ch && ch.comparable && ch.delta != null && ind.direction !== "neutral" && ch.direction !== "parecido") {
      const improved = ind.direction === "higher_better" ? ch.delta > 0 : ch.delta < 0;
      if (improved !== (ch.direction === "melhorou")) out.push(`${tag}:change_direction_wrong`);
    }
  }
  const inc = reading.income;
  if (inc.typical !== null && !Number.isFinite(inc.typical)) out.push("income:non_finite_typical");
  // renda típica exige ≥ 3 meses fechados (renda zero em 3+ meses é um valor válido: 0, sem regularidade calculável)
  if (inc.typical !== null && inc.months_used < 3) out.push("income:typical_without_history");
  return out;
}
