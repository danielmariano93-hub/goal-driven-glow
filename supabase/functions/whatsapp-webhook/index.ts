import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider } from "../_shared/messaging/waha.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const provider = getProvider();
  if (!provider.configured) return json({ ok: true, ignored: "not_configured" }, 200);
  if (!provider.verifyWebhookSecret(req.headers)) return json({ error: "unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const evt = provider.mapInboundEvent(payload);
  if (!evt) return json({ ok: true, ignored: "unmapped_or_bot" }, 200);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotent insert (unique on provider+provider_message_id)
  const raw_hash = await sha256Hex(JSON.stringify(payload));
  const { error: insErr } = await supabase.from("inbound_messages").insert({
    provider: evt.provider,
    provider_message_id: evt.provider_message_id,
    from_phone: evt.from_phone,
    to_phone: evt.to_phone ?? null,
    body: evt.body,
    raw_hash,
    received_at: evt.received_at,
  });
  if (insErr && !String(insErr.message).toLowerCase().includes("duplicate")) {
    console.error("[webhook] insert failed", insErr.message);
    return json({ error: "internal" }, 500);
  }
  if (insErr) return json({ ok: true, dedup: true });

  // Command: VINCULAR NNNNNN
  const m = evt.body.match(/^\s*VINCULAR\s+(\d{4,8})\s*$/i);
  if (m) {
    const code = m[1];
    // Locate an unexpired, unused code that matches (compare against every user's active code)
    // hash = sha256(code || user_id) — we must look up user by trying to find a matching hash.
    // Efficient approach: fetch pending codes and compare in JS (bounded set: recent only).
    const { data: codes } = await supabase
      .from("phone_link_codes")
      .select("id,user_id,code_hash,expires_at,used_at,attempts")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(200);

    let matched: { id: string; user_id: string } | null = null;
    for (const row of codes ?? []) {
      const h = await sha256Hex(code + row.user_id);
      if (h === row.code_hash) {
        matched = { id: row.id as string, user_id: row.user_id as string };
        break;
      }
    }

    // Never reveal existence of another user
    const replyOk = "Pronto! Seu WhatsApp está vinculado ao NoControle.ia. 🎉";
    const replyBad = "Não consegui validar esse código. Gere um novo em /app/whatsapp.";

    if (!matched) {
      await supabase.from("outbound_messages").insert({
        to_phone: evt.from_phone, body: replyBad, kind: "system",
      });
      return json({ ok: true, link: "invalid_code" });
    }

    // Enforce single active link per user AND per phone
    await supabase.from("whatsapp_links").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("user_id", matched.user_id).eq("status", "active");
    await supabase.from("whatsapp_links").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("phone_e164", evt.from_phone).eq("status", "active");

    const phone_hash = await sha256Hex(evt.from_phone);
    const masked = "+55 (**) *****-" + evt.from_phone.slice(-4);
    const { error: linkErr } = await supabase.from("whatsapp_links").insert({
      user_id: matched.user_id,
      phone_e164: evt.from_phone,
      phone_hash,
      phone_masked: masked,
      status: "active",
      last_verified_at: new Date().toISOString(),
    });
    if (linkErr) {
      console.error("[webhook] link failed", linkErr.message);
      await supabase.from("outbound_messages").insert({
        to_phone: evt.from_phone, body: replyBad, kind: "system",
      });
      return json({ ok: true, link: "error" });
    }

    await supabase.from("phone_link_codes").update({ used_at: new Date().toISOString() }).eq("id", matched.id);
    await supabase.from("outbound_messages").insert({
      user_id: matched.user_id, to_phone: evt.from_phone, body: replyOk, kind: "system",
    });
    return json({ ok: true, link: "created" });
  }

  // Non-VINCULAR path: identify user via active link
  const phone_hash = await sha256Hex(evt.from_phone);
  const { data: link } = await supabase
    .from("whatsapp_links")
    .select("user_id")
    .eq("phone_hash", phone_hash)
    .eq("status", "active")
    .maybeSingle();

  const notLinked = "Olá! Este número ainda não está vinculado a uma conta do NoControle.ia. Acesse /app/whatsapp para gerar um código de vinculação.";
  if (!link) {
    await supabase.from("outbound_messages").insert({
      to_phone: evt.from_phone, body: notLinked, kind: "system",
    });
    return json({ ok: true, unlinked: true });
  }

  // Persist conversation and enqueue a stub agent reply (Bloco B activates the LLM path).
  const { data: conv } = await supabase
    .from("conversations")
    .upsert(
      { user_id: link.user_id, phone_e164: evt.from_phone, last_message_at: new Date().toISOString() },
      { onConflict: "user_id,phone_e164", ignoreDuplicates: false },
    )
    .select("id").maybeSingle();
  if (conv) {
    await supabase.from("conversation_messages").insert({
      conversation_id: conv.id, user_id: link.user_id, direction: "inbound",
      body_masked: evt.body.slice(0, 500),
    });
  }
  const stub = "Recebi sua mensagem. Em breve o assistente financeiro do NoControle.ia responderá aqui. (Fase 3 · Bloco B pendente)";
  await supabase.from("outbound_messages").insert({
    user_id: link.user_id, to_phone: evt.from_phone, body: stub, kind: "system",
  });
  return json({ ok: true, queued: true });
});
