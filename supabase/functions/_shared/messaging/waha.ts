import type { MessagingProvider, NormalizedInbound } from "./types.ts";
import { normalizeBrPhone } from "./types.ts";

// Accept WAHA_API_URL (Sniper naming) with legacy fallback WAHA_BASE_URL.
const WAHA_API_URL =
  Deno.env.get("WAHA_API_URL") ?? Deno.env.get("WAHA_BASE_URL") ?? "";
const WAHA_API_KEY = Deno.env.get("WAHA_API_KEY") ?? "";
const WAHA_SESSION = Deno.env.get("NOCONTROLE_WAHA_SESSION") ?? Deno.env.get("WAHA_SESSION") ?? "default";
const WAHA_WEBHOOK_SECRET = Deno.env.get("WAHA_WEBHOOK_SECRET") ?? "";

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
}

const webhookEvents = ["message", "message.any", "message.ack", "session.status"] as const;

function buildSessionConfig(webhookUrl: string) {
  return {
    name: WAHA_SESSION,
    config: {
      webhooks: [
        {
          url: webhookUrl,
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
    const provided = h.get("x-webhook-secret") ?? h.get("X-Webhook-Secret") ?? "";
    if (!provided) return false;
    if (provided.length !== WAHA_WEBHOOK_SECRET.length) return false;
    let mismatch = 0;
    for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ WAHA_WEBHOOK_SECRET.charCodeAt(i);
    return mismatch === 0;
  },
  mapInboundEvent(payload: unknown): NormalizedInbound | null {
    const p = payload as {
      event?: string;
      payload?: { id?: string; from?: string; to?: string; body?: string; fromMe?: boolean; timestamp?: number };
    };
    if (!p?.payload?.from || p.payload.fromMe) return null;
    const from = normalizeBrPhone(p.payload.from.replace(/@c\.us$/, ""));
    if (!from) return null;
    return {
      provider: "waha",
      provider_message_id: p.payload.id ?? crypto.randomUUID(),
      from_phone: from,
      to_phone: p.payload.to ?? undefined,
      body: (p.payload.body ?? "").trim(),
      from_bot: Boolean(p.payload.fromMe),
      received_at: new Date((p.payload.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
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
      const ct = r.headers.get("content-type") ?? "image/png";
      if (ct.startsWith("application/json")) {
        const d = (await r.json()) as { mimetype?: string; data?: string };
        return { ok: true, mimeType: d.mimetype ?? "image/png", base64: d.data };
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      // Never log QR contents.
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { ok: true, mimeType: ct, base64: btoa(bin) };
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
};

export function getProvider(): MessagingProvider & WahaExtras {
  return wahaProvider;
}
