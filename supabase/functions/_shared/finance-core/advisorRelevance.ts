// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Camada de relevância do consultor (`advisor_relevance.v1`).
//
// NÃO CALCULA FINANÇAS. Recebe highlights já determinísticos (financial_
// performance.v1) e situações (proactive_multifinance.v1) e decide o que
// importa AGORA para este usuário: ordem, profundidade, canal e próxima ação.
//
// Regra dura e não negociável: IMPORTÂNCIA FINANCEIRA > PREFERÊNCIA.
// Afinidade baixa reduz destaque; nunca suprime risco material.
import type {
  FinancialPerformanceHighlight,
  StructuralNature,
} from "./financialPerformance.ts";
import type { EngineConfidence } from "./engineEnvelope.ts";

export const ADVISOR_RELEVANCE_VERSION = "advisor_relevance.v1";

export type AdvisorChannel = "app" | "whatsapp" | "silent";

export type TopicAffinity = {
  /** Chave lógica do tópico (`performance:category:mercado`). */
  topic_key: string;
  /** -1 (rejeita) .. +1 (busca). 0 = neutro/desconhecido. */
  score: number;
  /** Nº de sinais que sustentam o score. */
  signals: number;
  /** Última interação (YYYY-MM-DD) — base do decaimento. */
  last_seen: string | null;
};

export type AdvisorSituation = {
  id: string;
  kind: string;
  severity: "info" | "attention" | "critical";
  title: string;
  body: string;
  amount_at_stake?: number | null;
  topic_key?: string | null;
};

export type AdvisorRankedItem = {
  source: "highlight" | "situation";
  id: string;
  topic_key: string;
  title: string;
  body: string;
  /** Score final de exibição. */
  relevance: number;
  /** Peso financeiro puro, antes da preferência. */
  financial_weight: number;
  /** Ajuste aplicado pela afinidade (informativo — auditável). */
  affinity_adjustment: number;
  severity: "info" | "attention" | "critical";
  sentiment: "positive" | "negative" | "neutral";
  nature: StructuralNature | null;
  confidence: EngineConfidence;
  depth: "headline" | "explained" | "deep";
  actionable: boolean;
  recommended_action: string | null;
  /** Quando suprimido, o motivo é sempre explícito e auditável. */
  suppressed_reason: string | null;
};

export type AdvisorDecision = {
  headline: string;
  /** Itens liberados, já ordenados. */
  items: AdvisorRankedItem[];
  /** Itens avaliados e não exibidos, com motivo. */
  suppressed: AdvisorRankedItem[];
  main_improvement: AdvisorRankedItem | null;
  main_attention: AdvisorRankedItem | null;
  next_action: string | null;
  channel: AdvisorChannel;
  /** Metodologia herdada dos motores — o advisor nunca inventa recorte. */
  methodology: string | null;
  formula_version: string;
};

export type AdvisorInput = {
  highlights: FinancialPerformanceHighlight[];
  situations?: AdvisorSituation[];
  affinity?: TopicAffinity[];
  /** Data local do usuário (NinoClock). */
  as_of: string;
  /** Renda mensal de referência, para materialidade relativa. */
  monthlyIncome?: number | null;
  /** Máximo de itens liberados. Home usa 2–4; WhatsApp usa 1–2. */
  maxItems?: number;
  /** Piso absoluto de materialidade em R$. */
  materialityFloor?: number;
  /** Canal pretendido. `whatsapp` exige severidade/valor maiores. */
  channel?: AdvisorChannel;
};

const AFFINITY_HALF_LIFE_DAYS = 45;

function daysBetween(a: string, b: string): number {
  const x = Date.parse(`${a}T12:00:00Z`);
  const y = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.abs(Math.round((y - x) / 86400000));
}

/** Afinidade decai com o tempo: interesse antigo não manda no presente. */
export function decayedAffinity(a: TopicAffinity, asOf: string): number {
  if (!a.last_seen) return 0;
  const age = daysBetween(a.last_seen, asOf);
  const factor = Math.pow(0.5, age / AFFINITY_HALF_LIFE_DAYS);
  const confidence = Math.min(1, a.signals / 3);
  return Math.max(-1, Math.min(1, a.score * factor * confidence));
}

function confidenceWeight(c: EngineConfidence): number {
  return c === "high" ? 1 : c === "medium" ? 0.8 : c === "low" ? 0.5 : 0.25;
}

/** Peso financeiro: valor em jogo relativo à renda, calibrado por confiança. */
function financialWeightOf(amount: number, monthlyIncome: number | null | undefined, confidence: EngineConfidence): number {
  const base = Math.abs(amount);
  const income = monthlyIncome && monthlyIncome > 0 ? monthlyIncome : null;
  const relative = income ? Math.min(1, base / (income * 0.1)) : Math.min(1, base / 500);
  return Math.round(relative * confidenceWeight(confidence) * 1000) / 1000;
}

function depthOf(weight: number, severity: AdvisorRankedItem["severity"]): AdvisorRankedItem["depth"] {
  if (severity === "critical" || weight >= 0.7) return "deep";
  if (weight >= 0.35) return "explained";
  return "headline";
}

function severityOfHighlight(h: FinancialPerformanceHighlight): AdvisorRankedItem["severity"] {
  if (h.sentiment === "negative" && h.actionable && h.materiality > 0) return "attention";
  return "info";
}

