// Admin-only WhatsApp session control panel backend.
// GET: legacy health snapshot (used by current UI).
// POST: action-based API — status, create, start, restart, stop, logout, qr, sync_webhook, test_health, send_test.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { getProvider } from "../_shared/messaging/waha.ts";
import { maskPhone, normalizeBrPhone } from "../_shared/messaging/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function hasBaseConfig(): boolean {
  return Boolean(Deno.env.get("WAHA_API_URL") ?? Deno.env.get("WAHA_BASE_URL")) &&
    Boolean(Deno.env.get("WAHA_API_KEY"));
}

function webhookUrl() {
  return `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
}

// Map raw WAHA session status codes to product-facing status codes.
function mapStatus(raw: string | null | undefined, healthOk: boolean | null): string {
  if (!raw) return healthOk === false ? "needs_attention" : "unavailable";
  const s = raw.toUpperCase();
  if (s === "WORKING") return "connected";
  if (s === "SCAN_QR_CODE") return "awaiting_qr";
  if (s === "STARTING") return "connecting";
  if (s === "STOPPED") return "disconnected";
  if (s === "FAILED" || s === "UNREACHABLE") return "needs_attention";
  return "needs_attention";
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false as const, status: 401 };
  const sb = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes, error } = await sb.auth.getUser();
  if (error || !userRes.user) return { ok: false as const, status: 401 };
  const { data: adm } = await sb.rpc("is_current_user_admin");
  if (adm !== true) return { ok: false as const, status: 403 };
  return { ok: true as const, userId: userRes.user.id };
}

async function buildPublicStatus() {
  const provider = getProvider();
  if (!provider.configured || !hasBaseConfig()) {
    return {
      status: "not_configured",
      capabilities: { can_connect: false, can_send: false, needs_session: false, temporarily_unavailable: false },
      phone_masked: null, last_seen_at: null, latency_ms: null, error_code: null,
    };
  }
  const [health, session, me] = await Promise.all([
    provider.getHealth(),
    provider.getSessionStatus(),
    provider.getMe(),
  ]);
  const mapped = mapStatus(session?.status, health?.ok ?? null);
  const capabilities = {
    can_connect: true,
    can_send: mapped === "connected",
    needs_session: ["disconnected", "awaiting_qr", "connecting"].includes(mapped),
    temporarily_unavailable: mapped === "unavailable",
  };
  return {
    status: mapped,
    capabilities,
    phone_masked: me?.phone ? maskPhone(me.phone) : null,
    last_seen_at: new Date().toISOString(),
    latency_ms: health?.latency_ms ?? null,
    error_code: health?.ok === false ? "provider_health_failed" : null,
  };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireAdmin(req);
  if (!gate.ok) return json({ error: gate.status === 401 ? "unauthorized" : "forbidden" }, gate.status);

  const provider = getProvider();
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // GET: capability-based snapshot for admin UI. Never returns raw secret map.
  if (req.method === "GET") {
    const snap = await buildPublicStatus();
    // Best-effort heartbeat for provider health (silent).
    if (snap.status !== "not_configured") {
      await svc.from("provider_health_events").insert({
        provider: "waha", ok: snap.error_code === null, latency_ms: snap.latency_ms ?? 0,
        error_masked: snap.error_code ?? null,
      }).then(() => {}, () => {});
    }
    return json(snap);
  }

  // POST: action-based
  let body: { action?: string; to?: string; consent?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body treated as status */ }
  const action = body.action ?? "status";

  if (!provider.configured && action !== "status") {
    return json({ ok: false, status: "not_configured" }, 400);
  }

  try {
    switch (action) {
      case "status": {
        return json(await buildPublicStatus());
      }

      case "create": {
        const r = await provider.createOrUpdateSession(webhookUrl());
        return json(r, r.ok ? 200 : 502);
      }
      case "sync_webhook": {
        const r = await provider.syncWebhook(webhookUrl());
        return json(r, r.ok ? 200 : 502);
      }
      case "start": {
        const r = await provider.startSession();
        return json(r, r.ok ? 200 : 502);
      }
      case "restart": {
        const r = await provider.restartSession();
        return json(r, r.ok ? 200 : 502);
      }
      case "stop": {
        const r = await provider.stopSession();
        return json(r, r.ok ? 200 : 502);
      }
      case "logout": {
        const r = await provider.logoutSession();
        return json(r, r.ok ? 200 : 502);
      }
      case "qr": {
        const r = await provider.getQr();
        // Do NOT log the QR value. Never persist.
        return json(r, r.ok ? 200 : 502);
      }
      case "test_health": {
        const [h, s, me] = await Promise.all([
          provider.getHealth(), provider.getSessionStatus(), provider.getMe(),
        ]);
        const deepOk = h.ok && s.status === "WORKING" && me.ok && !!me.phone;
        await svc.from("provider_health_events").insert({
          provider: "waha", ok: h.ok, latency_ms: h.latency_ms, error_masked: h.error ?? null,
        }).then(() => {}, () => {});
        return json({
          ok: true, deep_ok: deepOk,
          status: mapStatus(s?.status, h?.ok ?? null),
          latency_ms: h?.latency_ms ?? null,
          phone_masked: me?.phone ? maskPhone(me.phone) : null,
        });
      }

      case "send_test": {
        if (!body.consent) return json({ ok: false, error: "consent_required" }, 400);
        const to = normalizeBrPhone(String(body.to ?? ""));
        if (!to) return json({ ok: false, error: "invalid_phone" }, 400);
        try {
          const r = await provider.sendText(to, "[TESTE NoControle.ia] Mensagem de teste enviada pelo painel administrativo.");
          return json({ ok: true, provider_message_id: r.provider_message_id });
        } catch (e) {
          return json({ ok: false, error: String((e as Error).message).slice(0, 120) }, 502);
        }
      }
      default:
        return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message).slice(0, 200) }, 500);
  }
});
