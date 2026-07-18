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
import { getProvider, getSessionName, getWahaAccess, loadWahaConfig } from "../_shared/messaging/waha.ts";
import { classifyInbound } from "../_shared/messaging/wahaInbound.ts";
import { downloadInboundMedia } from "../_shared/messaging/wahaMedia.ts";
import { runOrchestrator, FRIENDLY_ORCHESTRATOR_ERROR } from "../_shared/agent/orchestrator.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

type DropCtx = {
  reason: string;
  event: string | null;
  session: string | null;
  jid_domains: string[];
  has_alt: boolean;
  has_key: boolean;
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
  // Alternate: "meu código é 123456" together with the word NoControle to
  // avoid grabbing arbitrary numbers.
  if (/NoControle/i.test(t)) {
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
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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
    return json({ error: "unauthorized" }, 401);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const expected = getSessionName();
  const classified = classifyInbound(payload, expected);
  if (!classified.ok) {
    await logDrop(sb, {
      reason: classified.reason,
      event: classified.event,
      session: classified.session,
      jid_domains: classified.jid_domains,
      has_alt: classified.has_alt,
      has_key: classified.has_key,
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
  const { data: inb, error: insErr } = await sb.from("inbound_messages").insert({
    provider: evt.provider,
    provider_message_id: evt.provider_message_id,
    from_phone: evt.from_phone,
    to_phone: evt.to_phone ?? null,
    body: evt.body,
    raw_hash,
    received_at: evt.received_at,
  }).select("id").maybeSingle();
  if (insErr && !String(insErr.message).toLowerCase().includes("duplicate")) {
    console.error("[webhook] insert failed", insErr.message);
    return json({ error: "internal" }, 500);
  }
  if (insErr) return json({ ok: true, dedup: true });
  const inbound_message_id = inb!.id as string;

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
    await sb.from("outbound_messages").insert({
      to_phone: evt.from_phone,
      body: "Olá! Este número ainda não está vinculado a uma conta do NoControle.ia. Abra o app, gere um código de verificação e me envie por aqui — te espero. 💛",
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
    return json({ ok: true, error: "conversation_error" }, 200);
  }
  await sb.from("conversation_messages").insert({
    conversation_id: conversationId, user_id: link.user_id, direction: "inbound",
    body_masked: evt.body.slice(0, 500),
  });

  // === MEDIA PATH: document ingestion ===
  // Any media descriptor triggers the download flow; URL is optional because
  // NOWEB frequently omits it and we must download via the WAHA files endpoint.
  if (evt.media) {
    // Idempotency: same provider_message_id must never create two document_imports.
    const { data: existing } = await sb.from("document_imports")
      .select("id, status").eq("provider_message_id", evt.provider_message_id).maybeSingle();
    if (existing) {
      await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
      return json({ ok: true, media: "duplicate", document_id: existing.id });
    }
    const access = getWahaAccess();
    const dl = await downloadInboundMedia({
      media: evt.media,
      apiUrl: access.api_url,
      apiKey: access.api_key,
      session: access.session,
      messageId: evt.provider_message_id,
    });
    if (!dl.ok) {
      const body = dl.code === "size_exceeds"
        ? "Esse arquivo é maior que 20 MB e não consegui processar. Envie um documento menor ou peça extrato em partes."
        : dl.code === "mime_not_allowed"
        ? "Esse formato de arquivo eu ainda não consigo ler. Envie PDF, JPG, PNG ou WEBP, por favor."
        : dl.code === "unsafe_url"
        ? "Não consegui baixar esse arquivo com segurança. Reenvie diretamente pelo WhatsApp, por favor."
        : dl.code === "timeout"
        ? "A leitura demorou demais para baixar. Tente enviar novamente em instantes."
        : "Recebi seu arquivo, mas não consegui baixá-lo por aqui. Reenvie, por favor.";
      await sb.from("outbound_messages").insert({ user_id: link.user_id, to_phone: evt.from_phone, kind: "system", body });
      triggerDispatcher();
      await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
      return json({ ok: true, media: "download_failed", code: dl.code });
    }
    const doc_id = crypto.randomUUID();
    const ext = dl.mime_type === "application/pdf" ? "pdf" : dl.mime_type.split("/")[1];
    const storage_path = `${link.user_id}/${doc_id}.${ext}`;
    const up = await sb.storage.from("documents").upload(storage_path, dl.bytes, { contentType: dl.mime_type, upsert: false });
    if (up.error) {
      await sb.from("outbound_messages").insert({
        user_id: link.user_id, to_phone: evt.from_phone, kind: "system",
        body: "Recebi seu arquivo mas tive problemas para armazená-lo. Tente novamente em instantes.",
      });
      triggerDispatcher();
      return json({ ok: true, media: "storage_failed" });
    }
    const shaBuf = await crypto.subtle.digest("SHA-256", dl.bytes);
    const sha = Array.from(new Uint8Array(shaBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error: insErrDoc } = await sb.from("document_imports").insert({
      id: doc_id,
      user_id: link.user_id,
      source: "whatsapp",
      provider_message_id: evt.provider_message_id,
      conversation_id: conv.id,
      storage_path,
      mime_type: dl.mime_type,
      size_bytes: dl.bytes.length,
      sha256: sha,
      status: "uploaded",
      user_instructions: evt.body ? evt.body.slice(0, 500) : null,
    });
    if (insErrDoc) {
      console.error("[webhook] document_imports insert failed", insErrDoc.message);
      return json({ ok: true, media: "insert_failed" });
    }
    await sb.from("document_processing_events").insert({
      document_id: doc_id, user_id: link.user_id,
      event_type: "document_received",
      metadata: { source: "whatsapp", mime: dl.mime_type, size: dl.bytes.length },
    }).then(() => {}, () => {});
    await sb.from("outbound_messages").insert({
      user_id: link.user_id, to_phone: evt.from_phone, kind: "system",
      body: "Recebi seu documento e já estou lendo para você. Volto em instantes com os lançamentos para você conferir. 📄",
    });
    // Fire-and-forget the ingestion trigger. `process-inbound-media` handles auth.
    fetch(`${SUPABASE_URL}/functions/v1/assistant-ingest-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ mode: "process-inbound-media", document_id: doc_id, user_id: link.user_id, guidance: evt.body ?? "" }),
    }).catch(() => {});
    triggerDispatcher();
    await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
    return json({ ok: true, media: "queued", document_id: doc_id });
  }


  // Detach the orchestrator from the HTTP response. WAHA only needs a 200 to
  // ACK the webhook; long LLM turns must not keep the request open (isolate
  // may be killed mid-flight and the user gets silence). We ACK now, run the
  // agent in the background, and ALWAYS enqueue a reply — success or crash.
  const orchestrate = async () => {
    try {
      await runOrchestrator({
      user_id: link.user_id, conversation_id: conversationId,
        inbound_message_id, text: evt.body, to_phone: evt.from_phone, source: "whatsapp",
      });
      await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
    } catch (e) {
      const sanitized = String((e as Error).message ?? "orchestrator_error").slice(0, 200);
      console.error("[webhook] orchestrator failed", sanitized);
      const idem = `orch-err:${inbound_message_id}`;
      await sb.from("outbound_messages").insert({
        user_id: link.user_id, to_phone: evt.from_phone, kind: "agent",
        channel: "whatsapp",
        idempotency_key: idem,
        inbound_message_id,
        status: "queued",
        body: FRIENDLY_ORCHESTRATOR_ERROR,
      }).then(() => {}, () => {});
      await sb.from("inbound_messages")
        .update({ processed_at: new Date().toISOString(), ignored_reason: "orchestrator_error" })
        .eq("id", inbound_message_id).then(() => {}, () => {});
    } finally {
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
