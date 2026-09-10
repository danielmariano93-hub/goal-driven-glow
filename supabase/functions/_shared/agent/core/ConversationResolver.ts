// ConversationResolver (`nino_threads.v1`)
//
// "Sobre o que este turno é?" — com ordem de precedência explícita, em vez de
// assumir que o assunto é sempre a última mensagem.
//
//   1. mensagem citada (WhatsApp reply)     -> autoridade máxima
//   2. expectativa pendente (o Nino perguntou / há rascunho)
//   3. referência explícita ("voltando pra meta da viagem")
//   4. tópico com alta confiança semântica
//   5. tópico ativo
//   6. histórico recente
//   7. assunto novo
//
// Empate plausível entre dois tópicos NÃO chuta: devolve `clarification`.
import type { TopicResolutionSource } from "./ExecutionTrace.ts";
import { topicScore, type TopicThread } from "./TopicRepository.ts";

export type ResolverInput = {
  text: string;
  quoted_message_id?: string | null;
  quoted_topic?: TopicThread | null;
  has_pending_confirmation?: boolean;
  awaiting_answer?: boolean;
  active_topic_id?: string | null;
  topics: TopicThread[];
  now?: Date;
};

export type ResolverOutput = {
  source: TopicResolutionSource;
  topic: TopicThread | null;
  topic_id: string | null;
  score: number | null;
  candidates: Array<{ topic_id: string; score: number }>;
  clarification_required: boolean;
  clarification_options: string[];
  is_new_topic: boolean;
};

const EXPLICIT_RX =
  /\b(voltando|retomando|sobre aquilo|aquela (?:pergunta|conversa)|aquele assunto|falamos (?:antes|ontem|na semana)|lembra (?:quando|que)|volta (?:pra|para))\b/i;

/** Marcas de assunto claramente NOVO: não herdar contexto anterior. */
const NEW_TOPIC_RX = /\b(muda(?:ndo)? de assunto|outra coisa|esquece|deixa (?:isso|pra la)|nova pergunta)\b/i;

const HIGH = 0.6;
const NEAR = 0.12;

export function resolveConversation(input: ResolverInput): ResolverOutput {
  const now = input.now ?? new Date();
  const text = String(input.text ?? "");
  const topics = (input.topics ?? []).filter(Boolean);

  const empty = (source: TopicResolutionSource, extra?: Partial<ResolverOutput>): ResolverOutput => ({
    source, topic: null, topic_id: null, score: null, candidates: [],
    clarification_required: false, clarification_options: [], is_new_topic: false,
    ...extra,
  });

  // 1. mensagem citada
  if (input.quoted_message_id && input.quoted_topic) {
    return {
      source: "quoted_message", topic: input.quoted_topic, topic_id: input.quoted_topic.id,
      score: 1, candidates: [{ topic_id: input.quoted_topic.id, score: 1 }],
      clarification_required: false, clarification_options: [], is_new_topic: false,
    };
  }

  // 2. expectativa pendente (rascunho ou pergunta em aberto do Nino)
  if (input.has_pending_confirmation || input.awaiting_answer) {
    const active = topics.find((t) => t.id === input.active_topic_id) ?? null;
    return {
      source: "pending_expectation", topic: active, topic_id: active?.id ?? null,
      score: active ? 1 : null, candidates: [],
      clarification_required: false, clarification_options: [], is_new_topic: false,
    };
  }

  // Assunto explicitamente novo encerra a herança.
  if (NEW_TOPIC_RX.test(text)) return empty("new_topic", { is_new_topic: true });

  const scored = topics
    .map((t) => ({ topic: t, score: topicScore(text, t, now) }))
    .sort((a, b) => b.score - a.score);
  const candidates = scored.map((s) => ({ topic_id: s.topic.id, score: s.score }));
  const best = scored[0] ?? null;
  const second = scored[1] ?? null;

  // 3. referência explícita
  if (EXPLICIT_RX.test(text) && best && best.score > 0) {
    if (second && best.score - second.score < NEAR && second.score > 0) {
      return {
        source: "clarification", topic: null, topic_id: null, score: best.score, candidates,
        clarification_required: true,
        clarification_options: [best.topic, second.topic].map((t) => t.title || t.subject),
        is_new_topic: false,
      };
    }
    return {
      source: "explicit_reference", topic: best.topic, topic_id: best.topic.id,
      score: best.score, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  // 4. alta confiança semântica (com desempate por clarificação)
  if (best && best.score >= HIGH) {
    if (second && second.score >= HIGH && best.score - second.score < NEAR) {
      return {
        source: "clarification", topic: null, topic_id: null, score: best.score, candidates,
        clarification_required: true,
        clarification_options: [best.topic, second.topic].map((t) => t.title || t.subject),
        is_new_topic: false,
      };
    }
    return {
      source: "semantic_match", topic: best.topic, topic_id: best.topic.id,
      score: best.score, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  // 5. tópico ativo (só quando o turno depende de contexto)
  const active = topics.find((t) => t.id === input.active_topic_id) ?? null;
  if (active && (best?.score ?? 0) > 0) {
    return {
      source: "active_topic", topic: active, topic_id: active.id,
      score: best?.score ?? 0, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  // 6. histórico recente
  if (best && best.score > 0.2) {
    return {
      source: "recent_history", topic: best.topic, topic_id: best.topic.id,
      score: best.score, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  // 7. assunto novo
  return empty("new_topic", { candidates, is_new_topic: true });
}
