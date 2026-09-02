// ConversationTopicState (`nino_semantic_ir.v3`)
//
// Pilha curta de tópicos sobre o estado JSON já existente da sessão (nenhuma
// tabela nova). Contratos de herança explícitos: repair mantém tópico e herda
// período/entidades; assunto novo cria tópico; small-talk não cria nem limpa;
// período NÃO vaza para tópico independente; entidade nunca é herdada em
// silêncio entre tópicos incompatíveis; empate plausível exige clarificação.
//
// `evidence_reference` guarda SÓ identificadores rastreáveis (run/tool call).
// Verdade financeira nunca é armazenada na memória conversacional.
import type { DialogueActLabel } from "./FinancialQueryIR.ts";

export const MAX_TOPIC_STATE = 5;

export type PendingClarification = {
  topic_id: string;
  slot: string;
  options: string[];
  period: { from: string; to: string } | null;
  query_id: string | null;
  ir: unknown;
};

export type ConversationTopic = {
  topic_id: string;
  subject: string;
  original_query: string;
  last_query: string;
  acts: DialogueActLabel[];
  period: { from: string; to: string } | null;
  entities: string[];
  ir: unknown;
  execution_summary: { engines: string[]; complete: boolean } | null;
  evidence_reference: { run_id: string | null; tool_call_ids: string[] } | null;
  pending_clarification: PendingClarification | null;
  status: "open" | "answered" | "clarifying" | "abandoned";
  updated_at: string;
};

export type ConversationTopicState = {
  version: "nino_topic_state.v1";
  active_topic_id: string | null;
  topics: ConversationTopic[];
};

export type TopicResolution = {
  state: ConversationTopicState;
  topic: ConversationTopic;
  resumed_topic_id: string | null;
  created: boolean;
  ambiguous_topic_ids: string[];
  clarification_required: boolean;
};

export function emptyTopicState(): ConversationTopicState {
  return { version: "nino_topic_state.v1", active_topic_id: null, topics: [] };
}

export function normalizeTopicState(value: unknown): ConversationTopicState {
  const raw = (value ?? {}) as Partial<ConversationTopicState>;
  const topics = Array.isArray(raw.topics) ? raw.topics.filter(Boolean).slice(0, MAX_TOPIC_STATE) : [];
  return {
    version: "nino_topic_state.v1",
    active_topic_id: raw.active_topic_id ?? null,
    topics: topics as ConversationTopic[],
  };
}

function subjectOf(text: string): string {
  const t = String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const anchors: Array<[RegExp, string]> = [
    [/\bmeta|objetivo\b/, "metas"],
    [/\bdivid|d[ií]vida\b/, "dividas"],
    [/\bcart[aã]o|fatura|credito\b/, "cartao"],
    [/\bpatrim[oô]ni|investiment\b/, "patrimonio"],
    [/\bsaldo|dispon[ií]vel\b/, "saldo"],
    [/\breceita|renda|entrou|recebi\b/, "receita"],
    [/\bgast|despesa|categor|estabelec\b/, "gastos"],
  ];
  for (const [rx, subject] of anchors) if (rx.test(t)) return subject;
  return "geral";
}

const RESUME_RX = /\b(voltando|retomando|sobre aquilo|aquela pergunta|como eu disse antes|volta (?:pra|para) )\b/i;

