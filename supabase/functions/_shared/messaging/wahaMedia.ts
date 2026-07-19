// Downloader seguro de mídia inbound do WAHA. Não registra URLs nem bytes.
// Ordem: base64 inline -> mediaUrl HTTPS -> endpoint WAHA configurado -> fallbacks.

import { assertPublicHttpsUrl } from "../security/ssrf.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
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

async function fetchWithLimits(url: string, headers: Record<string, string>): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: DownloadCode; detail?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, redirect: "error", signal: ac.signal });
    if (!r.ok) return { ok: false, code: "download_failed", detail: `status_${r.status}` };
    const declaredLength = Number(r.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(declaredLength) };
    const responseType = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (responseType && !ALLOWED_MIME.has(responseType) && responseType !== "application/octet-stream")
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

async function fetchWahaMedia(apiUrl: string, apiKey: string, session: string, messageId: string, media?: MediaHint) {
  const guard = assertPublicHttpsUrl(`${apiUrl.replace(/\/$/, "")}/api/`);
  if (!guard.ok) return { ok: false as const, code: "unsafe_url" as DownloadCode, detail: guard.code };
  let last = { ok: false as const, code: "download_failed" as DownloadCode, detail: "all_candidates_failed" };
  for (const url of endpointCandidates(apiUrl, session, messageId, media)) {
    for (const headers of authHeaderCandidates(apiKey)) {
      const result = await fetchWithLimits(url, headers);
      if (result.ok) return result;
      last = result;
      if (["size_exceeds", "unsafe_url", "timeout", "mime_not_allowed"].includes(result.code)) return result;
    }
  }
  return last;
}

export async function downloadInboundMedia(opts: { media: MediaHint | undefined; apiUrl?: string; apiKey?: string; session?: string; messageId?: string }): Promise<DownloadResult> {
  const declaredMime = (opts.media?.mime_type ?? opts.media?.mimeType ?? opts.media?.mimetype ?? "").toLowerCase();
  const filename = (opts.media?.filename ?? `wa-${Date.now()}`).slice(0, 120);
  const inline = opts.media?.base64 ?? opts.media?.data ?? (opts.media?.body?.startsWith("data:") ? opts.media.body : undefined);
  const directUrl = opts.media?.url ?? opts.media?.mediaUrl;
  const messageId = opts.messageId || serializedId(opts.media?.id);

  if (inline) {
    const bytes = base64ToBytes(inline);
    if (!bytes) return { ok: false, code: "download_failed", detail: "b64_decode" };
    return finalize(bytes, declaredMime, filename);
  }
  if (directUrl) {
    const guard = assertPublicHttpsUrl(directUrl);
    if (!guard.ok) return { ok: false, code: "unsafe_url", detail: guard.code };
    const result = await fetchWithLimits(directUrl, {});
    if (result.ok) return finalize(result.bytes, declaredMime, filename);
    if (result.code !== "download_failed") return result;
  }
  if (opts.apiUrl && opts.apiKey && opts.session && messageId) {
    const result = await fetchWahaMedia(opts.apiUrl, opts.apiKey, opts.session, messageId, opts.media);
    if (result.ok) return finalize(result.bytes, declaredMime, filename);
    return result;
  }
  return { ok: false, code: "no_url" };
}

function finalize(bytes: Uint8Array, declaredMime: string, filename: string): DownloadResult {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  if (bytes.length > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(bytes.length) };
  const magic = detectMime(bytes);
  if (!magic) return { ok: false, code: "magic_mismatch" };
  if (!ALLOWED_MIME.has(magic)) return { ok: false, code: "mime_not_allowed", detail: magic };
  void declaredMime; // magic bytes são a fonte de verdade.
  const ext = magic === "application/pdf" ? "pdf" : magic.split("/")[1];
  return { ok: true, bytes, mime_type: magic, filename: /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}.${ext}` };
}
