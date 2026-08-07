// Telemetria sanitizada do data plane WhatsApp.
// Nunca persiste corpo, telefone, URL ou segredo. Falha de telemetria jamais
// bloqueia mensagem, mas ausência dela impede declarar o canal "verificado".
// deno-lint-ignore-file no-explicit-any

type Client = { from: (table: string) => any };

export type WhatsappPipelineStage =
  | "webhook_received"
  | "webhook_dropped"
  | "provider_session"
  | "inbound_persisted"
  | "agent_started"
  | "agent_completed"
  | "outbound_queued"
  | "provider_sent"
  | "ack_received"
  | "failed";

async function hashShort(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordWhatsappPipelineEvent(
  sb: Client,
  event: {
    stage: WhatsappPipelineStage;
    ok?: boolean;
    user_id?: string | null;
    inbound_message_id?: string | null;
    outbound_message_id?: string | null;
    agent_run_id?: string | null;
    provider_message_id?: string | null;
    session?: string | null;
    error_code?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  try {
    await sb.from("whatsapp_pipeline_events").insert({
      stage: event.stage,
      ok: event.ok ?? true,
      user_id: event.user_id ?? null,
      inbound_message_id: event.inbound_message_id ?? null,
      outbound_message_id: event.outbound_message_id ?? null,
      agent_run_id: event.agent_run_id ?? null,
      provider_message_hash: await hashShort(event.provider_message_id),
      session: event.session ? String(event.session).slice(0, 80) : null,
      error_code: event.error_code ? String(event.error_code).slice(0, 120) : null,
      metadata: event.metadata ?? {},
    });
  } catch {
    // observabilidade é best-effort; o fluxo de negócio continua.
  }
}
