// ConversationResolver (`nino_threads.v2`)
//
// "Sobre o que este turno é?" — com ordem de precedência explícita.
//
//   1. mensagem citada (WhatsApp reply)     -> autoridade máxima
//   2. expectativa pendente (o Nino perguntou / há rascunho)
//   3. referência explícita ("voltando pra meta da viagem")
//   4. follow-up contextual                 -> tópico ativo
//   5. tópico com alta confiança semântica
//   6. tópico ativo com algum match
//   7. histórico recente
//   8. assunto novo
//
// A mudança v2 é deliberada: uma pergunta como "esses valores são médias ou
// totais?" não pode ser sequestrada por uma thread histórica lexicalmente
// parecida enquanto existe um tópico ativo que produziu "esses valores".
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

const NEW_TOPIC_RX = /\b(muda(?:ndo)? de assunto|outra coisa|esquece|deixa (?:isso|pra la)|nova pergunta)\b/i;

const CONTEXTUAL_FOLLOWUP_RX = /^(?:e\s+)?(?:ela|ele|elas|eles|isso|nisso|esse|essa|esses|essas|dessa|dessas|desse|desses|aquela|aquele|aqueles|aquelas|qual|quais|quanto|quantos|quanta|quantas|como|por que|porque|entao|agora)\b|\b(?:esses valores|essas categorias|entre elas|entre esses|mais acima|menos acima|mais abaixo|menos abaixo|quanto acima|quanto abaixo|media mensal|medias mensais|valores totais|qual delas|qual deles)\b/i;

const HIGH = 0.6;
const NEAR = 0.12;

function normalized(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function looksContextDependentFollowup(text: string): boolean {
  const value = normalized(text);
  if (!value || NEW_TOPIC_RX.test(value) || EXPLICIT_RX.test(value)) return false;
  if (CONTEXTUAL_FOLLOWUP_RX.test(value)) return true;
  const words = value.split(/\s+/).filter(Boolean);
  // Fragments this short generally cannot establish a durable topic by
  // themselves. Full standalone questions continue through semantic matching.
  return words.length <= 5 && /\?\s*$/.test(String(text ?? "").trim());
}

export function resolveConversation(input: ResolverInput): ResolverOutput {
  const now = input.now ?? new Date();
  const text = String(input.text ?? "");
  const topics = (input.topics ?? []).filter(Boolean);

  const empty = (source: TopicResolutionSource, extra?: Partial<ResolverOutput>): ResolverOutput => ({
    source, topic: null, topic_id: null, score: null, candidates: [],
    clarification_required: false, clarification_options: [], is_new_topic: false,
    ...extra,
  });

  if (input.quoted_message_id && input.quoted_topic) {
    return {
      source: "quoted_message", topic: input.quoted_topic, topic_id: input.quoted_topic.id,
      score: 1, candidates: [{ topic_id: input.quoted_topic.id, score: 1 }],
      clarification_required: false, clarification_options: [], is_new_topic: false,
    };
  }

  if (input.has_pending_confirmation || input.awaiting_answer) {
    const active = topics.find((t) => t.id === input.active_topic_id) ?? null;
    return {
      source: "pending_expectation", topic: active, topic_id: active?.id ?? null,
      score: active ? 1 : null, candidates: [],
      clarification_required: false, clarification_options: [], is_new_topic: false,
    };
  }

  if (NEW_TOPIC_RX.test(text)) return empty("new_topic", { is_new_topic: true });

  const scored = topics
    .map((t) => ({ topic: t, score: topicScore(text, t, now) }))
    .sort((a, b) => b.score - a.score);
  const candidates = scored.map((s) => ({ topic_id: s.topic.id, score: s.score }));
  const best = scored[0] ?? null;
  const second = scored[1] ?? null;
  const active = topics.find((t) => t.id === input.active_topic_id) ?? null;

  // Explicit resume is intentionally allowed to leave the active topic.
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

  // Anaphora/meta-questions belong to the active topic before we search old
  // threads for lexical similarity. This closes the production jump from the
  // current rolling comparison to an older "...em agosto?" thread.
  if (active && looksContextDependentFollowup(text)) {
    const activeScore = scored.find((row) => row.topic.id === active.id)?.score ?? 1;
    return {
      source: "active_topic", topic: active, topic_id: active.id,
      score: activeScore, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

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

  if (active && (best?.score ?? 0) > 0) {
    return {
      source: "active_topic", topic: active, topic_id: active.id,
      score: best?.score ?? 0, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  if (best && best.score > 0.2) {
    return {
      source: "recent_history", topic: best.topic, topic_id: best.topic.id,
      score: best.score, candidates, clarification_required: false,
      clarification_options: [], is_new_topic: false,
    };
  }

  return empty("new_topic", { candidates, is_new_topic: true });
}
