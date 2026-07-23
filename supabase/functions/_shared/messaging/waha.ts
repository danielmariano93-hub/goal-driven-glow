import type { MessagingProvider, NormalizedInbound } from "./types.ts";
import { normalizeBrPhone } from "./types.ts";
import { classifyInbound, type ClassifiedInbound } from "./wahaInbound.ts";

export { classifyInbound } from "./wahaInbound.ts";
export type { ClassifiedInbound } from "./wahaInbound.ts";

// Runtime WAHA config. Initialized from env vars (retrocompat) and can be
// hydrated at request time from the Supabase Vault via `loadWahaConfig`.
// Session isolation for this project is enforced by the resolved
// `session_name` from Vault + a project-scoped webhook URL + session metadata,
// NOT by a hardcoded session literal. Fallback is the WAHA CORE-safe `default`.
export const DEFAULT_SESSION_FALLBACK = "default";
let WAHA_API_URL =
  Deno.env.get("WAHA_API_URL") ?? Deno.env.get("WAHA_BASE_URL") ?? "";
let WAHA_API_KEY = Deno.env.get("WAHA_API_KEY") ?? "";
let WAHA_SESSION = Deno.env.get("MEUNINO_WAHA_SESSION") ?? Deno.env.get("NOCONTROLE_WAHA_SESSION") ?? Deno.env.get("WAHA_SESSION") ?? DEFAULT_SESSION_FALLBACK;
let WAHA_WEBHOOK_SECRET = Deno.env.get("WAHA_WEBHOOK_SECRET") ?? "";

export function getSessionName(): string { return WAHA_SESSION; }
/** Expose primed config so downstream helpers (e.g. wahaMedia) can perform
 *  authenticated calls without re-reading env or Vault. */
export function getWahaAccess(): { api_url: string; api_key: string; session: string } {
  return { api_url: WAHA_API_URL, api_key: WAHA_API_KEY, session: WAHA_SESSION };
}

export type WahaConfig = { api_url: string; api_key: string; webhook_secret: string; session_name: string };

/** Hydrate module state from a candidate config (Vault). Falls back to env when a slot is empty. */
export function primeWahaConfig(cfg: Partial<WahaConfig>) {
  if (cfg.api_url)        WAHA_API_URL = cfg.api_url;
  if (cfg.api_key)        WAHA_API_KEY = cfg.api_key;
  if (cfg.session_name)   WAHA_SESSION = cfg.session_name;
  if (cfg.webhook_secret) WAHA_WEBHOOK_SECRET = cfg.webhook_secret;
}

/** Load config from Vault via the resolver RPC (service_role). Safe to call once per request. */
export async function loadWahaConfig(supabaseServiceClient: {
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
}): Promise<{ source: "vault" | "env" | "mixed" }> {
  try {
    const { data, error } = await supabaseServiceClient.rpc("admin_waha_resolve_config");
    if (error || !data) return { source: "env" };
    const c = data as Partial<WahaConfig>;
    const anyVault = Boolean(c?.api_url || c?.api_key || c?.webhook_secret);
    if (anyVault) primeWahaConfig(c);
    return { source: anyVault ? "vault" : "env" };
  } catch {
    return { source: "env" };
  }
}

export function isWahaConfigured(): boolean {
  return Boolean(WAHA_API_URL && WAHA_API_KEY && WAHA_SESSION && WAHA_WEBHOOK_SECRET);
}

/** Build ephemeral fetch closures using a candidate config (for `test_config`). */
export function buildWahaTester(cand: { api_url: string; api_key: string }) {
  const h = { "Content-Type": "application/json", "X-Api-Key": cand.api_key };
  return {
    async ping(): Promise<{ host_ok: boolean; auth_ok: boolean; latency_ms: number; code: "ok" | "unreachable" | "unauthorized" | "status_error" }> {
      const t0 = performance.now();
      try {
        const r = await safeFetch(`${cand.api_url}/api/sessions`, { headers: h }, 6_000);
        const latency = Math.round(performance.now() - t0);
        if (r.status === 401 || r.status === 403) return { host_ok: true, auth_ok: false, latency_ms: latency, code: "unauthorized" };
        if (r.ok || r.status === 404) return { host_ok: true, auth_ok: true, latency_ms: latency, code: "ok" };
        return { host_ok: r.status < 500, auth_ok: false, latency_ms: latency, code: "status_error" };
      } catch {
        return { host_ok: false, auth_ok: false, latency_ms: Math.round(performance.now() - t0), code: "unreachable" };
      }
    },
  };
}


