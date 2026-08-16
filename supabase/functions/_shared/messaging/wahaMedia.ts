// Downloader seguro de mídia inbound do WAHA. Não registra URLs nem bytes.
// Ordem prioritária para imagens: base64 inline -> mediaUrl HTTPS autenticada -> endpoint WAHA -> fallbacks.

import { assertPublicHttpsUrl } from "../security/ssrf.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
/** Áudio inbound (voz do WhatsApp). OGG/Opus é o formato padrão de PTT. */
const ALLOWED_AUDIO_MIME = new Set([
  "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/wav", "audio/x-wav", "audio/webm", "audio/aac", "audio/amr",
]);

export type MediaKind = "document" | "audio";

function allowedFor(kind: MediaKind): Set<string> {
  return kind === "audio" ? ALLOWED_AUDIO_MIME : ALLOWED_MIME;
}
const MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type MediaHint = {
  url?: string;
  base64?: string;
  mime_type?: string;
  filename?: string;
  mediaUrl?: string;
  mimetype?: string;
  mimeType?: string;
  data?: string;
  body?: string;
  directPath?: string;
  mediaKey?: string;
  mediaSize?: number;
  mediaType?: string;
  chatId?: string;
  id?: string | { serialized?: string; _serialized?: string };
  messageTimestamp?: number | string;
};

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return null;
}

/** Assinaturas de contêiner de áudio — usadas só na rota de voz. */
function detectAudioMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.slice(i, i + n));
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (ascii(0, 5) === "#!AMR") return "audio/amr";
  return null;
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const clean = b64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export type DownloadCode = "mime_not_allowed" | "size_exceeds" | "download_failed" | "empty" | "magic_mismatch" | "no_url" | "unsafe_url" | "timeout";
export type DownloadResult =
  | { ok: true; bytes: Uint8Array; mime_type: string; filename: string }
  | { ok: false; code: DownloadCode; detail?: string };

async function fetchWithLimits(url: string, headers: Record<string, string>, kind: MediaKind = "document"): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, redirect: "error", signal: ac.signal });
    if (!r.ok) return { ok: false, code: "download_failed", detail: `status_${r.status}` };
    const declaredLength = Number(r.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(declaredLength) };
    const responseType = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (responseType && !allowedFor(kind).has(responseType.replace(/^audio\/ogg.*$/, "audio/ogg")) && responseType !== "application/octet-stream")
      return { ok: false, code: "mime_not_allowed", detail: responseType.slice(0, 80) };
    const reader = r.body?.getReader();
    if (!reader) return { ok: false, code: "empty" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return { ok: false, code: "size_exceeds", detail: String(size) }; }
      chunks.push(value);
    }
    if (size === 0) return { ok: false, code: "empty" };
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, bytes };
  } catch (e) {
    const err = e as Error;
    return { ok: false, code: err.name === "AbortError" ? "timeout" : "download_failed" };
  } finally { clearTimeout(timer); }
}

function authHeaderCandidates(apiKey: string): Array<Record<string, string>> {
  return [{ "X-Api-Key": apiKey }, { "X-API-Key": apiKey }, { Authorization: `Bearer ${apiKey}` }];
}

function serializedId(value: MediaHint["id"] | string | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.serialized ?? value._serialized ?? "");
}

function renderTemplate(template: string, vars: Record<string, string>): string | null {
  const path = template.replace(/\{(session|id|chatId|timestamp)\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? ""));
  if (!path.startsWith("/") || path.includes("://") || path.includes("..")) return null;
  return path;
}

function endpointCandidates(apiUrl: string, session: string, messageId: string, media?: MediaHint): string[] {
  const base = apiUrl.replace(/\/$/, "");
  const candidates: string[] = [];
  const configured = typeof globalThis.Deno !== "undefined"
    ? globalThis.Deno.env.get("WAHA_MEDIA_ENDPOINT_TEMPLATE")?.trim()
    : undefined;
  if (configured) {
    const path = renderTemplate(configured, { session, id: messageId, chatId: media?.chatId ?? "", timestamp: String(media?.messageTimestamp ?? "") });
    if (path) candidates.push(`${base}${path}`);
  }
  const s = encodeURIComponent(session);
  const id = encodeURIComponent(messageId);
  candidates.push(`${base}/api/${s}/files/${id}`, `${base}/api/${s}/messages/${id}/download`, `${base}/api/files/${s}/${id}`);
  return [...new Set(candidates)];
}

export type FetchResult = { ok: true; bytes: Uint8Array } | { ok: false; code: DownloadCode; detail?: string };