export function computeAdvisorDecision(input: AdvisorInput): AdvisorDecision {
  const asOf = input.as_of;
  const floor = input.materialityFloor ?? 50;
  const channel = input.channel ?? "app";
  const maxItems = input.maxItems ?? (channel === "whatsapp" ? 2 : 4);
  const affinity = new Map(
    (input.affinity ?? []).map((a) => [a.topic_key, decayedAffinity(a, asOf)]),
  );

  const candidates: AdvisorRankedItem[] = [];

  for (const h of input.highlights) {
    const severity = severityOfHighlight(h);
    const weight = financialWeightOf(h.materiality, input.monthlyIncome, h.confidence);
    const adj = affinity.get(h.logical_topic_key) ?? 0;
    // Preferência mexe em ±25%: reordena, nunca apaga o que é material.
    const relevance = Math.round(weight * (1 + adj * 0.25) * 1000) / 1000;
    let suppressed: string | null = null;
    if (Math.abs(h.materiality) < floor) suppressed = "abaixo_do_piso_de_materialidade";
    else if (h.comparability === "invalid") suppressed = "periodos_nao_comparaveis";
    else if (h.confidence === "insufficient_data") suppressed = "dados_insuficientes";
    else if (channel === "whatsapp" && severity === "info" && weight < 0.5) suppressed = "nao_relevante_para_interrupcao";
    candidates.push({
      source: "highlight",
      id: h.id,
      topic_key: h.logical_topic_key,
      title: h.title_fact,
      body: h.interpretation,
      relevance,
      financial_weight: weight,
      affinity_adjustment: Math.round(adj * 1000) / 1000,
      severity,
      sentiment: h.sentiment,
      nature: h.structural_or_timing,
      confidence: h.confidence,
      depth: depthOf(weight, severity),
      actionable: h.actionable,
      recommended_action: h.recommended_action,
      suppressed_reason: suppressed,
    });
  }

  for (const s of input.situations ?? []) {
    const amount = Number(s.amount_at_stake ?? 0);
    const weight = financialWeightOf(amount || floor, input.monthlyIncome, "high");
    const topic = s.topic_key ?? `situation:${s.kind}`;
    const adj = affinity.get(topic) ?? 0;
    // Situação crítica ignora preferência: risco não se negocia com gosto.
    const relevance = s.severity === "critical"
      ? 1 + weight
      : Math.round(weight * (1 + adj * 0.25) * 1000) / 1000;
    candidates.push({
      source: "situation",
      id: s.id,
      topic_key: topic,
      title: s.title,
      body: s.body,
      relevance,
      financial_weight: weight,
      affinity_adjustment: s.severity === "critical" ? 0 : Math.round(adj * 1000) / 1000,
      severity: s.severity,
      sentiment: s.severity === "info" ? "neutral" : "negative",
      nature: null,
      confidence: "high",
      depth: depthOf(weight, s.severity),
      actionable: true,
      recommended_action: null,
      suppressed_reason: null,
    });
  }

  const ordered = candidates.sort((a, b) => {
    if (a.severity !== b.severity) {
      const rank = { critical: 3, attention: 2, info: 1 } as const;
      return rank[b.severity] - rank[a.severity];
    }
    return b.relevance - a.relevance;
  });

  const allowed = ordered.filter((c) => !c.suppressed_reason);
  // Um tópico lógico só aparece uma vez por rodada.
  const seen = new Set<string>();
  const items: AdvisorRankedItem[] = [];
  const suppressed = ordered.filter((c) => c.suppressed_reason);
  for (const c of allowed) {
    if (seen.has(c.topic_key)) {
      suppressed.push({ ...c, suppressed_reason: "topico_duplicado_na_rodada" });
      continue;
    }
    if (items.length >= maxItems) {
      suppressed.push({ ...c, suppressed_reason: "cota_de_atencao_atingida" });
      continue;
    }
    seen.add(c.topic_key);
    items.push(c);
  }

  const main_improvement = items.find((i) => i.sentiment === "positive") ?? null;
  const main_attention = items.find((i) => i.severity !== "info" || i.sentiment === "negative") ?? null;
  const next_action = main_attention?.recommended_action
    ?? items.find((i) => i.recommended_action)?.recommended_action
    ?? null;

  const headline = items.length === 0
    ? "Nada material mudou nesse recorte."
    : items[0].title;

  const decidedChannel: AdvisorChannel = items.length === 0
    ? "silent"
    : (channel === "whatsapp" && !items.some((i) => i.severity !== "info") ? "app" : channel);

  return {
    headline,
    items,
    suppressed,
    main_improvement,
    main_attention,
    next_action,
    channel: decidedChannel,
    methodology: input.highlights[0]?.methodology ?? null,
    formula_version: ADVISOR_RELEVANCE_VERSION,
  };
}

/** Sinal de aprendizado → delta de score. Positivo é pedido, negativo é rejeição. */
export function affinityDeltaOf(signal:
  | "followed_up" | "asked_more" | "acted" | "opened"
  | "ignored" | "dismissed" | "marked_not_useful"): number {
  switch (signal) {
    case "acted": return 0.35;
    case "asked_more":
    case "followed_up": return 0.25;
    case "opened": return 0.1;
    case "ignored": return -0.05;
    case "dismissed": return -0.2;
    case "marked_not_useful": return -0.4;
    default: return 0;
  }
}
