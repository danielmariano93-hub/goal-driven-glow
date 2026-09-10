// MessageTopicLinker (`nino_threads.v1`)
//
// Costura mensagens (entrada, resposta e proativas) ao assunto durável. Sem isso
// a citação do WhatsApp não tem como voltar ao tópico e uma mensagem proativa
// nasce órfã: o usuário responde "isso mesmo" e o Nino não sabe do que se trata.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { TopicRepository, TopicThread } from "./TopicRepository.ts";

export async function linkTurnMessages(args: {
  repo: TopicRepository;
  topic_id: string | null;
  inbound_message_id?: string | null;
  outbound_message_id?: string | null;
  provider_message_id?: string | null;
  surface?: string | null;
}): Promise<void> {
  if (!args.topic_id) return;
  if (args.inbound_message_id) {
    await args.repo.linkMessage({
      topic_id: args.topic_id, message_id: args.inbound_message_id,
      direction: "inbound", surface: args.surface ?? null,
    });
  }
  if (args.outbound_message_id) {
    await args.repo.linkMessage({
      topic_id: args.topic_id, message_id: args.outbound_message_id,
      direction: "outbound", provider_message_id: args.provider_message_id ?? null,
      surface: args.surface ?? null,
    });
  }
}

/**
 * Âncora de tópico para mensagem PROATIVA. A mensagem proativa continua nascendo
 * do motor canônico; aqui só garantimos que ela pertence a um assunto, para que
 * a resposta do usuário seja entendida como continuação.
 */
export async function anchorProactiveMessage(args: {
  repo: TopicRepository;
  subject: string;
  title: string;
  body: string;
  outbound_message_id?: string | null;
  provider_message_id?: string | null;
  evidence_reference?: Record<string, unknown> | null;
}): Promise<TopicThread | null> {
  const topic = await args.repo.open({
    subject: args.subject,
    title: args.title,
    last_query: `${args.title} ${args.body}`.slice(0, 400),
  });
  if (!topic) return null;
  if (args.evidence_reference) {
    await args.repo.touch(topic.id, {
      status: "answered",
      evidence_reference: args.evidence_reference,
    } as Partial<TopicThread>);
  }
  if (args.outbound_message_id) {
    await args.repo.linkMessage({
      topic_id: topic.id, message_id: args.outbound_message_id,
      direction: "outbound", provider_message_id: args.provider_message_id ?? null,
      surface: "proactive",
    });
  }
  return topic;
}

/** Resolve o tópico de uma mensagem citada, aceitando id interno ou do provedor. */
export async function topicForQuotedMessage(
  repo: TopicRepository,
  quoted_message_id: string | null | undefined,
): Promise<TopicThread | null> {
  if (!quoted_message_id) return null;
  return await repo.findByMessageId(quoted_message_id);
}

/** Marca o outbound com o tópico, reaproveitando as colunas de contexto já existentes. */
export async function stampOutboundTopic(
  sb: SupabaseClient,
  outbound_message_id: string,
  topic_id: string,
): Promise<void> {
  try {
    const { data } = await sb.from("outbound_messages")
      .select("metadata").eq("id", outbound_message_id).maybeSingle();
    const metadata = { ...((data as any)?.metadata ?? {}), topic_id };
    await sb.from("outbound_messages").update({ metadata }).eq("id", outbound_message_id);
  } catch { /* telemetria best-effort, nunca bloqueia entrega */ }
}
