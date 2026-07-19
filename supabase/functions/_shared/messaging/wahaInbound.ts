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

export type MediaHint = {
  url?: string;
  mediaUrl?: string;
  base64?: string;
  data?: string;
  body?: string;
  mime_type: string;
  mimetype?: string;
  mimeType?: string;
  filename?: string;
  directPath?: string;
  chatId?: string;
  id?: string | { serialized?: string; _serialized?: string };
  messageTimestamp?: number | string;
  /** Where the parser found the media descriptor. Purely diagnostic. */
  via: "root_media" | "message_image" | "message_document" | "message_video" | "data_message";
};

export type ClassifiedInbound =
  | {
      ok: true;
      provider_message_id: string;
      from_phone: string;
      to_phone?: string;
      body: string;
      received_at: string;
      media?: MediaHint;
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

function collectJidDomains(pl: unknown): string[] {
  const out = new Set<string>();
  const keys = ["from", "to", "participant", "remoteJidAlt", "participantAlt"];
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
    get(pl, "remoteJidAlt"),
    get(pl, "participantAlt"),
    get(_dkey, "remoteJidAlt"),
    get(_dkey, "participantAlt"),
    get(_data, "remoteJidAlt"),
    get(key, "remoteJidAlt"),
    get(key, "participantAlt"),
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

/** Detect media across the multiple shapes a NOWEB payload can take.
 *  Returns undefined only when no media descriptor is present at all.
 *  Note: `url` and `base64` are optional — many NOWEB payloads carry a
 *  media descriptor without a public URL, and the downloader must then
 *  fetch it authenticated via `/api/{session}/files/{msgId}`. */
function resolveMedia(pl: unknown): MediaHint | undefined {
  const asStr = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;

  // 1) Root `media` object (WAHA WEBJS-like)
  const rootMedia = get(pl, "media");
  if (rootMedia && typeof rootMedia === "object") {
    const url = asStr(get(rootMedia, "url"));
    const mediaUrl = asStr(get(rootMedia, "mediaUrl")) ?? asStr(get(rootMedia, "media_url"));
    const b64 = asStr(get(rootMedia, "data")) ?? asStr(get(rootMedia, "base64"));
    const mime = asStr(get(rootMedia, "mimetype")) ?? asStr(get(rootMedia, "mime_type"))
      ?? asStr(get(pl, "mimetype")) ?? "application/octet-stream";
    const filename = asStr(get(rootMedia, "filename")) ?? asStr(get(rootMedia, "name"));
    if (url || mediaUrl || b64 || mime !== "application/octet-stream") {
      return {
        url, mediaUrl, base64: b64, data: b64, mime_type: mime, mimetype: mime,
        filename, directPath: asStr(get(rootMedia, "directPath")),
        chatId: asStr(get(pl, "from")), id: get(pl, "id") as MediaHint["id"],
        messageTimestamp: get(pl, "timestamp") as number | string | undefined,
        via: "root_media",
      };
    }
  }

  // 2) message.{imageMessage|documentMessage|videoMessage} (NOWEB shape)
  const messages = [
    get(pl, "message"),
    get(get(pl, "_data"), "message"),
  ];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const doc = get(m, "documentMessage");
    if (doc && typeof doc === "object") {
      return {
        url: asStr(get(doc, "url")),
        mediaUrl: asStr(get(doc, "mediaUrl")),
        directPath: asStr(get(doc, "directPath")),
        mime_type: asStr(get(doc, "mimetype")) ?? "application/pdf",
        filename: asStr(get(doc, "fileName")) ?? asStr(get(doc, "filename")),
        chatId: asStr(get(pl, "from")), id: get(pl, "id") as MediaHint["id"], messageTimestamp: get(pl, "timestamp") as number | string | undefined,
        via: m === messages[1] ? "data_message" : "message_document",
      };
    }
    const img = get(m, "imageMessage");
    if (img && typeof img === "object") {
      return {
        url: asStr(get(img, "url")),
        mediaUrl: asStr(get(img, "mediaUrl")),
        directPath: asStr(get(img, "directPath")),
        base64: asStr(get(img, "base64")) ?? asStr(get(img, "data")),
        mime_type: asStr(get(img, "mimetype")) ?? "image/jpeg",
        filename: asStr(get(img, "fileName")) ?? asStr(get(img, "filename")),
        chatId: asStr(get(pl, "from")), id: get(pl, "id") as MediaHint["id"], messageTimestamp: get(pl, "timestamp") as number | string | undefined,
        via: m === messages[1] ? "data_message" : "message_image",
      };
    }
    const vid = get(m, "videoMessage");
    if (vid && typeof vid === "object") {
      // Videos are not supported by the ingestion pipeline, but expose the
      // descriptor so the webhook can respond with a friendly rejection.
      return {
        url: asStr(get(vid, "url")),
        mime_type: asStr(get(vid, "mimetype")) ?? "video/mp4",
        filename: asStr(get(vid, "fileName")),
        via: m === messages[1] ? "data_message" : "message_video",
      };
    }
  }

  return undefined;
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
  ].some((_) => collectPhoneCandidates(pl).slice(0, 7).some((v) => typeof v === "string" && v));
  const has_key = Boolean(get(pl, "key") || get(get(pl, "_data"), "key"));

  const drop = (reason: DropReason): ClassifiedInbound => ({
    ok: false, reason, event, session, jid_domains, has_alt, has_key,
  });

  if (session && expectedSession && session !== expectedSession) return drop("foreign_session");

  if (event && !["message", "message.any"].includes(event)) {
    const ev = event.toLowerCase();
    if (ev.startsWith("session.") || ev.startsWith("state.") ||
        ev.startsWith("presence.") || ev.startsWith("group.") ||
        ev === "message.ack" || ev === "message.reaction" ||
        ev === "message.revoked" || ev === "message.edited") {
      return drop("event_ignored");
    }
    if (!ev.startsWith("message")) return drop("event_ignored");
  }

  if (!pl || typeof pl !== "object") return drop("no_payload");
  if (resolveFromMe(pl)) return drop("from_me");

  const allJidStrings: unknown[] = [
    get(pl, "from"), get(pl, "to"), get(pl, "participant"),
    get(get(pl, "key"), "remoteJid"), get(get(pl, "key"), "participant"),
    get(get(get(pl, "_data"), "key"), "remoteJid"),
  ];
  for (const raw of allJidStrings) {
    const j = parseJid(raw);
    if (j && GROUP_DOMAINS.has(j.domain)) return drop("group");
  }

  const candidates = collectPhoneCandidates(pl);
  let realDigits: string | null = null;
  for (const raw of candidates) {
    const j = parseJid(raw);
    if (!j) continue;
    if (GROUP_DOMAINS.has(j.domain)) return drop("group");
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

  const media = resolveMedia(pl);

  return {
    ok: true,
    provider_message_id: msgId,
    from_phone: realDigits,
    to_phone,
    body,
    received_at,
    media,
  };
}