/**
 * Sanitized credential validation. NEVER returns URLs, tokens, secret values,
 * or raw error bodies — only booleans and short mapped codes.
 */
export type WahaValidationReport = {
  secrets: { api_url: boolean; api_key: boolean; webhook_secret: boolean; session_name: string };
  host: { ok: boolean; latency_ms: number; code: "ok" | "unreachable" | "not_configured" | "status_error" };
  auth: { ok: boolean; code: "ok" | "unauthorized" | "unreachable" | "not_configured" | "status_error" };
  session: { exists: boolean; status: string | null; code: "ok" | "session_missing" | "unreachable" | "unauthorized" | "not_configured" | "status_error" };
  webhook: {
    configured: boolean;
    matches_url: boolean;
    has_secret_header: boolean;
    events_ok: boolean;
    code: "ok" | "webhook_missing" | "webhook_mismatch" | "unreachable" | "unauthorized" | "not_configured" | "status_error";
  };
};

const REQUIRED_EVENTS = ["message", "message.any", "message.ack", "session.status"];

export async function validateWahaCredentials(expectedWebhookUrl: string): Promise<WahaValidationReport> {
  const secrets = {
    api_url: Boolean(WAHA_API_URL),
    api_key: Boolean(WAHA_API_KEY),
    webhook_secret: Boolean(WAHA_WEBHOOK_SECRET),
    session_name: WAHA_SESSION,
  };

  if (!secrets.api_url || !secrets.api_key) {
    return {
      secrets,
      host: { ok: false, latency_ms: 0, code: "not_configured" },
      auth: { ok: false, code: "not_configured" },
      session: { exists: false, status: null, code: "not_configured" },
      webhook: { configured: false, matches_url: false, has_secret_header: false, events_ok: false, code: "not_configured" },
    };
  }

  // Host reachability: unauthenticated ping to root (or /api/version). Timeout tight.
  const t0 = performance.now();
  let hostOk = false;
  let hostCode: WahaValidationReport["host"]["code"] = "status_error";
  try {
    const r = await safeFetch(`${WAHA_API_URL}/api/version`, {}, 6_000);
    hostOk = r.status < 500;
    hostCode = hostOk ? "ok" : "status_error";
  } catch {
    hostCode = "unreachable";
  }
  const latency = Math.round(performance.now() - t0);

  // Auth + session in a single call: /api/sessions/{name}
  let authOk = false;
  let authCode: WahaValidationReport["auth"]["code"] = "status_error";
  let sessionExists = false;
  let sessionStatus: string | null = null;
  let sessionCode: WahaValidationReport["session"]["code"] = "status_error";
  let sessionBody: { config?: { webhooks?: Array<{ url?: string; events?: string[]; customHeaders?: Array<{ name?: string; value?: string }> }> } } | null = null;

  if (hostCode === "unreachable") {
    authCode = "unreachable";
    sessionCode = "unreachable";
  } else {
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() }, 8_000);
      if (r.status === 401 || r.status === 403) {
        authCode = "unauthorized";
        sessionCode = "unauthorized";
      } else if (r.status === 404) {
        authOk = true;
        authCode = "ok";
        sessionCode = "session_missing";
      } else if (r.ok) {
        authOk = true;
        authCode = "ok";
        sessionExists = true;
        try {
          sessionBody = await r.json();
          sessionStatus = (sessionBody as { status?: string })?.status ?? null;
        } catch { /* ignore body parse */ }
        sessionCode = "ok";
      } else {
        authCode = "status_error";
        sessionCode = "status_error";
      }
    } catch {
      authCode = "unreachable";
      sessionCode = "unreachable";
    }
  }

  // Webhook derived from session config; never expose URLs, only booleans.
  let webhook: WahaValidationReport["webhook"] = {
    configured: false, matches_url: false, has_secret_header: false, events_ok: false,
    code: "webhook_missing",
  };
  if (sessionCode === "unreachable" || sessionCode === "unauthorized" || sessionCode === "not_configured") {
    webhook.code = sessionCode as WahaValidationReport["webhook"]["code"];
  } else if (sessionCode === "session_missing") {
    webhook.code = "webhook_missing";
  } else if (sessionCode === "status_error") {
    webhook.code = "status_error";
  } else if (sessionBody?.config?.webhooks?.length) {
    const hooks = sessionBody.config.webhooks;
    const match = hooks.find((h) => (h?.url ?? "") === expectedWebhookUrl);
    const anyConfigured = hooks.length > 0;
    const matches = Boolean(match);
    const events = match?.events ?? [];
    const eventsOk = REQUIRED_EVENTS.every((e) => events.includes(e));
    const hasSecret = Boolean(
      match?.customHeaders?.some((h) => (h?.name ?? "").toLowerCase() === "x-webhook-secret" && Boolean(h?.value)),
    );
    webhook = {
      configured: anyConfigured,
      matches_url: matches,
      has_secret_header: hasSecret,
      events_ok: eventsOk,
      code: matches && eventsOk && hasSecret ? "ok" : anyConfigured ? "webhook_mismatch" : "webhook_missing",
    };
  }

  return {
    secrets,
    host: { ok: hostOk, latency_ms: latency, code: hostCode },
    auth: { ok: authOk, code: authCode },
    session: { exists: sessionExists, status: sessionStatus, code: sessionCode },
    webhook,
  };
}

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
}

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface WahaExtras {
  createOrUpdateSession(webhookUrl: string): Promise<{ ok: boolean; error?: string }>;
  startSession(): Promise<{ ok: boolean; error?: string }>;
  stopSession(): Promise<{ ok: boolean; error?: string }>;
  logoutSession(): Promise<{ ok: boolean; error?: string }>;
  restartSession(): Promise<{ ok: boolean; error?: string }>;
  syncWebhook(webhookUrl: string): Promise<{ ok: boolean; error?: string }>;
  getQr(): Promise<{ ok: boolean; mimeType?: string; base64?: string; error?: string }>;
  getMe(): Promise<{ ok: boolean; phone?: string; error?: string }>;
  preparePairing(webhookUrl: string): Promise<{ ok: boolean; status: string; error?: string }>;
  requestPairingCode(phoneDigits: string): Promise<{ ok: boolean; code?: string; expires_at?: string; status?: string; error_code?: string }>;
}