function similarity(a: string, b: string): number {
  const setA = new Set(String(a).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const setB = new Set(String(b).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!setA.size || !setB.size) return 0;
  let hits = 0;
  for (const w of setA) if (setB.has(w)) hits++;
  return hits / Math.max(setA.size, setB.size);
}

let topicSeq = 0;
function newTopicId(): string {
  topicSeq = (topicSeq + 1) % 100000;
  return `t${Date.now().toString(36)}${topicSeq.toString(36)}`;
}

/**
 * Aplica as regras de herança e devolve o tópico do turno.
 * `acts` é multi-label: `repair + constraint_update` mantém o tópico E aplica a
 * nova restrição (o override explícito vence a herança).
 */
export function resolveTopicForTurn(args: {
  state: ConversationTopicState;
  text: string;
  acts: DialogueActLabel[];
  period?: { from: string; to: string } | null;
  entities?: string[];
  explicit_period_override?: boolean;
  explicit_entity_override?: boolean;
}): TopicResolution {
  const state = normalizeTopicState(args.state);
  const acts = args.acts ?? ["new_query"];
  const now = new Date().toISOString();
  const active = state.topics.find((t) => t.topic_id === state.active_topic_id) ?? null;

  // Small-talk não cria nem limpa tópico.
  if (acts.includes("conversational") && !acts.includes("repair") && !acts.includes("followup")) {
    const topic = active ?? {
      topic_id: newTopicId(), subject: "geral", original_query: args.text, last_query: args.text,
      acts, period: null, entities: [], ir: null, execution_summary: null,
      evidence_reference: null, pending_clarification: null, status: "open" as const, updated_at: now,
    };
    return {
      state, topic, resumed_topic_id: null, created: false,
      ambiguous_topic_ids: [], clarification_required: false,
    };
  }

  // Retomada explícita: recupera tópico anterior por similaridade.
  if (RESUME_RX.test(args.text) && state.topics.length > 0) {
    const scored = state.topics
      .map((t) => ({ t, score: similarity(args.text, `${t.original_query} ${t.subject}`) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const tie = scored.filter((s) => Math.abs(s.score - top.score) < 0.05 && s.score > 0);
    if (tie.length > 1) {
      return {
        state, topic: top.t, resumed_topic_id: null, created: false,
        ambiguous_topic_ids: tie.map((s) => s.t.topic_id), clarification_required: true,
      };
    }
    const resumed = { ...top.t, last_query: args.text, acts, status: "open" as const, updated_at: now };
    return {
      state: upsertTopic(state, resumed, true), topic: resumed,
      resumed_topic_id: resumed.topic_id, created: false,
      ambiguous_topic_ids: [], clarification_required: false,
    };
  }

  const subject = subjectOf(args.text);
  const isRepair = acts.includes("repair") || acts.includes("clarification");
  const isFollowup = acts.includes("followup");
  // `constraint_update` é, por definição, a MESMA pergunta com nova restrição
  // ("e por cartão?"). A dimensão nova muda o assunto aparente do texto, mas
  // não abre tópico novo — o período segue herdado, salvo override explícito.
  const isConstraintUpdate = acts.includes("constraint_update");

  if (active && (isRepair || isConstraintUpdate || (isFollowup && active.subject === subject))) {
    // Repair mantém topic_id e herda período/entidades, salvo override explícito.
    const topic: ConversationTopic = {
      ...active,
      last_query: args.text,
      acts,
      period: args.explicit_period_override ? (args.period ?? null) : (active.period ?? args.period ?? null),
      entities: args.explicit_entity_override
        ? (args.entities ?? [])
        : (active.entities.length ? active.entities : (args.entities ?? [])),
      status: "open",
      updated_at: now,
    };
    return {
      state: upsertTopic(state, topic, true), topic, resumed_topic_id: null, created: false,
      ambiguous_topic_ids: [], clarification_required: false,
    };
  }

  // Assunto novo => tópico novo. Período NÃO vaza; entidade não é herdada de
  // tópico incompatível.
  const compatible = active?.subject === subject;
  const topic: ConversationTopic = {
    topic_id: newTopicId(),
    subject,
    original_query: args.text,
    last_query: args.text,
    acts,
    period: args.period ?? null,
    entities: args.entities ?? (compatible ? (active?.entities ?? []) : []),
    ir: null,
    execution_summary: null,
    evidence_reference: null,
    pending_clarification: null,
    status: "open",
    updated_at: now,
  };
  return {
    state: upsertTopic(state, topic, true), topic, resumed_topic_id: null, created: true,
    ambiguous_topic_ids: [], clarification_required: false,
  };
}

export function upsertTopic(
  state: ConversationTopicState,
  topic: ConversationTopic,
  makeActive = false,
): ConversationTopicState {
  const rest = normalizeTopicState(state).topics.filter((t) => t.topic_id !== topic.topic_id);
  const topics = [topic, ...rest].slice(0, MAX_TOPIC_STATE);
  return {
    version: "nino_topic_state.v1",
    active_topic_id: makeActive ? topic.topic_id : state.active_topic_id,
    topics,
  };
}

export function setPendingClarification(
  state: ConversationTopicState,
  pending: PendingClarification,
): ConversationTopicState {
  const current = normalizeTopicState(state);
  const topic = current.topics.find((t) => t.topic_id === pending.topic_id);
  if (!topic) return current;
  return upsertTopic(current, {
    ...topic, pending_clarification: pending, status: "clarifying", updated_at: new Date().toISOString(),
  }, true);
}

export function pendingClarificationOf(state: ConversationTopicState): PendingClarification | null {
  const current = normalizeTopicState(state);
  const topic = current.topics.find((t) => t.topic_id === current.active_topic_id);
  return topic?.pending_clarification ?? null;
}

/**
 * Resolve APENAS o slot pendente. Responder "Nubank" não recompila uma pergunta
 * nova: escolhe a opção canônica, e se a resposta continuar ambígua devolve
 * `resolved: false` para perguntar de novo.
 */
export function resolvePendingSlot(
  pending: PendingClarification,
  answer: string,
): { resolved: boolean; value: string | null; candidates: string[] } {
  const raw = String(answer ?? "").trim().toLowerCase();
  if (!raw) return { resolved: false, value: null, candidates: pending.options };
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const exact = pending.options.filter((o) => norm(o) === norm(raw));
  if (exact.length === 1) return { resolved: true, value: exact[0], candidates: [] };
  const partial = pending.options.filter((o) => norm(o).includes(norm(raw)) || norm(raw).includes(norm(o)));
  if (partial.length === 1) return { resolved: true, value: partial[0], candidates: [] };
  return { resolved: false, value: null, candidates: partial.length ? partial : pending.options };
}

export function clearPendingClarification(
  state: ConversationTopicState,
  topicId: string,
): ConversationTopicState {
  const current = normalizeTopicState(state);
  const topic = current.topics.find((t) => t.topic_id === topicId);
  if (!topic) return current;
  return upsertTopic(current, {
    ...topic, pending_clarification: null, status: "open", updated_at: new Date().toISOString(),
  }, true);
}
