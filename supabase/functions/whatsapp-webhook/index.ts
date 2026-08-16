// Inbound WhatsApp webhook.
// Security hardening:
//  - Body size cap (128 KB): reject anything larger.
//  - Provider secret verification: accepts either the `X-Webhook-Secret`
//    header OR an opaque token in the query string (`?t=<secret>`). Both are
//    compared to the same secret; WAHA versions differ on whether
//    customHeaders are propagated to the receiver.
//  - Dedupe by (provider_message_id) unique constraint on inbound_messages,
//    plus a full-payload sha256 raw_hash.
//  - VINCULAR + friendly phrasing use phone_link_codes.lookup_key (sha256 of
//    code alone) for O(1) lookup without scanning; the definitive check still
//    verifies code_hash = sha256(code || user_id), keeping the code irreversible.
//  - Ownership: after linking success, only phone_e164 matched to the active
//    whatsapp_links row is allowed to orchestrate.
//  - After enqueueing outbound_messages, the whatsapp-send function is invoked
//    inline (fire-and-forget) so replies leave promptly without depending on
//    a cron worker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail, respondPartial } from "../_shared/http.ts";

const FN = "whatsapp-webhook";
import { getProvider, getSessionName, loadWahaConfig } from "../_shared/messaging/waha.ts";
import { classifyInbound } from "../_shared/messaging/wahaInbound.ts";
import { maskLid, resolveLidToPhone } from "../_shared/messaging/lidResolver.ts";
import { buildAssessorLink } from "../_shared/messaging/appUrl.ts";
import { shouldFallbackForMedia, isUniqueViolation } from "../_shared/messaging/mediaFallback.ts";
import { runOrchestrator, FRIENDLY_ORCHESTRATOR_ERROR } from "../_shared/agent/orchestrator.ts";
import { participantSplitReply } from "../_shared/messaging/splitParticipantSupport.ts";
import { handleParticipantInbound } from "../_shared/split/participantPipeline.ts";
import { getWahaAccess, sendEphemeralText, sendTypingPresence } from "../_shared/messaging/waha.ts";
import { planAcknowledgement } from "../_shared/agent/core/Acknowledgement.ts";
import { shouldAcknowledge } from "../_shared/agent/core/Conversational.ts";
import { audioFailureReply, isAudioMedia, transcribeInboundAudio, type AudioHint } from "../_shared/messaging/wahaMedia.ts";

import { recordWhatsappPipelineEvent } from "../_shared/messaging/pipelineTelemetry.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

type DropCtx = {
  reason: string;
  event: string | null;
  session: string | null;
  jid_domains: string[];
  has_alt: boolean;
  has_key: boolean;
  lid_masked?: string | null;
};

