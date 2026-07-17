// Pure classifier for WAHA inbound events. No Deno APIs — safely importable
// from vitest tests as well as Deno edge functions.
//
// Handles NOWEB 2026.x semantics where identifiers may be opaque `@lid`
// values and the real phone number is only available in `*Alt` fields. We
// never treat `@lid`, `@g.us`, `@broadcast`, or `@newsletter` as a phone.

import { normalizeBrPhone } from "./types.ts";

export type DropReason =
  | "no_payload"
  | "foreign_session"
  | "event_ignored"
  | "from_me"
  | "group"
  | "no_real_jid"
  | "no_message_id";

export type ClassifiedInbound =
  | {
      ok: true;
      provider_message_id: string;
      from_phone: string;
      to_phone?: string;
      body: string;
      received_at: string;
      media?: { url: string; mime_type: string; filename?: string };
    }
  | {
      ok: false;
      reason: DropReason;
      event: string | null;
      session: string | null;
      jid_domains: string[];
      has_alt: boolean;
      has_key: boolean;
    };

const REAL_PHONE_DOMAINS = new Set(["c.us", "s.whatsapp.net"]);
const GROUP_DOMAINS = new Set(["g.us", "broadcast", "newsletter"]);

export function parseJid(raw: unknown): { local: string; domain: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  const at = raw.lastIndexOf("@");
  if (at < 0) return { local: raw, domain: "" };
  return { local: raw.slice(0, at), domain: raw.slice(at + 1).toLowerCase() };
}

function firstDefined<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v as T;
  return undefined;
}

function sanitizeTimestamp(ts: unknown): string {
  const nowMs = Date.now();
  let n = typeof ts === "number" ? ts : NaN;
  if (Number.isFinite(n)) {
    // Accept seconds (typical) or milliseconds.
    if (n < 1e12) n = n * 1000;
    if (n < nowMs - 30 * 86400 * 1000 || n > nowMs + 86400 * 1000) n = nowMs;
    return new Date(n).toISOString();
  }
  return new Date(nowMs).toISOString();
}

type P = Record<string, unknown>;

function get(o: unknown, key: string): unknown {
  return o && typeof o === "object" ? (o as P)[key] : undefined;
}

/** Collect every JID-shaped string candidate we saw on the payload — used
 *  ONLY to report the domain suffixes in drop diagnostics. Never returns the
 *  local part / phone digits. */
function collectJidDomains(pl: unknown): string[] {
  const out = new Set<string>();
  const keys = [
    "from", "to", "participant", "remoteJidAlt", "participantAlt",
  ];
  for (const k of keys) {
    const j = parseJid(get(pl, k));
    if (j?.domain) out.add(j.domain);
  }
  const key = get(pl, "key");
  for (const k of ["remoteJid", "participant", "remoteJidAlt", "participantAlt"]) {
    const j = parseJid(get(key, k));
    if (j?.domain) out.add(j.domain);
  }
  const _data = get(pl, "_data");
  const _dkey = get(_data, "key");
  for (const k of ["remoteJid", "participant", "remoteJidAlt", "participantAlt"]) {
    const j = parseJid(get(_dkey, k));
    if (j?.domain) out.add(j.domain);
  }
  return [...out];
}

function collectPhoneCandidates(pl: unknown): unknown[] {
  const key = get(pl, "key");
  const _data = get(pl, "_data");
  const _dkey = get(_data, "key");
  return [
    // Alt fields — NOWEB puts the real phone JID here when the primary is @lid.
    get(pl, "remoteJidAlt"),
    get(pl, "participantAlt"),
    get(_dkey, "remoteJidAlt"),
    get(_dkey, "participantAlt"),
    get(_data, "remoteJidAlt"),
    get(key, "remoteJidAlt"),
    get(key, "participantAlt"),
    // Primary fields — only accepted if suffix is a real phone domain.
    get(pl, "from"),
    get(key, "remoteJid"),
    get(pl, "participant"),
    get(_dkey, "remoteJid"),
  ];
}

function resolveMessageId(pl: unknown): string | undefined {
  const id = get(pl, "id");
  if (typeof id === "string" && id) return id;
  if (id && typeof id === "object") {
    const ser = get(id, "_serialized");
    if (typeof ser === "string" && ser) return ser;
    const inner = get(id, "id");
    if (typeof inner === "string" && inner) return inner;
  }
  const kId = get(get(pl, "key"), "id");
  if (typeof kId === "string" && kId) return kId;
  const dataId = get(get(pl, "_data"), "id");
  if (typeof dataId === "object" && dataId) {
    const s = get(dataId, "_serialized");
    if (typeof s === "string" && s) return s;
  }
  const dkId = get(get(get(pl, "_data"), "key"), "id");
  if (typeof dkId === "string" && dkId) return dkId;
  return undefined;
}

