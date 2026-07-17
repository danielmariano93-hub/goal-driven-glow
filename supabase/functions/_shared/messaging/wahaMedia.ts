// WAHA inbound media downloader. Isolated from the main provider so tests can
// import without pulling the full waha.ts surface. Never logs URLs or bytes.

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 20 * 1024 * 1024;

export type MediaHint = { url: string; mime_type?: string; filename?: string };

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return null;
}

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; mime_type: string; filename: string }
  | { ok: false; code: "mime_not_allowed" | "size_exceeds" | "download_failed" | "empty" | "magic_mismatch" | "no_url"; detail?: string };

/** Download inbound media from either a direct URL (preferred, WAHA sets
 *  `media.url` on NOWEB) or a WAHA-hosted `/api/{session}/files/{msgId}` path.
 *  Applies MIME whitelist, size cap, magic-byte check. No PII in logs. */
export async function downloadInboundMedia(opts: {
  media: MediaHint | undefined;
  apiUrl?: string;
  apiKey?: string;
  session?: string;
  messageId?: string;
}): Promise<DownloadResult> {
  const candidates: { url: string; auth: boolean }[] = [];
  if (opts.media?.url) candidates.push({ url: opts.media.url, auth: false });
  if (opts.apiUrl && opts.session && opts.messageId) {
    candidates.push({ url: `${opts.apiUrl}/api/${opts.session}/files/${encodeURIComponent(opts.messageId)}`, auth: true });
  }
  if (candidates.length === 0) return { ok: false, code: "no_url" };

  const declaredMime = (opts.media?.mime_type ?? "").toLowerCase();
  const filename = (opts.media?.filename ?? `wa-${Date.now()}`).slice(0, 120);

  for (const c of candidates) {
    try {
      const headers: Record<string, string> = {};
      if (c.auth && opts.apiKey) headers["X-Api-Key"] = opts.apiKey;
      const r = await fetch(c.url, { headers });
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length === 0) return { ok: false, code: "empty" };
      if (buf.length > MAX_BYTES) return { ok: false, code: "size_exceeds", detail: String(buf.length) };
      const magic = detectMime(buf);
      if (!magic) return { ok: false, code: "magic_mismatch" };
      if (!ALLOWED_MIME.has(magic)) return { ok: false, code: "mime_not_allowed", detail: magic };
      if (declaredMime && declaredMime !== magic && !declaredMime.startsWith(magic.split("/")[0])) {
        // Declared vs. magic mismatch is not fatal — trust magic.
      }
      const extFromMagic = magic === "application/pdf" ? "pdf" : magic.split("/")[1];
      const finalName = /\.[a-z0-9]{2,4}$/i.test(filename) ? filename : `${filename}.${extFromMagic}`;
      return { ok: true, bytes: buf, mime_type: magic, filename: finalName };
    } catch { /* try next candidate */ }
  }
  return { ok: false, code: "download_failed" };
}
