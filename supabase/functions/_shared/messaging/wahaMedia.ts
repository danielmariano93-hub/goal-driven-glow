// WAHA inbound media downloader. Isolated from the main provider so tests can
// import without pulling the full waha.ts surface. Never logs URLs or bytes.
//
// Supports three delivery modes:
//   1. Direct https URL (SSRF-guarded, redirect-off, timeout, size cap)
//   2. Inline base64 (typical for small WAHA WEBJS attachments)
//   3. WAHA-hosted authenticated download (`/api/{session}/files/{msgId}`)
//      using the SAME api_url + api_key already primed by loadWahaConfig.

import { assertPublicHttpsUrl } from "../security/ssrf.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type MediaHint = {
  url?: string;
  base64?: string;
  mime_type?: string;
  filename?: string;
};

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
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

async function fetchWithLimits(url: string, headers: Record<string, string>): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: DownloadCode; detail?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, redirect: "error", signal: ac.signal });
    if (!r.ok) return { ok: false, code: "download_failed", detail: `status_${r.status}` };
    const cl = Number(r.headers.get("content-length") ?? 0);
    if (cl > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(cl) };
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length === 0) return { ok: false, code: "empty" };
    if (buf.length > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(buf.length) };
    return { ok: true, bytes: buf };
  } catch (e) {
    const err = e as Error;
    return { ok: false, code: err.name === "AbortError" ? "timeout" : "download_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export type DownloadCode = "mime_not_allowed" | "size_exceeds" | "download_failed" | "empty" | "magic_mismatch" | "no_url" | "unsafe_url" | "timeout";

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; mime_type: string; filename: string }
  | { ok: false; code: DownloadCode; detail?: string };

/** Download inbound media in this order: inline base64 → direct https URL
 *  (SSRF-guarded) → WAHA-hosted authenticated files endpoint. Enforces MIME
 *  whitelist, size cap, magic bytes, timeout, and never returns raw bytes
 *  before validation. Nothing about the URL is logged. */
export async function downloadInboundMedia(opts: {
  media: MediaHint | undefined;
  apiUrl?: string;
  apiKey?: string;
  session?: string;
  messageId?: string;
}): Promise<DownloadResult> {
  const declaredMime = (opts.media?.mime_type ?? "").toLowerCase();
  const filenameHint = (opts.media?.filename ?? `wa-${Date.now()}`).slice(0, 120);

  // Path 1: inline base64
  if (opts.media?.base64) {
    const bytes = base64ToBytes(opts.media.base64);
    if (!bytes) return { ok: false, code: "download_failed", detail: "b64_decode" };
    return finalize(bytes, declaredMime, filenameHint);
  }

  // Path 2: direct URL (SSRF-guarded)
  if (opts.media?.url) {
    const guard = assertPublicHttpsUrl(opts.media.url);
    if (!guard.ok) return { ok: false, code: "unsafe_url", detail: guard.code };
    const res = await fetchWithLimits(opts.media.url, {});
    if (res.ok) return finalize(res.bytes, declaredMime, filenameHint);
    // Do NOT fall through if the failure was a hard safety violation
    if (res.code !== "download_failed") return { ok: false, code: res.code, detail: res.detail };
  }

  // Path 3: WAHA-hosted authenticated URL
  if (opts.apiUrl && opts.apiKey && opts.session && opts.messageId) {
    const baseGuard = assertPublicHttpsUrl(`${opts.apiUrl.replace(/\/$/, "")}/api/`);
    if (!baseGuard.ok) return { ok: false, code: "unsafe_url", detail: baseGuard.code };
    const url = `${opts.apiUrl.replace(/\/$/, "")}/api/${encodeURIComponent(opts.session)}/files/${encodeURIComponent(opts.messageId)}`;
    const res = await fetchWithLimits(url, { "X-Api-Key": opts.apiKey });
    if (res.ok) return finalize(res.bytes, declaredMime, filenameHint);
    return { ok: false, code: res.code, detail: res.detail };
  }

  return { ok: false, code: "no_url" };
}

function finalize(bytes: Uint8Array, declaredMime: string, filename: string): DownloadResult {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  if (bytes.length > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(bytes.length) };
  const magic = detectMime(bytes);
  if (!magic) return { ok: false, code: "magic_mismatch" };
  if (!ALLOWED_MIME.has(magic)) return { ok: false, code: "mime_not_allowed", detail: magic };
  if (declaredMime && declaredMime !== magic && !declaredMime.startsWith(magic.split("/")[0])) {
    // Declared vs. magic mismatch is not fatal — trust magic.
  }
  const extFromMagic = magic === "application/pdf" ? "pdf" : magic.split("/")[1];
  const finalName = /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}.${extFromMagic}`;
  return { ok: true, bytes, mime_type: magic, filename: finalName };
}