const webhookEvents = ["message", "message.any", "message.ack", "session.status"] as const;

/** Append an opaque token to the webhook URL. Some WAHA versions/engines do
 *  not propagate customHeaders reliably; the receiver accepts either the
 *  header or the query token. Both compare to the same secret. */
function webhookUrlWithToken(base: string): string {
  if (!WAHA_WEBHOOK_SECRET) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}t=${encodeURIComponent(WAHA_WEBHOOK_SECRET)}`;
}

function buildSessionConfig(webhookUrl: string) {
  return {
    name: WAHA_SESSION,
    config: {
      metadata: {
        app: "meunino",
        project: "meunino",
        environment: Deno.env.get("APP_ENV") ?? "production",
      },
      webhooks: [
        {
          url: webhookUrlWithToken(webhookUrl),
          events: [...webhookEvents],
          hmac: null,
          retries: { policy: "linear", delaySeconds: 2, attempts: 3 },
          customHeaders: [{ name: "X-Webhook-Secret", value: WAHA_WEBHOOK_SECRET }],
        },
      ],
    },
  };
}

export const wahaProvider: MessagingProvider & WahaExtras = {
  name: "waha",
  get configured() {
    return Boolean(WAHA_API_URL && WAHA_API_KEY && WAHA_SESSION && WAHA_WEBHOOK_SECRET);
  },
  normalizeAddress(raw: string) {
    return normalizeBrPhone(raw);
  },
  async sendText(to, body) {
    if (!this.configured) throw new Error("waha_not_configured");
    const res = await safeFetch(`${WAHA_API_URL}/api/sendText`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: to.replace(/^\+/, "") + "@c.us",
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`waha_send_failed_${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { provider_message_id: data.id ?? crypto.randomUUID() };
  },
  async getHealth() {
    if (!this.configured) return { ok: false, latency_ms: 0, error: "not_configured" };
    const t0 = performance.now();
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() });
      return { ok: r.ok, latency_ms: Math.round(performance.now() - t0), error: r.ok ? undefined : `status_${r.status}` };
    } catch {
      return { ok: false, latency_ms: Math.round(performance.now() - t0), error: "unreachable" };
    }
  },
  async getSessionStatus() {
    if (!this.configured) return { status: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() });
      if (r.status === 404) return { status: "STOPPED" };
      if (!r.ok) return { status: "UNKNOWN", error: `status_${r.status}` };
      const d = (await r.json()) as { status?: string };
      return { status: (d.status ?? "UNKNOWN").toUpperCase() };
    } catch {
      return { status: "UNREACHABLE" };
    }
  },
  verifyWebhookSecret(h) {
    if (!WAHA_WEBHOOK_SECRET) return false;
    // Header path (preferred when supported by the WAHA version/engine).
    const provided = h.get("x-webhook-secret") ?? h.get("X-Webhook-Secret") ?? "";
    if (provided && provided.length === WAHA_WEBHOOK_SECRET.length) {
      let mismatch = 0;
      for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ WAHA_WEBHOOK_SECRET.charCodeAt(i);
      if (mismatch === 0) return true;
    }
    // Query-token path (?t=<secret>) — the source-of-truth is the same secret.
    // The webhook route reads the URL and passes the token through the header
    // `x-webhook-token` (see whatsapp-webhook), keeping this method pure.
    const tok = h.get("x-webhook-token") ?? "";
    if (tok && tok.length === WAHA_WEBHOOK_SECRET.length) {
      let mismatch = 0;
      for (let i = 0; i < tok.length; i++) mismatch |= tok.charCodeAt(i) ^ WAHA_WEBHOOK_SECRET.charCodeAt(i);
      if (mismatch === 0) return true;
    }
    return false;
  },
  mapInboundEvent(payload: unknown): NormalizedInbound | null {
    const c = classifyInbound(payload, WAHA_SESSION);
    if (!c.ok) return null;
    return {
      provider: "waha",
      provider_message_id: c.provider_message_id,
      from_phone: c.from_phone,
      to_phone: c.to_phone,
      body: c.body,
      from_bot: false,
      received_at: c.received_at,
      media: c.media,
    };
  },
  // --- WahaExtras (portal admin) ---
  async createOrUpdateSession(webhookUrl) {
    if (!this.configured) return { ok: false, error: "not_configured" };
    // Try PUT (update); if 404, POST (create).
    const body = JSON.stringify(buildSessionConfig(webhookUrl));
    try {
      const put = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, {
        method: "PUT", headers: headers(), body,
      });
      if (put.ok) return { ok: true };
      if (put.status === 404) {
        const post = await safeFetch(`${WAHA_API_URL}/api/sessions`, {
          method: "POST", headers: headers(), body,
        });
        if (post.ok) return { ok: true };
        return { ok: false, error: `create_status_${post.status}` };
      }
      return { ok: false, error: `update_status_${put.status}` };
    } catch {
      return { ok: false, error: "unreachable" };
    }
  },
  async syncWebhook(webhookUrl) {
    return this.createOrUpdateSession(webhookUrl);
  },
  async startSession() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}/start`, { method: "POST", headers: headers() });
      return r.ok ? { ok: true } : { ok: false, error: `status_${r.status}` };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async stopSession() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}/stop`, { method: "POST", headers: headers() });
      return r.ok ? { ok: true } : { ok: false, error: `status_${r.status}` };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async logoutSession() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}/logout`, { method: "POST", headers: headers() });
      return r.ok ? { ok: true } : { ok: false, error: `status_${r.status}` };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async restartSession() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}/restart`, { method: "POST", headers: headers() });
      return r.ok ? { ok: true } : { ok: false, error: `status_${r.status}` };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async getQr() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/${WAHA_SESSION}/auth/qr?format=image`, { headers: headers() });
      if (!r.ok) return { ok: false, error: `status_${r.status}` };
      const ct = (r.headers.get("content-type") ?? "image/png").toLowerCase();
      // Binary path: any image/* content-type is treated as raw PNG/JPEG bytes.
      if (ct.startsWith("image/")) {
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        return { ok: true, mimeType: ct, base64: btoa(bin) };
      }
      // JSON path (legacy): { mimetype, data }.
      if (ct.startsWith("application/json")) {
        const d = (await r.json()) as { mimetype?: string; data?: string };
        return { ok: true, mimeType: d.mimetype ?? "image/png", base64: d.data };
      }
      // Unknown content-type: fall back to binary decoding without JSON parse.
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { ok: true, mimeType: "image/png", base64: btoa(bin) };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async getMe() {
    if (!this.configured) return { ok: false, error: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}/me`, { headers: headers() });
      if (!r.ok) return { ok: false, error: `status_${r.status}` };
      const d = (await r.json().catch(() => ({}))) as { id?: string; pushName?: string };
      const phoneRaw = (d.id ?? "").replace(/@c\.us$/, "");
      const phone = normalizeBrPhone(phoneRaw) ?? undefined;
      return { ok: true, phone };
    } catch { return { ok: false, error: "unreachable" }; }
  },
  async preparePairing(webhookUrl: string) {
    if (!this.configured) return { ok: false, status: "not_configured", error: "not_configured" };
    // Read current status
    const read = async (): Promise<string> => {
      try {
        const r = await safeFetch(`${WAHA_API_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() });
        if (r.status === 404) return "MISSING";
        if (!r.ok) return "UNKNOWN";
        const d = (await r.json()) as { status?: string };
        return (d.status ?? "UNKNOWN").toUpperCase();
      } catch { return "UNREACHABLE"; }
    };
    const waitFor = async (accept: (s: string) => boolean, timeoutMs: number): Promise<string> => {
      const start = Date.now();
      let s = await read();
      while (!accept(s) && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 800));
        s = await read();
      }
      return s;
    };
    try {
      let s = await read();
      if (s === "MISSING") {
        const r = await this.createOrUpdateSession(webhookUrl);
        if (!r.ok) return { ok: false, status: "error", error: r.error };
        await this.startSession();
        s = await waitFor((x) => x === "SCAN_QR_CODE" || x === "WORKING" || x === "STARTING", 8_000);
      } else if (s === "FAILED") {
        // Try restart first
        await this.restartSession();
        s = await waitFor((x) => x === "SCAN_QR_CODE" || x === "WORKING" || x === "STARTING", 6_000);
        if (s === "FAILED" || s === "STOPPED" || s === "UNKNOWN") {
          await this.logoutSession();
          await this.createOrUpdateSession(webhookUrl); // re-apply webhook+metadata
          await this.startSession();
          s = await waitFor((x) => x === "SCAN_QR_CODE" || x === "WORKING" || x === "STARTING", 8_000);
        }
      } else if (s === "STOPPED") {
        await this.startSession();
        s = await waitFor((x) => x === "SCAN_QR_CODE" || x === "WORKING" || x === "STARTING", 8_000);
      } else if (s === "STARTING") {
        s = await waitFor((x) => x === "SCAN_QR_CODE" || x === "WORKING", 6_000);
      }
      return { ok: true, status: s };
    } catch {
      return { ok: false, status: "error", error: "unreachable" };
    }
  },
  async requestPairingCode(phoneDigits: string) {
    if (!this.configured) return { ok: false, error_code: "not_configured" };
    try {
      const r = await safeFetch(`${WAHA_API_URL}/api/${WAHA_SESSION}/auth/request-code`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ phoneNumber: phoneDigits }),
      });
      const bodyText = await r.text().catch(() => "");
      if (r.status === 401 || r.status === 403) return { ok: false, error_code: "unauthorized" };
      if (r.status === 404 || r.status === 405) return { ok: false, error_code: "method_unsupported" };
      if (r.status === 422 || r.status === 400) {
        const bt = bodyText.toUpperCase();
        if (bt.includes("PASSKEY_CONFIRMATION")) return { ok: false, error_code: "passkey_confirmation_required" };
        if (bt.includes("PASSKEY")) return { ok: false, error_code: "passkey_required" };
        if (bt.includes("NOT_SUPPORTED") || bt.includes("UNSUPPORTED") || bt.includes("ENGINE")) return { ok: false, error_code: "method_unsupported" };
        return { ok: false, error_code: "invalid_request" };
      }
      if (!r.ok) return { ok: false, error_code: "provider_error" };
      let parsed: { code?: string; pairingCode?: string; expiresAt?: string; status?: string } = {};
      try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch { /* ignore */ }
      const code = (parsed.code ?? parsed.pairingCode ?? "").toString();
      if (!code) return { ok: false, error_code: "method_unsupported" };
      return { ok: true, code, expires_at: parsed.expiresAt, status: parsed.status };
    } catch {
      return { ok: false, error_code: "unreachable" };
    }
  },
};

export function getProvider(): MessagingProvider & WahaExtras {
  return wahaProvider;
}