async function fetchWahaMedia(apiUrl: string, apiKey: string, session: string, messageId: string, media?: MediaHint, kind: MediaKind = "document"): Promise<FetchResult> {
  const guard = assertPublicHttpsUrl(`${apiUrl.replace(/\/$/, "")}/api/`);
  if (!guard.ok) return { ok: false, code: "unsafe_url", detail: guard.code };
  let last: FetchResult = { ok: false, code: "download_failed", detail: "all_candidates_failed" };
  for (const url of endpointCandidates(apiUrl, session, messageId, media)) {
    for (const headers of authHeaderCandidates(apiKey)) {
      const result = await fetchWithLimits(url, headers, kind);
      if (result.ok === true) return result;
      const fail = result as Extract<FetchResult, { ok: false }>;
      last = fail;
      if (["size_exceeds", "unsafe_url", "timeout", "mime_not_allowed"].includes(fail.code)) return fail;
    }
  }
  return last;
}

export async function downloadInboundMedia(opts: { media: MediaHint | undefined; apiUrl?: string; apiKey?: string; session?: string; messageId?: string; kind?: MediaKind }): Promise<DownloadResult> {
  const kind: MediaKind = opts.kind ?? "document";
  const declaredMime = (opts.media?.mime_type ?? opts.media?.mimeType ?? opts.media?.mimetype ?? "").toLowerCase();
  const filename = (opts.media?.filename ?? `wa-${Date.now()}`).slice(0, 120);
  const inline = opts.media?.base64 ?? opts.media?.data ?? (opts.media?.body?.startsWith("data:") ? opts.media.body : undefined);
  const directUrl = opts.media?.url ?? opts.media?.mediaUrl;
  const messageId = opts.messageId || serializedId(opts.media?.id);

  if (inline) {
    const bytes = base64ToBytes(inline);
    if (!bytes) return { ok: false, code: "download_failed", detail: "b64_decode" };
    return finalize(bytes, declaredMime, filename, kind);
  }
  if (directUrl) {
    const guard = assertPublicHttpsUrl(directUrl);
    if (!guard.ok) return { ok: false, code: "unsafe_url", detail: guard.code };
    const headerSets: Array<Record<string, string>> = [{}];
    try {
      if (opts.apiUrl && opts.apiKey && new URL(directUrl).origin === new URL(opts.apiUrl).origin) {
        headerSets.unshift(...authHeaderCandidates(opts.apiKey));
      }
    } catch { /* URLs já foram validadas */ }
    let last: Extract<FetchResult, { ok: false }> = { ok: false, code: "download_failed" };
    for (const headers of headerSets) {
      const result = await fetchWithLimits(directUrl, headers, kind);
      if (result.ok === true) return finalize(result.bytes, declaredMime, filename, kind);
      const fail = result as Extract<FetchResult, { ok: false }>;
      last = fail;
      if (fail.code !== "download_failed") return { ok: false, code: fail.code, detail: fail.detail };
    }
    if (last.code !== "download_failed") return { ok: false, code: last.code, detail: last.detail };
  }
  if (opts.apiUrl && opts.apiKey && opts.session && messageId) {
    const result = await fetchWahaMedia(opts.apiUrl, opts.apiKey, opts.session, messageId, opts.media, kind);
    if (result.ok === true) return finalize(result.bytes, declaredMime, filename, kind);
    const fail = result as Extract<FetchResult, { ok: false }>;
    return { ok: false, code: fail.code, detail: fail.detail };
  }
  return { ok: false, code: "no_url" };
}

function finalize(bytes: Uint8Array, declaredMime: string, filename: string, kind: MediaKind = "document"): DownloadResult {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  if (bytes.length > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(bytes.length) };
  const magic = kind === "audio" ? detectAudioMime(bytes) : detectMime(bytes);
  if (!magic) return { ok: false, code: "magic_mismatch" };
  if (!allowedFor(kind).has(magic)) return { ok: false, code: "mime_not_allowed", detail: magic };
  if (kind === "audio") {
    const audioExt = magic === "audio/mpeg" ? "mp3" : magic === "audio/mp4" ? "m4a" : magic.split("/")[1];
    void declaredMime;
    return { ok: true, bytes, mime_type: magic, filename: /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}.${audioExt}` };
  }
  void declaredMime; // magic bytes são a fonte de verdade.
  const ext = magic === "application/pdf" ? "pdf" : magic.split("/")[1];
  return { ok: true, bytes, mime_type: magic, filename: /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}.${ext}` };
}