function resolveBody(pl: unknown): string {
  const direct = get(pl, "body");
  if (typeof direct === "string" && direct) return direct.trim();
  const msg = get(pl, "message");
  const chain = [
    get(msg, "conversation"),
    get(get(msg, "extendedTextMessage"), "text"),
    get(get(msg, "imageMessage"), "caption"),
    get(get(msg, "videoMessage"), "caption"),
    get(get(msg, "documentMessage"), "caption"),
  ];
  const _dmsg = get(get(pl, "_data"), "message");
  chain.push(
    get(_dmsg, "conversation"),
    get(get(_dmsg, "extendedTextMessage"), "text"),
    get(get(_dmsg, "imageMessage"), "caption"),
    get(get(_dmsg, "videoMessage"), "caption"),
    get(get(_dmsg, "documentMessage"), "caption"),
  );
  const v = firstDefined<string>(...(chain as (string | undefined)[]));
  return typeof v === "string" ? v.trim() : "";
}

function resolveFromMe(pl: unknown): boolean {
  return Boolean(
    get(pl, "fromMe") ||
      get(get(pl, "key"), "fromMe") ||
      get(get(get(pl, "_data"), "key"), "fromMe"),
  );
}

export function classifyInbound(
  payload: unknown,
  expectedSession: string,
): ClassifiedInbound {
  const p = (payload && typeof payload === "object" ? payload : {}) as P;
  const event = typeof p.event === "string" ? (p.event as string) : null;
  const session = typeof p.session === "string" ? (p.session as string) : null;

  const pl = p.payload;
  const jid_domains = collectJidDomains(pl);
  const has_alt = jid_domains.length > 0 && [
    "remoteJidAlt", "participantAlt",
  ].some((_) => {
    // reuse candidate collection presence check
    return collectPhoneCandidates(pl).slice(0, 7).some((v) => typeof v === "string" && v);
  });
  const has_key = Boolean(get(pl, "key") || get(get(pl, "_data"), "key"));

  const drop = (reason: DropReason): ClassifiedInbound => ({
    ok: false, reason, event, session, jid_domains, has_alt, has_key,
  });

  if (session && expectedSession && session !== expectedSession) return drop("foreign_session");

  // Accept unnamed events (legacy), and message/message.any.
  if (event && !["message", "message.any"].includes(event)) {
    const ev = event.toLowerCase();
    if (ev.startsWith("session.") || ev.startsWith("state.") ||
        ev.startsWith("presence.") || ev.startsWith("group.") ||
        ev === "message.ack" || ev === "message.reaction" ||
        ev === "message.revoked" || ev === "message.edited") {
      return drop("event_ignored");
    }
    // Unknown non-message event
    if (!ev.startsWith("message")) return drop("event_ignored");
  }

  if (!pl || typeof pl !== "object") return drop("no_payload");
  if (resolveFromMe(pl)) return drop("from_me");

  // Group detection across all candidate JIDs.
  const allJidStrings: unknown[] = [
    get(pl, "from"), get(pl, "to"), get(pl, "participant"),
    get(get(pl, "key"), "remoteJid"), get(get(pl, "key"), "participant"),
    get(get(get(pl, "_data"), "key"), "remoteJid"),
  ];
  for (const raw of allJidStrings) {
    const j = parseJid(raw);
    if (j && GROUP_DOMAINS.has(j.domain)) return drop("group");
  }

  // Resolve real phone.
  const candidates = collectPhoneCandidates(pl);
  let realDigits: string | null = null;
  for (const raw of candidates) {
    const j = parseJid(raw);
    if (!j) continue;
    if (GROUP_DOMAINS.has(j.domain)) return drop("group");
    // Empty domain (bare digits) is accepted only if not a lid marker.
    if (!j.domain || REAL_PHONE_DOMAINS.has(j.domain)) {
      const normalized = normalizeBrPhone(j.local);
      if (normalized) { realDigits = normalized; break; }
    }
  }
  if (!realDigits) return drop("no_real_jid");

  const msgId = resolveMessageId(pl);
  if (!msgId) return drop("no_message_id");

  const body = resolveBody(pl);
  const received_at = sanitizeTimestamp(get(pl, "timestamp") ?? get(pl, "messageTimestamp"));

  const toJid = get(pl, "to");
  const to_phone = typeof toJid === "string"
    ? (parseJid(toJid)?.local ?? undefined)
    : undefined;

  const media = get(pl, "media");
  const mediaUrl = get(media, "url");
  const outMedia = typeof mediaUrl === "string" && mediaUrl ? {
    url: mediaUrl,
    mime_type: (typeof get(media, "mimetype") === "string"
      ? get(media, "mimetype") as string
      : (typeof get(pl, "mimetype") === "string" ? get(pl, "mimetype") as string : "application/octet-stream")),
    filename: typeof get(media, "filename") === "string" ? get(media, "filename") as string : undefined,
  } : undefined;

  return {
    ok: true,
    provider_message_id: msgId,
    from_phone: realDigits,
    to_phone,
    body,
    received_at,
    media: outMedia,
  };
}
