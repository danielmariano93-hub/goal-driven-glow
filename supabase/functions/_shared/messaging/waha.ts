import type { MessagingProvider, NormalizedInbound } from "./types.ts";
import { normalizeBrPhone } from "./types.ts";

const WAHA_BASE_URL = Deno.env.get("WAHA_BASE_URL") ?? "";
const WAHA_API_KEY = Deno.env.get("WAHA_API_KEY") ?? "";
const WAHA_SESSION = Deno.env.get("WAHA_SESSION") ?? "default";
const WAHA_WEBHOOK_SECRET = Deno.env.get("WAHA_WEBHOOK_SECRET") ?? "";

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
}

export const wahaProvider: MessagingProvider = {
  name: "waha",
  get configured() {
    return Boolean(WAHA_BASE_URL && WAHA_API_KEY && WAHA_SESSION && WAHA_WEBHOOK_SECRET);
  },
  normalizeAddress(raw: string) {
    return normalizeBrPhone(raw);
  },
  async sendText(to, body) {
    if (!this.configured) throw new Error("waha_not_configured");
    const res = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
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
      const r = await fetch(`${WAHA_BASE_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() });
      return { ok: r.ok, latency_ms: Math.round(performance.now() - t0), error: r.ok ? undefined : `status_${r.status}` };
    } catch (e) {
      return { ok: false, latency_ms: Math.round(performance.now() - t0), error: "unreachable" };
    }
  },
  async getSessionStatus() {
    if (!this.configured) return { status: "not_configured" };
    try {
      const r = await fetch(`${WAHA_BASE_URL}/api/sessions/${WAHA_SESSION}`, { headers: headers() });
      if (!r.ok) return { status: "unknown", error: `status_${r.status}` };
      const d = (await r.json()) as { status?: string };
      return { status: d.status ?? "unknown" };
    } catch {
      return { status: "unreachable" };
    }
  },
  verifyWebhookSecret(h) {
    if (!WAHA_WEBHOOK_SECRET) return false;
    const provided = h.get("x-webhook-secret") ?? h.get("X-Webhook-Secret") ?? "";
    if (!provided) return false;
    // constant-time-ish comparison
    if (provided.length !== WAHA_WEBHOOK_SECRET.length) return false;
    let mismatch = 0;
    for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ WAHA_WEBHOOK_SECRET.charCodeAt(i);
    return mismatch === 0;
  },
  mapInboundEvent(payload: unknown): NormalizedInbound | null {
    // WAHA "message" webhook shape (subset). Reference only — never trust blindly.
    const p = payload as {
      event?: string;
      payload?: {
        id?: string;
        from?: string;
        to?: string;
        body?: string;
        fromMe?: boolean;
        timestamp?: number;
      };
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
};

export function getProvider(): MessagingProvider {
  return wahaProvider;
}
