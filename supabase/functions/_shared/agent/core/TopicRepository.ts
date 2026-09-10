// TopicRepository (`nino_threads.v1`)
//
// Persistência DURÁVEL de assuntos. O estado de sessão (`ConversationTopicState`,
// teto de 5 tópicos, TTL de horas) continua sendo cache rápido do turno; a
// autoridade de continuidade de longo alcance passa a ser esta tabela.
//
// Regra dura: um tópico guarda SEMÂNTICA e REFERÊNCIAS (assunto, período,
// entidades, run/tool ids). Nunca guarda valor financeiro como verdade — todo
// número é recalculado no motor canônico quando o assunto é retomado.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type TopicStatus = "open" | "answered" | "clarifying" | "dormant" | "closed";

export type TopicThread = {
  id: string;
  user_id: string;
  conversation_id: string;
  subject: string;
  title: string | null;
  summary: string | null;
  status: TopicStatus;
  keywords: string[];
  entities: string[];
  acts: string[];
  period_from: string | null;
  period_to: string | null;
  original_query: string | null;
  last_query: string | null;
  evidence_reference: Record<string, unknown> | null;
  execution_summary: Record<string, unknown> | null;
  turn_count: number;
  opened_at: string;
  last_activity_at: string;
};

export type TopicRepository = {
  listRecent(limit?: number): Promise<TopicThread[]>;
  findById(topic_id: string): Promise<TopicThread | null>;
  findByMessageId(message_id: string): Promise<TopicThread | null>;
  search(terms: string[], limit?: number): Promise<TopicThread[]>;
  open(args: {
    subject: string; title?: string | null; last_query: string;
    keywords?: string[]; entities?: string[]; acts?: string[];
    period?: { from: string; to: string } | null;
  }): Promise<TopicThread | null>;
  touch(topic_id: string, patch: Partial<TopicThread>): Promise<void>;
  linkMessage(args: {
    topic_id: string; message_id: string; direction: "inbound" | "outbound";
    provider_message_id?: string | null; surface?: string | null;
  }): Promise<void>;
  applyLifecycle(): Promise<{ dormant: number; closed: number }>;
};

const TABLE = "nino_topic_threads";
const LINKS = "nino_topic_messages";

/**
 * Palavras genéricas de pergunta não identificam assunto. Sem esta lista,
 * "quanto gastei com mercado" casava com "quanto gastei em transporte" só
 * porque as duas frases compartilham o verbo.
 */
const STOPWORDS = new Set([
  "quanto", "quantos", "quais", "qual", "quando", "onde", "como", "porque",
  "gastei", "gasto", "gastos", "gastar", "tenho", "tinha", "minha", "minhas",
  "meus", "meu", "esse", "essa", "este", "esta", "aquele", "aquela", "isso",
  "para", "pela", "pelo", "muito", "mais", "menos", "ainda", "sobre", "estou",
  "esta", "fica", "ficou", "ficar", "voltando", "retomando", "pergunta",
  "falamos", "lembra", "outra", "coisa", "assunto", "agora", "hoje", "ontem",
]);

export function keywordsOf(text: string): string[] {
  return String(text ?? "")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 12);
}

export function createTopicRepository(args: {
  sb: SupabaseClient; user_id: string; conversation_id: string;
}): TopicRepository {
  const { sb, user_id, conversation_id } = args;
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  return {
    listRecent: (limit = 12) => safe(async () => {
      const { data, error } = await sb.from(TABLE)
        .select("*").eq("user_id", user_id)
        .in("status", ["open", "answered", "clarifying", "dormant"])
        .order("last_activity_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as TopicThread[];
    }, []),

    findById: (topic_id) => safe(async () => {
      const { data } = await sb.from(TABLE).select("*")
        .eq("id", topic_id).eq("user_id", user_id).maybeSingle();
      return (data ?? null) as TopicThread | null;
    }, null),

    findByMessageId: (message_id) => safe(async () => {
      const { data } = await sb.from(LINKS).select("topic_id")
        .eq("user_id", user_id)
        .or(`message_id.eq.${message_id},provider_message_id.eq.${message_id}`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const topic_id = (data as any)?.topic_id as string | undefined;
      if (!topic_id) return null;
      const { data: topic } = await sb.from(TABLE).select("*").eq("id", topic_id).maybeSingle();
      return (topic ?? null) as TopicThread | null;
    }, null),

    search: (terms, limit = 8) => safe(async () => {
      const clean = terms.filter((t) => t && t.length > 3).slice(0, 6);
      if (!clean.length) return [];
      const { data, error } = await sb.from(TABLE)
        .select("*").eq("user_id", user_id)
        .overlaps("keywords", clean)
        .order("last_activity_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as TopicThread[];
    }, []),

    open: (a) => safe(async () => {
      const now = new Date().toISOString();
      const { data, error } = await sb.from(TABLE).insert({
        user_id, conversation_id,
        subject: a.subject,
        title: a.title ?? null,
        status: "open",
        keywords: a.keywords ?? keywordsOf(a.last_query),
        entities: a.entities ?? [],
        acts: a.acts ?? [],
        period_from: a.period?.from ?? null,
        period_to: a.period?.to ?? null,
        original_query: a.last_query,
        last_query: a.last_query,
        turn_count: 1,
        opened_at: now,
        last_activity_at: now,
      }).select("*").maybeSingle();
      if (error) throw error;
      return (data ?? null) as TopicThread | null;
    }, null),

    touch: (topic_id, patch) => safe(async () => {
      const row: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
      for (const key of [
        "subject", "title", "summary", "status", "keywords", "entities", "acts",
        "period_from", "period_to", "last_query", "evidence_reference", "execution_summary",
      ] as const) {
        if (key in patch) row[key] = (patch as any)[key];
      }
      await sb.rpc("nino_topic_thread_touch", { p_topic_id: topic_id, p_patch: row });
    }, undefined),

    linkMessage: (a) => safe(async () => {
      await sb.from(LINKS).upsert({
        user_id, topic_id: a.topic_id, message_id: a.message_id,
        direction: a.direction,
        provider_message_id: a.provider_message_id ?? null,
        surface: a.surface ?? null,
      }, { onConflict: "topic_id,message_id" });
    }, undefined),

    applyLifecycle: () => safe(async () => {
      const { data } = await sb.rpc("nino_topic_threads_lifecycle", { p_user_id: user_id });
      const row = (Array.isArray(data) ? data[0] : data) as any;
      return { dormant: Number(row?.dormant ?? 0), closed: Number(row?.closed ?? 0) };
    }, { dormant: 0, closed: 0 }),
  };
}

/** Similaridade léxica simples entre a pergunta atual e um tópico durável. */
export function topicScore(text: string, topic: TopicThread, now: Date = new Date()): number {
  const terms = new Set(keywordsOf(text));
  const bag = new Set([
    ...(topic.keywords ?? []),
    ...keywordsOf(topic.last_query ?? ""),
    ...keywordsOf(topic.subject ?? ""),
  ]);
  if (!terms.size || !bag.size) return 0;
  let hits = 0;
  for (const t of terms) if (bag.has(t)) hits++;
  const lexical = hits / Math.max(terms.size, 1);
  const ageDays = Math.max(0, (now.getTime() - Date.parse(topic.last_activity_at)) / 86_400_000);
  const recency = ageDays <= 1 ? 0.2 : ageDays <= 7 ? 0.1 : ageDays <= 30 ? 0.05 : 0;
  const openBonus = topic.status === "open" || topic.status === "clarifying" ? 0.1 : 0;
  return Math.min(1, Math.round((lexical + recency + openBonus) * 100) / 100);
}