async function logDrop(
  sb: ReturnType<typeof createClient>,
  ctx: DropCtx,
) {
  try {
    await sb.from("provider_inbound_drops").insert({
      provider: "waha",
      reason: ctx.reason,
      event: ctx.event,
      session: ctx.session,
      jid_domains: ctx.jid_domains,
      has_alt: ctx.has_alt,
      has_key: ctx.has_key,
      lid_masked: ctx.lid_masked ?? null,
    });
  } catch (_) { /* diagnostic — never blocks the response */ }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY_BYTES = 128 * 1024;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readAckEvent(payload: unknown): { providerMessageId: string; status: "sent" | "delivered" | "read" } | null {
  const root = (payload ?? {}) as Record<string, any>;
  const event = String(root.event ?? root.type ?? "").toLowerCase();
  if (event !== "message.ack") return null;
  const p = (root.payload ?? root.data ?? {}) as Record<string, any>;
  const key = (p.key ?? p._data?.key ?? {}) as Record<string, any>;
  const providerMessageId = String(
    p.id ?? p.messageId ?? p.message_id ?? key.id ?? p._data?.id ?? "",
  ).trim();
  if (!providerMessageId) return null;
  const rawAck = p.ack ?? p.status ?? p.ackName ?? p._data?.ack ?? root.ack;
  const numeric = Number(rawAck);
  const normalized = String(rawAck ?? "").toLowerCase();
  const status = numeric >= 3 || normalized.includes("read") || normalized.includes("played")
    ? "read" as const
    : numeric >= 2 || normalized.includes("deliver")
    ? "delivered" as const
    : "sent" as const;
  return { providerMessageId, status };
}

/** Lê eventos `session.status` do WAHA e normaliza para saúde do canal. */
export function readSessionStatus(payload: unknown): { status: string; ok: boolean } | null {
  const root = (payload ?? {}) as Record<string, any>;
  const event = String(root.event ?? root.type ?? "").toLowerCase();
  if (event !== "session.status") return null;
  const p = (root.payload ?? root.data ?? {}) as Record<string, any>;
  const status = String(p.status ?? p.state ?? root.status ?? "unknown").toUpperCase();
  return { status, ok: status === "WORKING" };
}


/** Extract a 6-digit verification code from either the legacy `VINCULAR NNNN`
 *  format or a friendlier phrasing that anchors on "código de verificação".
 *  Never matches loose numbers in ordinary conversation. */
function extractLinkCode(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  // Legacy explicit command
  const legacy = t.match(/^\s*VINCULAR\s+(\d{4,8})\s*$/i);
  if (legacy) return legacy[1];
  // Friendly format: must contain the verification anchor phrase
  const anchored = /c[óo]digo\s+de\s+verifica[cç][ãa]o[^0-9]{0,15}(\d{6})\b/i.exec(t);
  if (anchored) return anchored[1];
  // Alternate: "meu código é 123456" together with the brand name (MeuNino
  // ou o antigo NoControle) para evitar capturar números arbitrários.
  if (/MeuNino|NoControle/i.test(t)) {
    const alt = /c[óo]digo[^0-9]{0,15}(\d{6})\b/i.exec(t);
    if (alt) return alt[1];
  }
  return null;
}

/** Trigger the outbound dispatcher without blocking the webhook response. */
function triggerDispatcher(): void {
  try {
    // Fire-and-forget. Even if this fetch is aborted when the isolate suspends,
    // the whatsapp-ack-watchdog cron will still pick up leftover rows.
    fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: "{}",
    }).catch(() => { /* dispatcher will retry via cron */ });
  } catch { /* ignore */ }
}

async function firstNameFor(sb: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  try {
    const { data } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const dn = ((data as { display_name?: string } | null)?.display_name ?? "").trim();
    if (!dn) return null;
    const first = dn.split(/\s+/)[0];
    return first || null;
  } catch { return null; }
}

