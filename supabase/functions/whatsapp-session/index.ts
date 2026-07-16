// Admin-only WhatsApp session control panel backend.
// Actions: config_status, save_config, test_config, setup_session, status, qr,
// restart, logout, send_test, sync_webhook, validate, create, start, stop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  getProvider, validateWahaCredentials, loadWahaConfig, isWahaConfigured,
  buildWahaTester, primeWahaConfig,
} from "../_shared/messaging/waha.ts";
import { maskPhone, normalizeBrPhone } from "../_shared/messaging/types.ts";
import { assertPublicHttpsUrl } from "../_shared/security/ssrf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

type Gate =
  | { ok: true; userId: string; role: string | null; sb: ReturnType<typeof createClient> }
  | { ok: false; status: number };

async function requireAdmin(req: Request): Promise<Gate> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { ok: false, status: 401 };
  const sb = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes, error } = await sb.auth.getUser();
  if (error || !userRes.user) return { ok: false, status: 401 };
  const { data: isAdmin } = await sb.rpc("is_platform_admin");
  if (isAdmin !== true) return { ok: false, status: 403 };
  const { data: role } = await sb.rpc("current_platform_admin_role");
  return { ok: true, userId: userRes.user.id, role: (role as string | null) ?? null, sb };
}

async function buildPublicStatus() {
  const provider = getProvider();
  if (!provider.configured || !isWahaConfigured()) {
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

async function rateOk(sb: ReturnType<typeof createClient>, action: string): Promise<boolean> {
  const { data, error } = await sb.rpc("admin_rate_check", { p_action: action, p_limit: 10 });
  if (error) return true; // fail-open on limit itself; never leak
  return data === true;
}

function canPair(role: string | null): boolean {
  return role === "platform_owner" || role === "platform_admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();
  const extraHeaders = { "X-Correlation-Id": correlationId };

  const gate = await requireAdmin(req);
  if (!gate.ok) return json({ error: gate.status === 401 ? "unauthorized" : "forbidden" }, gate.status, extraHeaders);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prime WAHA config from Vault at the start of every request.
  await loadWahaConfig(svc);
  const provider = getProvider();

  // GET: capability-based snapshot (legacy).
  if (req.method === "GET") {
    const snap = await buildPublicStatus();
    return json(snap, 200, extraHeaders);
  }

  let body: {
    action?: string; to?: string; consent?: boolean;
    url?: string; api_key?: string; webhook_secret?: string; session_name?: string;
  } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = body.action ?? "status";

  try {
    switch (action) {
      case "config_status": {
        const { data, error } = await gate.sb.rpc("admin_waha_config_status");
        if (error) return json({ ok: false, error_code: "config_status_failed" }, 500, extraHeaders);
        const payload = (data as Record<string, unknown>) ?? {};
        return json({
          ok: true,
          ...payload,
          admin_role: payload.admin_role ?? gate.role,
          can_manage_config: gate.role === "platform_owner",
        }, 200, extraHeaders);
      }

      case "test_config": {
        if (!(await rateOk(gate.sb, "waha_test"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        const url = String(body.url ?? "").trim();
        const key = String(body.api_key ?? "").trim();
        const guard = assertPublicHttpsUrl(url);
        if (!guard.ok) return json({ ok: false, error_code: guard.code }, 400, extraHeaders);
        if (key.length < 4 || key.length > 500) return json({ ok: false, error_code: "invalid_api_key" }, 400, extraHeaders);
        const tester = buildWahaTester({ api_url: url.replace(/\/+$/, ""), api_key: key });
        const result = await tester.ping();
        return json({ ok: result.code === "ok", ...result }, 200, extraHeaders);
      }

      case "save_config": {
        if (gate.role !== "platform_owner") {
          return json({ ok: false, error_code: "owner_required" }, 403, extraHeaders);
        }
        if (!(await rateOk(gate.sb, "waha_save"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        const url = String(body.url ?? "").trim().replace(/\/+$/, "");
        const key = String(body.api_key ?? "").trim();
        // session_name is resolved server-side from Vault; frontend cannot set it.
        // The RPC default handles first-time provisioning.
        const guard = assertPublicHttpsUrl(url);
        if (!guard.ok) return json({ ok: false, error_code: guard.code }, 400, extraHeaders);
        if (key.length < 4 || key.length > 500) return json({ ok: false, error_code: "invalid_api_key" }, 400, extraHeaders);
        const { error } = await gate.sb.rpc("admin_waha_save_config", {
          p_url: url, p_api_key: key,
          p_webhook_secret: body.webhook_secret ?? null,
        });
        if (error) return json({ ok: false, error_code: "save_failed" }, 500, extraHeaders);
        // Prime in-memory so follow-up actions in the same call chain see it.
        primeWahaConfig({ api_url: url, api_key: key });
        const { data: statusData } = await gate.sb.rpc("admin_waha_config_status");
        return json({ ok: true, ...(statusData as Record<string, unknown>) }, 200, extraHeaders);
      }

      case "setup_session": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        if (!provider.configured) return json({ ok: false, error_code: "not_configured" }, 400, extraHeaders);
        if (!(await rateOk(gate.sb, "waha_setup"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        // Idempotent: create/update, then start if not WORKING/STARTING.
        const created = await provider.createOrUpdateSession(webhookUrl());
        if (!created.ok) return json({ ok: false, error_code: "session_setup_failed" }, 502, extraHeaders);
        const s = await provider.getSessionStatus();
        const raw = (s?.status ?? "").toUpperCase();
        if (raw !== "WORKING" && raw !== "STARTING" && raw !== "SCAN_QR_CODE") {
          await provider.startSession();
        }
        return json({ ok: true, ...(await buildPublicStatus()) }, 200, extraHeaders);
      }

      case "validate": {
        const report = await validateWahaCredentials(webhookUrl());
        return json({ ok: true, report }, 200, extraHeaders);
      }

      case "status": return json(await buildPublicStatus(), 200, extraHeaders);
      case "create": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        const r = await provider.createOrUpdateSession(webhookUrl());
        return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders);
      }
      case "sync_webhook": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        const r = await provider.syncWebhook(webhookUrl());
        return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders);
      }
      case "start":   { if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders); const r = await provider.startSession();   return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders); }
      case "restart": { if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders); const r = await provider.restartSession(); return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders); }
      case "stop":    { if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders); const r = await provider.stopSession();    return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders); }
      case "logout":  {
        if (!canPair(gate.role)) {
          return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        }
        const r = await provider.logoutSession();
        return json({ ok: r.ok }, r.ok ? 200 : 502, extraHeaders);
      }
      case "qr": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        const r = await provider.getQr();
        return json(r, r.ok ? 200 : 502, extraHeaders);
      }
      case "send_test": {
        if (!body.consent) return json({ ok: false, error_code: "consent_required" }, 400, extraHeaders);
        const to = normalizeBrPhone(String(body.to ?? ""));
        if (!to) return json({ ok: false, error_code: "invalid_phone" }, 400, extraHeaders);
        try {
          const r = await provider.sendText(to, "[TESTE NoControle.ia] Mensagem de teste enviada pelo painel administrativo.");
          return json({ ok: true, provider_message_id: r.provider_message_id }, 200, extraHeaders);
        } catch {
          return json({ ok: false, error_code: "provider_error" }, 502, extraHeaders);
        }
      }
      case "prepare_pairing": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        if (!provider.configured) return json({ ok: false, error_code: "not_configured" }, 400, extraHeaders);
        if (!(await rateOk(gate.sb, "waha_prepare"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        const p = await provider.preparePairing(webhookUrl());
        const snap = await buildPublicStatus();
        return json({ ok: p.ok, ...snap, correlation_id: correlationId }, 200, extraHeaders);
      }
      case "begin_qr": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        if (!provider.configured) return json({ ok: false, error_code: "not_configured" }, 400, extraHeaders);
        if (!(await rateOk(gate.sb, "waha_qr"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        const p = await provider.preparePairing(webhookUrl());
        if (!p.ok) return json({ ok: false, error_code: "prepare_failed" }, 502, extraHeaders);
        // wait a beat if not yet scan_qr
        let raw = p.status;
        const start = Date.now();
        while (raw !== "SCAN_QR_CODE" && raw !== "WORKING" && Date.now() - start < 8_000) {
          await new Promise((r) => setTimeout(r, 700));
          const s = await provider.getSessionStatus();
          raw = (s.status ?? "").toUpperCase();
        }
        if (raw === "WORKING") return json({ ok: true, connected: true }, 200, extraHeaders);
        if (raw !== "SCAN_QR_CODE") return json({ ok: false, error_code: "qr_not_ready" }, 202, extraHeaders);
        const q = await provider.getQr();
        if (!q.ok || !q.base64) return json({ ok: false, error_code: "qr_unavailable" }, 502, extraHeaders);
        const expires_at = new Date(Date.now() + 60_000).toISOString();
        return json({ ok: true, qr: q.base64, mime_type: q.mimeType ?? "image/png", expires_at }, 200, extraHeaders);
      }
      case "reset_session": {
        if (!canPair(gate.role)) return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        if (!provider.configured) return json({ ok: false, error_code: "not_configured" }, 400, extraHeaders);
        if (!(await rateOk(gate.sb, "waha_reset"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        try { await provider.logoutSession(); } catch { /* best effort */ }
        const created = await provider.createOrUpdateSession(webhookUrl());
        if (!created.ok) return json({ ok: false, error_code: "session_setup_failed" }, 502, extraHeaders);
        await provider.startSession();
        // Give WAHA a moment to advance to SCAN_QR_CODE
        const start = Date.now();
        let raw = "";
        while (Date.now() - start < 10_000) {
          await new Promise((r) => setTimeout(r, 700));
          const s = await provider.getSessionStatus();
          raw = (s.status ?? "").toUpperCase();
          if (raw === "SCAN_QR_CODE" || raw === "WORKING") break;
        }
        return json({ ok: true, ...(await buildPublicStatus()) }, 200, extraHeaders);
      }
      case "request_pairing_code": {
        if (!provider.configured) return json({ ok: false, error_code: "not_configured" }, 400, extraHeaders);
        if (!canPair(gate.role)) {
          return json({ ok: false, error_code: "forbidden" }, 403, extraHeaders);
        }
        if (!(await rateOk(gate.sb, "waha_pairing_code"))) {
          return json({ ok: false, error_code: "rate_limited" }, 429, extraHeaders);
        }
        const phoneE164 = normalizeBrPhone(String(body.to ?? ""));
        if (!phoneE164) return json({ ok: false, error_code: "invalid_phone" }, 400, extraHeaders);
        const digits = phoneE164.replace(/^\+/, "");
        // Ensure session is in SCAN_QR_CODE before requesting a pairing code.
        await provider.preparePairing(webhookUrl());
        const waitStart = Date.now();
        let rawStatus = "";
        while (Date.now() - waitStart < 10_000) {
          const s = await provider.getSessionStatus();
          rawStatus = (s.status ?? "").toUpperCase();
          if (rawStatus === "SCAN_QR_CODE") break;
          if (rawStatus === "WORKING") return json({ ok: false, error_code: "already_connected" }, 200, extraHeaders);
          await new Promise((r) => setTimeout(r, 700));
        }
        if (rawStatus !== "SCAN_QR_CODE") {
          return json({ ok: false, error_code: "session_not_ready" }, 200, extraHeaders);
        }
        const r = await provider.requestPairingCode(digits);
        if (!r.ok) return json({ ok: false, error_code: r.error_code ?? "provider_error" }, 200, extraHeaders);
        return json({ ok: true, pairing_code: r.code, expires_at: r.expires_at ?? new Date(Date.now() + 60_000).toISOString() }, 200, extraHeaders);
      }

      default:
        return json({ ok: false, error_code: "unknown_action" }, 400, extraHeaders);
    }
  } catch {
    return json({ ok: false, error_code: "internal_error", correlation_id: correlationId }, 500, extraHeaders);
  }
});
