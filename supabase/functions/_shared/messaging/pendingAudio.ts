// pending_audio.v1 — áudio recebido durante bloqueio de IA não é descartado.
//
// Regras:
// - Guardamos apenas o áudio já baixado e validado (formato aceito, tamanho ok).
// - Nada é registrado no financeiro aqui: o texto transcrito depois entra no
//   pipeline textual normal, exatamente como se a pessoa tivesse digitado.
// - Sem varredura periódica: a drenagem acontece quando chega a próxima
//   mensagem no WhatsApp (wake-on-message), com trava por linha.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { audioFailureReply, transcribeAudioBytes } from "./wahaMedia.ts";


export type PendingAudioRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  inbound_message_id: string | null;
  to_phone: string;
  provider_message_id: string | null;
  mime_type: string;
  audio_base64: string;
  attempts: number;
  expires_at: string;
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Guarda o áudio para reprocessar. Idempotente por mensagem do provedor. */
export async function persistPendingAudio(sb: SupabaseClient, args: {
  user_id: string;
  conversation_id?: string | null;
  inbound_message_id?: string | null;
  to_phone: string;
  provider_message_id?: string | null;
  bytes: Uint8Array;
  mime_type: string;
  reason: string;
}): Promise<{ stored: boolean; duplicate: boolean }> {
  const { error } = await sb.from("pending_audio_transcriptions").insert({
    user_id: args.user_id,
    conversation_id: args.conversation_id ?? null,
    inbound_message_id: args.inbound_message_id ?? null,
    to_phone: args.to_phone,
    provider_message_id: args.provider_message_id ?? null,
    mime_type: args.mime_type,
    audio_base64: bytesToBase64(args.bytes),
    bytes: args.bytes.length,
    reason: args.reason.slice(0, 60),
    status: "pending",
  });
  if (!error) return { stored: true, duplicate: false };
  const duplicate = String((error as { code?: string }).code ?? "") === "23505";
  if (!duplicate) {
    console.error("[pending_audio] store_failed", String(error.message ?? "").slice(0, 160));
  }
  return { stored: duplicate, duplicate };
}

/**
 * Processa áudios pendentes. Nunca lança e nunca faz mais que `limit` itens.
 * Se a IA continuar bloqueada, a linha volta para `pending` sem custo.
 */
export async function drainPendingAudio(sb: SupabaseClient, args: {
  limit?: number;
  /** Executa o turno do agente com o texto transcrito (pipeline textual). */
  deliver: (row: PendingAudioRow, text: string) => Promise<void>;
  /** Enfileira mensagem ao usuário (falha definitiva/expiração). */
  notify: (row: PendingAudioRow, body: string, idempotency_key: string) => Promise<void>;
}): Promise<{ processed: number; delivered: number; blocked: boolean; expired: number }> {
  const limit = Math.max(1, Math.min(args.limit ?? 3, 10));
  const { data } = await sb.from("pending_audio_transcriptions")
    .select("id,user_id,conversation_id,inbound_message_id,to_phone,provider_message_id,mime_type,audio_base64,attempts,expires_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as PendingAudioRow[];
  if (!rows.length) return { processed: 0, delivered: 0, blocked: false, expired: 0 };

  let delivered = 0;
  let processed = 0;
  let expired = 0;
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    // Trava por linha: só um processo assume cada áudio.
    const { data: locked } = await sb.from("pending_audio_transcriptions")
      .update({ status: "processing", locked_at: nowIso, attempts: row.attempts + 1, updated_at: nowIso })
      .eq("id", row.id).eq("status", "pending")
      .select("id").maybeSingle();
    if (!locked) continue;
    processed += 1;

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await sb.from("pending_audio_transcriptions")
        .update({ status: "expired", audio_base64: "", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      expired += 1;
      await args.notify(
        row,
        "Não consegui ouvir aquele áudio dentro do tempo que guardo ele 🙏 Se ainda fizer sentido, grava de novo ou me conta em texto.",
        `audio-expired:${row.id}`,
      ).catch(() => {});
      continue;
    }

    // Se o bloqueio já foi renovado por outro caminho, devolve sem custo.
    if (row.attempts >= 6) {
      await sb.from("pending_audio_transcriptions")
        .update({ status: "failed", last_error: "max_attempts", audio_base64: "", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      await args.notify(row, audioFailureReply("transcription_failed"), `audio-failed:${row.id}`).catch(() => {});
      continue;
    }

    const result = await transcribeAudioBytes({
      sb, user_id: row.user_id, bytes: base64ToBytes(row.audio_base64), mime: row.mime_type,
    });

    if (result.ok === true) {
      await sb.from("pending_audio_transcriptions")
        .update({ status: "done", audio_base64: "", last_error: null, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      delivered += 1;
      await args.deliver(row, result.text).catch((e) => {
        console.error("[pending_audio] deliver_failed", String((e as Error).message ?? "").slice(0, 160));
      });
      continue;
    }

    const failure = result as Extract<Awaited<ReturnType<typeof transcribeAudioBytes>>, { ok: false }>;
    if (failure.code === "ai_blocked") {
      // Continua indisponível: volta para a fila e para a rodada aqui.
      await sb.from("pending_audio_transcriptions")
        .update({ status: "pending", last_error: "ai_blocked", locked_at: null, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return { processed, delivered, blocked: true, expired };
    }

    await sb.from("pending_audio_transcriptions")
      .update({
        status: "failed", last_error: String(failure.code).slice(0, 60),
        audio_base64: "", updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await args.notify(row, audioFailureReply(failure.code), `audio-failed:${row.id}`).catch(() => {});
  }

  return { processed, delivered, blocked: false, expired };
}

/** True quando existe áudio pendente — evita trabalho inútil no caminho quente. */
export async function shouldDrainPendingAudio(sb: SupabaseClient): Promise<boolean> {
  const { count } = await sb.from("pending_audio_transcriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return Boolean(count && count > 0);
}