async function ensureConversation(
  sb: ReturnType<typeof createClient>,
  args: { user_id: string; phone_e164: string },
): Promise<string | null> {
  const now = new Date().toISOString();
  const { data: existing, error: selectErr } = await sb.from("conversations")
    .select("id")
    .eq("user_id", args.user_id)
    .eq("phone_e164", args.phone_e164)
    .maybeSingle();
  if (selectErr) console.error("[webhook] conversation select failed", String(selectErr.message).slice(0, 200));
  if (existing?.id) {
    await sb.from("conversations").update({ last_message_at: now }).eq("id", existing.id).then(() => {}, () => {});
    return existing.id as string;
  }

  const { data: created, error: insertErr } = await sb.from("conversations").insert({
    user_id: args.user_id,
    phone_e164: args.phone_e164,
    last_message_at: now,
    source: "whatsapp",
  }).select("id").maybeSingle();
  if (created?.id) return created.id as string;

  // Race-safe retry: another webhook may have created the conversation first.
  if (insertErr) console.error("[webhook] conversation insert failed", String(insertErr.message).slice(0, 200));
  const { data: retry } = await sb.from("conversations")
    .select("id")
    .eq("user_id", args.user_id)
    .eq("phone_e164", args.phone_e164)
    .maybeSingle();
  return (retry?.id as string | undefined) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  const sbBoot = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await loadWahaConfig(sbBoot);
  const provider = getProvider();
  if (!provider.configured) return json({ ok: true, ignored: "not_configured" }, 200);

  // Pull opaque token from the URL and forward it as a header so
  // provider.verifyWebhookSecret can compare in a single, unified path.
  const url = new URL(req.url);
  const qToken = url.searchParams.get("t") ?? "";
  const forwardedHeaders = new Headers(req.headers);
  if (qToken) forwardedHeaders.set("x-webhook-token", qToken);

  if (!provider.verifyWebhookSecret(forwardedHeaders)) {
    return fail("unauthorized", { status: 401, functionName: FN });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("payload_too_large", { status: 413, functionName: FN });

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return fail("invalid_json", { status: 400, functionName: FN }); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rootMeta = (payload ?? {}) as Record<string, any>;
  await recordWhatsappPipelineEvent(sb, {
    stage: "webhook_received",
    session: typeof rootMeta.session === "string" ? rootMeta.session : null,
    metadata: { event: String(rootMeta.event ?? rootMeta.type ?? "unknown").slice(0, 80) },
  });

  // ACKs are delivery telemetry, not inbound user messages. Process them
  // before the inbound classifier (which intentionally drops message.ack).
  const ack = readAckEvent(payload);
  if (ack) {
    // Transição monotônica + timestamps de accepted/delivered/read via função SECURITY DEFINER.
    const { data: applied, error: ackErr } = await sb.rpc("apply_outbound_ack", {
      p_provider_message_id: ack.providerMessageId,
      p_ack: ack.status,
    });
    if (ackErr) {
      console.warn("[webhook] apply_outbound_ack_failed", ackErr.message?.slice(0, 200));
    }
    const matched = Array.isArray(applied) && applied.length > 0;
    const { data: ackOutbound } = await sb.from("outbound_messages")
      .select("id,user_id,inbound_message_id")
      .eq("provider_message_id", ack.providerMessageId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    await recordWhatsappPipelineEvent(sb, {
      stage: "ack_received",
      user_id: (ackOutbound as any)?.user_id ?? null,
      inbound_message_id: (ackOutbound as any)?.inbound_message_id ?? null,
      outbound_message_id: (ackOutbound as any)?.id ?? null,
      provider_message_id: ack.providerMessageId,
      metadata: { ack: ack.status, matched },
    });
    return json({ ok: true, ack: ack.status, matched });
  }

  // Eventos de status da sessão não são mensagens, mas são o único sinal de
  // que o número parou de receber. Persistimos o estado para o painel admin
  // conseguir mostrar "sessão desconectada desde X" (antes eram descartados).
  const sessionStatus = readSessionStatus(payload);
  if (sessionStatus) {
    try {
      await sb.from("provider_health_events").insert({
        provider: "waha",
        ok: sessionStatus.ok,
        error_masked: sessionStatus.status.slice(0, 120),
      });
      await recordWhatsappPipelineEvent(sb, {
        stage: "provider_session", ok: sessionStatus.ok,
        session: getSessionName(), error_code: sessionStatus.ok ? null : sessionStatus.status,
      });
    } catch (_) { /* diagnóstico — nunca bloqueia */ }
  }

  const expected = getSessionName();
  let classified = classifyInbound(payload, expected);

  // WAHA 2026.x pode entregar apenas o identificador interno `@lid`.
  // Resolvemos o telefone real (cache + API do provedor) e reclassificamos.
  if (!classified.ok && classified.reason === "lid_pending" && classified.sender_lid) {
    const lid = classified.sender_lid;
    const resolvedPhone = await resolveLidToPhone(sb as unknown as Parameters<typeof resolveLidToPhone>[0], lid);
    classified = classifyInbound(payload, expected, { resolvedPhone: resolvedPhone ?? null });
    if (!classified.ok) {
      console.warn("[webhook] lid_unresolved", maskLid(lid));
    } else {
      console.info("[webhook] lid_resolved", maskLid(lid));
    }
  }

  if (!classified.ok) {
    await recordWhatsappPipelineEvent(sb, {
      stage: "webhook_dropped", ok: false, session: classified.session,
      error_code: classified.reason,
      metadata: { event: classified.event ?? "unknown" },
    });
    await logDrop(sb, {
      reason: classified.reason,
      event: classified.event,
      session: classified.session,
      jid_domains: classified.jid_domains,
      has_alt: classified.has_alt,
      has_key: classified.has_key,
      lid_masked: classified.sender_lid ? maskLid(classified.sender_lid) : null,
    });
    console.log(`[webhook] dropped reason=${classified.reason} event=${classified.event ?? ""} jids=${classified.jid_domains.join(",")}`);
    return json({ ok: true, ignored: classified.reason }, 200);
  }
  const evt = {
    provider: "waha" as const,
    provider_message_id: classified.provider_message_id,
    from_phone: classified.from_phone,
    to_phone: classified.to_phone,
    body: classified.body,
    received_at: classified.received_at,
    media: classified.media,
  };

  const raw_hash = await sha256Hex(raw);
  const mediaMime = String(
    (evt.media as any)?.mime_type ?? (evt.media as any)?.mimeType ?? (evt.media as any)?.mimetype ?? "",
  ).toLowerCase() || null;
  const mediaKind = mediaMime
    ? (mediaMime.startsWith("image/") ? "image" : mediaMime === "application/pdf" ? "pdf" : mediaMime.split("/")[0])
    : null;
  const { data: inb, error: insErr } = await sb.from("inbound_messages").insert({
    provider: evt.provider,
    provider_message_id: evt.provider_message_id,
    from_phone: evt.from_phone,
    to_phone: evt.to_phone ?? null,
    body: evt.body,
    raw_hash,
    received_at: evt.received_at,
    has_media: Boolean(evt.media),
    media_kind: mediaKind,
    media_mime: mediaMime,
    media_bytes: Number((evt.media as any)?.mediaSize ?? 0) || null,
    logical_dedup_key: `inbound:waha:${evt.provider_message_id}`,
  }).select("id").maybeSingle();
  if (insErr && !String(insErr.message).toLowerCase().includes("duplicate")) {
    console.error("[webhook] insert failed", insErr.message);
    return fail("internal", { status: 500, functionName: FN });
  }
  if (insErr) return json({ ok: true, dedup: true });
  const inbound_message_id = inb!.id as string;
  await recordWhatsappPipelineEvent(sb, {
    stage: "inbound_persisted", inbound_message_id,
    provider_message_id: evt.provider_message_id, session: getSessionName(),
  });

  const code = extractLinkCode(evt.body);
  if (code) {
    const lookup = await sha256Hex(code);
    const { data: candidates } = await sb.from("phone_link_codes")
      .select("id,user_id,code_hash,attempts")
      .eq("lookup_key", lookup)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(5);
    let matched: { id: string; user_id: string } | null = null;
    for (const row of candidates ?? []) {
      if ((row.attempts as number ?? 0) >= 5) continue;
      const h = await sha256Hex(code + row.user_id);
      if (h === row.code_hash) { matched = { id: row.id as string, user_id: row.user_id as string }; break; }
      await sb.from("phone_link_codes").update({ attempts: (row.attempts as number ?? 0) + 1 }).eq("id", row.id);
    }
    const replyBad =
      "Não consegui validar seu código. Ele pode ter expirado. É só gerar um novo dentro do app e me enviar de novo. 💛";
    if (!matched) {
      await sb.from("outbound_messages").insert({ to_phone: evt.from_phone, body: replyBad, kind: "system" });
      triggerDispatcher();
      return json({ ok: true, link: "invalid_code" });
    }
    // Revoke previous links for either the user or the phone.
    await sb.from("whatsapp_links").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("user_id", matched.user_id).eq("status", "active");
    await sb.from("whatsapp_links").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("phone_e164", evt.from_phone).eq("status", "active");
    const phone_hash = await sha256Hex(evt.from_phone);
    const masked = "+55 (**) *****-" + evt.from_phone.slice(-4);
    const { error: linkErr } = await sb.from("whatsapp_links").insert({
      user_id: matched.user_id, phone_e164: evt.from_phone, phone_hash, phone_masked: masked,
      status: "active", last_verified_at: new Date().toISOString(),
    });
    if (linkErr) {
      await sb.from("outbound_messages").insert({ to_phone: evt.from_phone, body: replyBad, kind: "system" });
      triggerDispatcher();
      return json({ ok: true, link: "error" });
    }
    await sb.from("phone_link_codes").update({ used_at: new Date().toISOString() }).eq("id", matched.id);

    const first = await firstNameFor(sb, matched.user_id);
    const salutation = first ? `Tudo certo, ${first}!` : "Tudo certo!";
    const replyOk =
      `${salutation} Seu WhatsApp foi conectado à sua conta. 🎉 A partir de agora, pode me mandar seus gastos, metas e dúvidas por aqui.`;
    await sb.from("outbound_messages").insert({
      user_id: matched.user_id, to_phone: evt.from_phone, body: replyOk, kind: "system",
    });
    triggerDispatcher();
    return json({ ok: true, link: "created" });
  }

  const phone_hash = await sha256Hex(evt.from_phone);
  const { data: link } = await sb.from("whatsapp_links")
    .select("user_id").eq("phone_hash", phone_hash).eq("status", "active").maybeSingle();
  if (!link) {
    const { data: participant } = await sb.from("shared_expense_participants")
      .select("id,name,amount_due,amount_paid,shared_expense_id")
      .eq("phone_e164", evt.from_phone)
      .in("status", ["pending", "partial", "notified", "payment_reported", "awaiting_owner_confirmation"])
      .is("opt_out_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (participant) {
      const { data: expense } = await sb.from("shared_expenses")
        .select("title,due_date,pix_key,status,owner_user_id")
        .eq("id", participant.shared_expense_id)
        .eq("status", "active")
        .maybeSingle();
      if (expense) {
        const { data: policy } = await sb.from("split_reminder_policy").select("pause_on_reply").eq("id", 1).maybeSingle();
        if (policy?.pause_on_reply) {
          await sb.from("reminder_jobs")
            .update({ status: "skipped", last_error: "participant_replied", updated_at: new Date().toISOString() })
            .eq("participant_id", participant.id)
            .eq("status", "queued")
            .in("kind", ["reminder", "due_soon", "due_today", "overdue"]);
        }
        // Participante externo COM anexo processável: o comprovante é baixado,
        // arquivado no storage do dono e o estado do participante avança para
        // "aguardando confirmação". Mídia NUNCA é descartada antes disso.
        const hasProcessableMedia = !!(evt.media && shouldFallbackForMedia(evt.media));
        let body: string;
        let pipelineResult: Awaited<ReturnType<typeof handleParticipantInbound>> | null = null;
        try {
          const access = getWahaAccess();
          pipelineResult = await handleParticipantInbound(sb, {
            participant: {
              id: String(participant.id),
              name: String(participant.name ?? ""),
              amount_due: Number(participant.amount_due ?? 0),
              amount_paid: Number(participant.amount_paid ?? 0),
              shared_expense_id: String(participant.shared_expense_id),
              phone_e164: evt.from_phone,
            },
            expense: {
              id: String(participant.shared_expense_id),
              title: String(expense.title ?? "rolê"),
              due_date: expense.due_date ?? null,
              pix_key: expense.pix_key ?? null,
              user_id: String((expense as any).owner_user_id),
            },
            text: evt.body,
            media: hasProcessableMedia ? (evt.media as any) : null,
            providerMessageId: evt.provider_message_id,
            inboundMessageId: inbound_message_id,
            waha: { apiUrl: access.api_url, apiKey: access.api_key, session: access.session },
          });
          body = pipelineResult.reply;
        } catch (e) {
          console.error("[webhook] participant_pipeline_failed", String((e as Error).message ?? "").slice(0, 200));
          body = participantSplitReply(evt.body, {
            participantName: participant.name,
            title: expense.title,
            amountDue: Number(participant.amount_due),
            amountPaid: Number(participant.amount_paid),
            dueDate: expense.due_date,
            pixKey: expense.pix_key,
            siteUrl: Deno.env.get("APP_PUBLIC_URL") || "https://meunino.com.br",
            hasAttachment: hasProcessableMedia,
          });
        }
        await sb.from("outbound_messages").insert({
          to_phone: evt.from_phone, body, kind: "split_support", channel: "whatsapp",
          inbound_message_id, idempotency_key: `split-support:${evt.provider_message_id}`, status: "queued",
        }).then(() => {}, () => {});
        await sb.from("inbound_messages").update({
          processed_at: new Date().toISOString(),
          participant_id: String(participant.id),
          detected_intent: pipelineResult?.intent ?? "participant_support",
          media_storage_path: pipelineResult?.storage_path ?? null,
          media_error: pipelineResult?.media_error ?? null,
        }).eq("id", inbound_message_id).then(() => {}, () => {});
        triggerDispatcher();
        return json({
          ok: true,
          participant_support: true,
          intent: pipelineResult?.intent ?? null,
          receipt_stored: pipelineResult?.receipt_stored ?? false,
        });
      }
    }
    await sb.from("outbound_messages").insert({
      to_phone: evt.from_phone,
      body: "Olá! Este número ainda não está vinculado a uma conta do MeuNino. Abra o app, gere um código de verificação e me envie por aqui — te espero. 💛",
      kind: "system",
    });
    triggerDispatcher();
    return json({ ok: true, unlinked: true });
  }

  const conversationId = await ensureConversation(sb, { user_id: link.user_id as string, phone_e164: evt.from_phone });
  if (!conversationId) {
    await sb.from("outbound_messages").insert({
      user_id: link.user_id, to_phone: evt.from_phone, kind: "agent",
      channel: "whatsapp", inbound_message_id,
      idempotency_key: `conv-err:${inbound_message_id}`,
      status: "queued", body: FRIENDLY_ORCHESTRATOR_ERROR,
    }).then(() => {}, () => {});
    await sb.from("inbound_messages")
      .update({ processed_at: new Date().toISOString(), ignored_reason: "conversation_error" })
      .eq("id", inbound_message_id).then(() => {}, () => {});
    triggerDispatcher();
    // Falha parcial NUNCA responde sucesso: 207 + envelope edge_error.v1 e
    // incidente registrado para rastreio operacional.
    return respondPartial(
      { queued_fallback: true, inbound_message_id },
      [{ stage: "ensure_conversation", inbound_message_id, error_code: "conversation_error" }],
      { status: 207, functionName: FN, userId: link.user_id as string, errorCode: "conversation_error" },
    );
  }

  // === ÁUDIO: nota de voz vira texto e segue o pipeline textual normal ======
  // Nada de inteligência paralela: o que a pessoa falou entra exatamente como
  // se tivesse sido digitado (registrar gasto, perguntar, corrigir).
  if (isAudioMedia(evt.media as AudioHint | null)) {
    const access = getWahaAccess();
    const t0 = Date.now();
    const transcription = await transcribeInboundAudio({
      media: evt.media as AudioHint,
      messageId: evt.provider_message_id,
      waha: { apiUrl: access.api_url, apiKey: access.api_key, session: access.session },
    });
    console.info("[webhook] audio_transcription", JSON.stringify({
      ok: transcription.ok,
      code: transcription.ok ? null : transcription.code,
      ms: Date.now() - t0,
      chars: transcription.ok ? transcription.text.length : 0,
    }));
    if (transcription.ok) {
      evt.body = transcription.text;
      await sb.from("inbound_messages")
        .update({ body: transcription.text.slice(0, 2000), detected_intent: "audio_transcribed" })
        .eq("id", inbound_message_id).then(() => {}, () => {});
    } else {
      const first = await firstNameFor(sb, link.user_id as string);
      await sb.from("outbound_messages").insert({
        user_id: link.user_id, to_phone: evt.from_phone, kind: "agent", channel: "whatsapp",
        inbound_message_id, idempotency_key: `audio-fail:${evt.provider_message_id}`,
        status: "queued", body: audioFailureReply(transcription.code, first),
      }).then(() => {}, () => {});
      await sb.from("inbound_messages").update({
        processed_at: new Date().toISOString(),
        ignored_reason: `audio_${transcription.code}`,
        media_error: transcription.code,
      }).eq("id", inbound_message_id).then(() => {}, () => {});
      await sb.from("conversation_messages").insert({
        conversation_id: conversationId, user_id: link.user_id, direction: "inbound",
        body_masked: "[áudio não compreendido]",
      }).then(() => {}, () => {});
      triggerDispatcher();
      return json({ ok: true, audio: "failed", code: transcription.code });
    }
  }

  await sb.from("conversation_messages").insert({
    conversation_id: conversationId, user_id: link.user_id, direction: "inbound",
    body_masked: evt.body.slice(0, 500),
  });


  // === MEDIA PATH: fallback com link direto para o Assessor ===
  // Decisão de produto: a leitura de mídias processáveis (imagem, PDF,
  // planilha) acontece exclusivamente no Assessor dentro do app, onde o
  // usuário revisa e confirma antes de gravar. Áudio, vídeo e stickers
  // NÃO caem aqui — seguem para o orquestrador textual normal.
  if (evt.media && shouldFallbackForMedia(evt.media)) {
    const mime = String(evt.media.mime_type ?? evt.media.mimeType ?? "").toLowerCase();
    console.info("[webhook] media_fallback", JSON.stringify({
      via: evt.media.via,
      mime: mime || null,
      filename_ext: evt.media.filename?.split(".").pop()?.toLowerCase().slice(0, 8) ?? null,
    }));
    const assessorLink = buildAssessorLink(
      { APP_PUBLIC_URL: Deno.env.get("APP_PUBLIC_URL") },
      "whatsapp_media",
    );
    if (!assessorLink) {
      // Sem URL válida configurada: não enviar link quebrado. Registramos
      // o descarte de forma sanitizada e orientamos o usuário em texto.
      console.warn("[webhook] media_fallback_no_link", JSON.stringify({ mime: mime || null }));
    }
    const idem = `media-fallback:${evt.provider_message_id}`;
    const first = await firstNameFor(sb, link.user_id as string);
    const salutation = first ? `Recebi seu arquivo, ${first} 💛` : "Recebi seu arquivo por aqui 💛";
    const body = assessorLink
      ? `${salutation}\n\nA leitura de imagens e PDFs acontece pelo Assessor dentro do app, onde você revisa cada lançamento antes de salvar. Toque no link abaixo para abrir agora:\n\n${assessorLink}\n\nSe preferir, também dá para me contar em texto o que você gastou.`
      : `${salutation}\n\nA leitura de imagens e PDFs acontece pelo Assessor dentro do app. Abra o MeuNino no seu aparelho e toque em "Falar com meu assessor" para revisar este arquivo antes de salvar.\n\nSe preferir, também dá para me contar em texto o que você gastou.`;
    // Idempotência real: se a reentrega chegar antes do worker despachar,
    // a UNIQUE(idempotency_key) devolve 23505 — tratamos como sucesso e
    // NÃO disparamos worker de novo. Outros erros são registrados.
    const { error: insErr } = await sb.from("outbound_messages").insert({
      user_id: link.user_id, to_phone: evt.from_phone, kind: "system",
      channel: "whatsapp", inbound_message_id,
      idempotency_key: idem, status: "queued", body,
    });
    let duplicate = false;
    if (insErr) {
      if (isUniqueViolation(insErr)) {
        duplicate = true;
      } else {
        console.error("[webhook] media_fallback_enqueue_failed", String(insErr.message ?? "").slice(0, 200));
      }
    }
    if (!duplicate) triggerDispatcher();
    await sb.from("inbound_messages")
      .update({ processed_at: new Date().toISOString(), ignored_reason: "media_fallback_link" })
      .eq("id", inbound_message_id).then(() => {}, () => {});
    return json({ ok: true, media: "fallback_link", duplicate });
  }




  // Detach the orchestrator from the HTTP response. WAHA only needs a 200 to
  // ACK the webhook; long LLM turns must not keep the request open (isolate
  // may be killed mid-flight and the user gets silence). We ACK now, run the
  // agent in the background, and ALWAYS enqueue a reply — success or crash.
  const orchestrate = async () => {
    // Percepção de latência: "digitando..." imediato, renovado enquanto o turno
    // roda, e um aviso curto se a consulta passar de alguns segundos. Ambos são
    // best-effort e nunca afetam a resposta.
    let settled = false;
    sendTypingPresence(evt.from_phone, "start").catch(() => {});
    const typingTimer = setInterval(() => {
      if (settled) return;
      sendTypingPresence(evt.from_phone, "start").catch(() => {});
    }, 8_000);
    // Aviso calibrado pela latência real do usuário e pelo que está em curso.
    // Conversa casual ("o que você é?", "bom dia", "obrigado") NÃO recebe aviso:
    // não há motor financeiro rodando, então avisar é ruído.
    const wantsAck = shouldAcknowledge(evt.body ?? "");
    const ack = wantsAck
      ? await planAcknowledgement(sb, { user_id: link.user_id as string, text: evt.body ?? "" })
        .catch(() => ({ delay_ms: 4_000, message: "Só um instante — já estou com isso 👀", observed_p75_ms: null }))
      : null;
    const noticeTimer = ack
      ? setTimeout(() => {
        if (settled) return;
        sendEphemeralText(evt.from_phone, ack.message).catch(() => {});
      }, ack.delay_ms)
      : null;

    const stopHints = () => {
      settled = true;
      clearInterval(typingTimer);
      if (noticeTimer) clearTimeout(noticeTimer);
      sendTypingPresence(evt.from_phone, "stop").catch(() => {});
    };
    try {
      await recordWhatsappPipelineEvent(sb, {
        stage: "agent_started", user_id: link.user_id as string,
        inbound_message_id, provider_message_id: evt.provider_message_id, session: getSessionName(),
      });
      const orchestrated = await runOrchestrator({
        user_id: link.user_id, conversation_id: conversationId,
        inbound_message_id, text: evt.body, to_phone: evt.from_phone, source: "whatsapp",
      });
      stopHints();
      await recordWhatsappPipelineEvent(sb, {
        stage: "agent_completed", user_id: link.user_id as string,
        inbound_message_id, agent_run_id: orchestrated.run_id ?? null,
        provider_message_id: evt.provider_message_id, session: getSessionName(),
        metadata: { path: String(orchestrated.path ?? "unknown").slice(0, 80) },
      });
      const { data: queuedOutbound } = await sb.from("outbound_messages")
        .select("id,user_id")
        .eq("inbound_message_id", inbound_message_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if ((queuedOutbound as any)?.id) {
        await recordWhatsappPipelineEvent(sb, {
          stage: "outbound_queued", user_id: (queuedOutbound as any).user_id ?? link.user_id,
          inbound_message_id, outbound_message_id: (queuedOutbound as any).id,
          agent_run_id: orchestrated.run_id ?? null,
        });
      }
      await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
    } catch (e) {
      const sanitized = String((e as Error).message ?? "orchestrator_error").slice(0, 200);
      console.error("[webhook] orchestrator failed", sanitized);
      await recordWhatsappPipelineEvent(sb, {
        stage: "failed", ok: false, user_id: link.user_id as string,
        inbound_message_id, provider_message_id: evt.provider_message_id,
        session: getSessionName(), error_code: sanitized,
      });
      // Nunca duas mensagens para o mesmo inbound: se o turno já enfileirou
      // uma resposta válida antes de estourar (persistência, telemetria etc.),
      // o usuário recebe só ela — o aviso de falha é suprimido.
      const { data: alreadyQueued } = await sb.from("outbound_messages")
        .select("id").eq("inbound_message_id", inbound_message_id).limit(1).maybeSingle();
      if (!(alreadyQueued as any)?.id) {
        const idem = `orch-err:${inbound_message_id}`;
        await sb.from("outbound_messages").insert({
          user_id: link.user_id, to_phone: evt.from_phone, kind: "agent",
          channel: "whatsapp",
          idempotency_key: idem,
          inbound_message_id,
          status: "queued",
          body: FRIENDLY_ORCHESTRATOR_ERROR,
        }).then(() => {}, () => {});
      }
      await sb.from("inbound_messages")
        .update({ processed_at: new Date().toISOString(), ignored_reason: "orchestrator_error" })
        .eq("id", inbound_message_id).then(() => {}, () => {});
    } finally {
      stopHints();
      triggerDispatcher();
    }
  };

  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    EdgeRuntime.waitUntil(orchestrate());
  } else {
    orchestrate().catch((err) => console.error("[webhook] orchestrate bg", err));
  }
  return json({ ok: true, accepted: true, inbound_message_id }, 202);
});
