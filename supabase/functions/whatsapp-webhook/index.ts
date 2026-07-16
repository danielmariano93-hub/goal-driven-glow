// Inbound WhatsApp webhook.
// Security hardening:
//  - Body size cap (128 KB): reject anything larger.
//  - Provider secret verification (WahaProvider.verifyWebhookSecret).
//  - Dedupe by (provider_message_id) unique constraint on inbound_messages,
//    plus a full-payload sha256 raw_hash.
//  - VINCULAR uses phone_link_codes.lookup_key (sha256 of code alone) for
//    O(1) lookup without scanning; the definitive check still verifies
//    code_hash = sha256(code || user_id), keeping the code irreversible.
//  - Ownership: after VINCULAR success, only phone_e164 matched to the
//    active whatsapp_links row is allowed to orchestrate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider, loadWahaConfig } from "../_shared/messaging/waha.ts";
import { runOrchestrator } from "../_shared/agent/orchestrator.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY_BYTES = 128 * 1024;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  if (!provider.verifyWebhookSecret(req.headers)) return json({ error: "unauthorized" }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
  const evt = provider.mapInboundEvent(payload);
  if (!evt) return json({ ok: true, ignored: "unmapped_or_bot" }, 200);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

  // VINCULAR — deterministic O(1) lookup via lookup_key
  const m = evt.body.match(/^\s*VINCULAR\s+(\d{4,8})\s*$/i);
  if (m) {
    const code = m[1];
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
    const replyOk = "Pronto! Seu WhatsApp está vinculado ao NoControle.ia. 🎉";
    const replyBad = "Não consegui validar esse código. Gere um novo em /app/whatsapp.";
    if (!matched) {
      await sb.from("outbound_messages").insert({ to_phone: evt.from_phone, body: replyBad, kind: "system" });
      return json({ ok: true, link: "invalid_code" });
    }
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
      return json({ ok: true, link: "error" });
    }
    await sb.from("phone_link_codes").update({ used_at: new Date().toISOString() }).eq("id", matched.id);
    await sb.from("outbound_messages").insert({
      user_id: matched.user_id, to_phone: evt.from_phone, body: replyOk, kind: "system",
    });
    return json({ ok: true, link: "created" });
  }

  const phone_hash = await sha256Hex(evt.from_phone);
  const { data: link } = await sb.from("whatsapp_links")
    .select("user_id").eq("phone_hash", phone_hash).eq("status", "active").maybeSingle();
  if (!link) {
    await sb.from("outbound_messages").insert({
      to_phone: evt.from_phone,
      body: "Olá! Este número ainda não está vinculado a uma conta do NoControle.ia. Acesse /app/whatsapp para gerar um código de vinculação.",
      kind: "system",
    });
    return json({ ok: true, unlinked: true });
  }

  const { data: conv } = await sb.from("conversations").upsert(
    { user_id: link.user_id, phone_e164: evt.from_phone, last_message_at: new Date().toISOString() },
    { onConflict: "user_id,phone_e164" },
  ).select("id").maybeSingle();
  if (!conv) return json({ error: "conv_failed" }, 500);
  await sb.from("conversation_messages").insert({
    conversation_id: conv.id, user_id: link.user_id, direction: "inbound",
    body_masked: evt.body.slice(0, 500),
  });

  const result = await runOrchestrator({
    user_id: link.user_id, conversation_id: conv.id as string,
    inbound_message_id, text: evt.body, to_phone: evt.from_phone, source: "whatsapp",
  });
  await sb.from("inbound_messages").update({ processed_at: new Date().toISOString() }).eq("id", inbound_message_id);
  return json({ ok: true, reply_kind: result.reply_kind, path: result.path });
});
