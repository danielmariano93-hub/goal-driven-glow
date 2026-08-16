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
  /** Identificador do arquivo no provedor; não é necessariamente o ID da mensagem. */
  fileId?: string;
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

export type DownloadCode = "mime_not_allowed" | "size_exceeds" | "download_failed" | "provider_unauthorized" | "media_not_found" | "empty" | "magic_mismatch" | "no_url" | "unsafe_url" | "timeout";
export type DownloadResult =
  | { ok: true; bytes: Uint8Array; mime_type: string; filename: string }
  | { ok: false; code: DownloadCode; detail?: string };

async function fetchWithLimits(url: string, headers: Record<string, string>, kind: MediaKind = "document"): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, redirect: "error", signal: ac.signal });
    if (r.status === 401 || r.status === 403) return { ok: false, code: "provider_unauthorized", detail: `status_${r.status}` };
    if (r.status === 404) return { ok: false, code: "media_not_found", detail: "status_404" };
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

function providerAuthHeaders(apiKey: string): Record<string, string> {
  return { "X-Api-Key": apiKey };
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

type MediaCandidate = { url: string; family: string };

function trustedMediaPath(raw: string | undefined): string | null {
  if (!raw || raw.includes("\\") || raw.includes("..")) return null;
  let path = raw.trim();
  try {
    const parsed = new URL(path.includes("://") ? path : `https://placeholder.invalid/${path.replace(/^\/+/, "")}`);
    if (parsed.username || parsed.password) return null;
    path = parsed.pathname + parsed.search;
  } catch {
    return null;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  // Somente rotas de mídia do próprio WAHA podem ser rebaseadas na origem
  // confiável. Caminhos CDN/WhatsApp nunca recebem a chave do provedor.
  return /^\/api\/(?:files(?:\/|\?)|[^/]+\/(?:files|messages|chats)\/)/.test(path) ? path : null;
}

function endpointCandidates(apiUrl: string, session: string, messageId: string, media?: MediaHint): MediaCandidate[] {
  const base = apiUrl.replace(/\/$/, "");
  const candidates: MediaCandidate[] = [];
  const realPaths = [media?.url, media?.mediaUrl, media?.directPath]
    .map(trustedMediaPath)
    .filter((path): path is string => Boolean(path));
  for (const path of realPaths) candidates.push({ url: `${base}${path}`, family: "payload_path" });
  const configured = typeof globalThis.Deno !== "undefined"
    ? globalThis.Deno.env.get("WAHA_MEDIA_ENDPOINT_TEMPLATE")?.trim()
    : undefined;
  if (configured) {
    const path = renderTemplate(configured, { session, id: messageId, chatId: media?.chatId ?? "", timestamp: String(media?.messageTimestamp ?? "") });
    if (path) candidates.push({ url: `${base}${path}`, family: "configured" });
  }
  const s = encodeURIComponent(session);
  const id = encodeURIComponent(messageId);
  const chat = media?.chatId ? encodeURIComponent(media.chatId) : "";
  const fileId = encodeURIComponent(media?.fileId ?? messageId);
  candidates.push(
    { url: `${base}/api/${s}/files/${fileId}`, family: "session_file" },
    { url: `${base}/api/${s}/messages/${id}/download`, family: "message_download" },
    { url: `${base}/api/files/${s}/${fileId}`, family: "files_session" },
    { url: `${base}/api/${s}/messages/${id}/media`, family: "message_media" },
  );
  if (chat) {
    candidates.push(
      { url: `${base}/api/${s}/chats/${chat}/messages/${id}/download`, family: "chat_download" },
      { url: `${base}/api/${s}/chats/${chat}/messages/${id}/media`, family: "chat_media" },
    );
  }
  const seen = new Set<string>();
  return candidates.filter(({ url }) => !seen.has(url) && Boolean(seen.add(url)));

}

export type FetchResult = { ok: true; bytes: Uint8Array } | { ok: false; code: DownloadCode; detail?: string };

async function fetchWahaMedia(apiUrl: string, apiKey: string, session: string, messageId: string, media?: MediaHint, kind: MediaKind = "document"): Promise<FetchResult> {
  const guard = assertPublicHttpsUrl(`${apiUrl.replace(/\/$/, "")}/api/`);
  if (!guard.ok) return { ok: false, code: "unsafe_url", detail: guard.code };
  let last: FetchResult = { ok: false, code: "media_not_found", detail: "all_candidates_not_found" };
  const diagnostics: string[] = [];
  for (const candidate of endpointCandidates(apiUrl, session, messageId, media)) {
    const result = await fetchWithLimits(candidate.url, providerAuthHeaders(apiKey), kind);
    if (result.ok === true) return result;
    const fail = result as Extract<FetchResult, { ok: false }>;
    diagnostics.push(`${candidate.family}:${fail.detail ?? fail.code}`);
    last = fail;
    if (["size_exceeds", "unsafe_url", "timeout", "mime_not_allowed", "provider_unauthorized"].includes(fail.code)) {
      return { ...fail, detail: diagnostics.join(";").slice(0, 400) };
    }
  }
  return { ...last, detail: diagnostics.join(";").slice(0, 400) || last.detail };
}

/** Resumo diagnóstico da mídia inbound — sem URLs, sem bytes, sem PII. */
export function describeMediaHint(media: (MediaHint & { mediaSize?: number; seconds?: number }) | undefined | null): Record<string, unknown> {
  if (!media) return { present: false };
  const url = media.url ?? media.mediaUrl;
  return {
    present: true,
    via: (media as { via?: string }).via ?? null,
    mime: (media.mime_type ?? media.mimetype ?? media.mimeType ?? "").split(";")[0] || null,
    has_url: Boolean(url),
    url_https: url ? url.startsWith("https://") : null,
    has_base64: Boolean(media.base64 ?? media.data),
    has_id: Boolean(serializedId(media.id)),
    has_chat: Boolean(media.chatId),
    seconds: media.seconds ?? null,
    size: media.mediaSize ?? null,
  };
}

export async function downloadInboundMedia(opts: { media: MediaHint | undefined; apiUrl?: string; apiKey?: string; session?: string; messageId?: string; kind?: MediaKind }): Promise<DownloadResult> {
  const kind: MediaKind = opts.kind ?? "document";
  const declaredMime = (opts.media?.mime_type ?? opts.media?.mimeType ?? opts.media?.mimetype ?? "").toLowerCase();
  const filename = (opts.media?.filename ?? `wa-${Date.now()}`).slice(0, 120);
  const inline = opts.media?.base64 ?? opts.media?.data ?? (opts.media?.body?.startsWith("data:") ? opts.media.body : undefined);
  const directUrl = opts.media?.url ?? opts.media?.mediaUrl;
  const messageId = opts.messageId || serializedId(opts.media?.id);
  const canUseProvider = Boolean(opts.apiUrl && opts.apiKey && opts.session && messageId);
  const trail: string[] = [];
  let last: Extract<DownloadResult, { ok: false }> | null = null;

  // 1) Áudio/documento embutido: nada de rede.
  if (inline) {
    const bytes = base64ToBytes(inline);
    if (bytes) return finalize(bytes, declaredMime, filename, kind);
    trail.push("inline:b64_decode");
    last = { ok: false, code: "download_failed", detail: "b64_decode" };
  }

  // 2) URL direta. Uma URL recusada pela guarda NÃO encerra a tentativa
  //    quando ainda podemos baixar autenticado pelo provedor.
  if (directUrl) {
    const guard = assertPublicHttpsUrl(directUrl);
    if (!guard.ok) {
      trail.push(`direct:unsafe_url:${guard.code}`);
      last = { ok: false, code: "unsafe_url", detail: guard.code };
      if (!canUseProvider) return { ok: false, code: "unsafe_url", detail: `${guard.code}|${trail.join(",")}` };
    } else {
      const headerSets: Array<Record<string, string>> = [{}];
      try {
        if (opts.apiUrl && opts.apiKey && new URL(directUrl).origin === new URL(opts.apiUrl).origin) {
          headerSets.unshift(providerAuthHeaders(opts.apiKey));
        }
      } catch { /* URLs já foram validadas */ }
      for (const headers of headerSets) {
        const result = await fetchWithLimits(directUrl, headers, kind);
        if (result.ok === true) return finalize(result.bytes, declaredMime, filename, kind);
        const fail = result as Extract<FetchResult, { ok: false }>;
        trail.push(`direct:${fail.code}${fail.detail ? `:${fail.detail}` : ""}`);
        last = { ok: false, code: fail.code, detail: fail.detail };
        // Erros terminais do arquivo em si não se resolvem trocando de rota.
        if (["size_exceeds", "timeout"].includes(fail.code)) {
          return { ok: false, code: fail.code, detail: `${fail.detail ?? ""}|${trail.join(",")}` };
        }
        if (fail.code !== "download_failed" && !canUseProvider) {
          return { ok: false, code: fail.code, detail: `${fail.detail ?? ""}|${trail.join(",")}` };
        }
        break;
      }
    }
  }

  // 3) Download autenticado no provedor (rota que funciona quando o payload
  //    só traz o descritor da mídia).
  if (canUseProvider) {
    const result = await fetchWahaMedia(opts.apiUrl!, opts.apiKey!, opts.session!, messageId, opts.media, kind);
    if (result.ok === true) return finalize(result.bytes, declaredMime, filename, kind);
    const fail = result as Extract<FetchResult, { ok: false }>;
    trail.push(`provider:${fail.code}${fail.detail ? `:${fail.detail}` : ""}`);
    return { ok: false, code: fail.code, detail: trail.join(",") };
  }

  if (last) return { ok: false, code: last.code, detail: `${last.detail ?? ""}|${trail.join(",")}` };
  const missing = [
    opts.apiUrl ? null : "api_url",
    opts.apiKey ? null : "api_key",
    opts.session ? null : "session",
    messageId ? null : "message_id",
  ].filter(Boolean).join("+");
  return { ok: false, code: "no_url", detail: missing || undefined };
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


// ===================== ÁUDIO INBOUND (nota de voz) =====================
// Transcrição de áudio inbound do WhatsApp (nota de voz / PTT).
//
// Decisão de produto: áudio NÃO é um fluxo separado. Ele é transcrito e o texto
// entra no mesmo pipeline textual do Nino — registrar gasto, perguntar, tudo.
// Assim não existe uma "inteligência de áudio" paralela para manter.
//
// Nota técnica: o WhatsApp envia OGG/Opus, formato recusado pelo endpoint
// dedicado de transcrição. Usamos o modelo multimodal do gateway, que aceita
// `input_audio` em ogg/mp3/m4a/wav/webm.

type AudioDownload = DownloadResult;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";
/** ~2 minutos de voz do WhatsApp em Opus. Acima disso recusamos com explicação. */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_SECONDS = 150;

export type AudioTranscriptionCode =
  | "not_audio"
  | "too_long"
  | "download_failed"
  | "unsupported_format"
  | "empty_audio"
  | "transcription_failed";

export type AudioTranscriptionResult =
  | { ok: true; text: string; mime_type: string; bytes: number }
  | { ok: false; code: AudioTranscriptionCode; detail?: string };

const FORMAT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
};

function pickMime(hint: AudioHint | null | undefined): string {
  return String(hint?.mime_type ?? hint?.mimeType ?? hint?.mimetype ?? "")
    .split(";")[0].trim().toLowerCase();
}

export type AudioHint = MediaHint & {
  seconds?: number | string;
  duration?: number | string;
  mimetype?: string;
};

/** True quando a mídia inbound é voz/áudio (PTT incluído). */
export function isAudioMedia(hint: AudioHint | null | undefined): boolean {
  if (!hint) return false;
  const mime = pickMime(hint);
  if (mime.startsWith("audio/")) return true;
  return String(hint.mediaType ?? "").toLowerCase() === "ptt";
}

function durationSeconds(hint: AudioHint): number | null {
  const raw = Number(hint.seconds ?? hint.duration ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Mensagem curta e honesta para cada falha — nunca silêncio. */
export function audioFailureReply(code: AudioTranscriptionCode, firstName?: string | null): string {
  const hi = firstName ? `${firstName}, ` : "";
  switch (code) {
    case "too_long":
      return `${hi}esse áudio ficou longo pra mim ouvir de uma vez 😅 Manda um mais curtinho (até uns 2 minutos) ou me escreve em texto que eu resolvo na hora.`;
    case "empty_audio":
      return `${hi}o áudio chegou vazio aqui. Grava de novo ou me manda por texto?`;
    case "unsupported_format":
      return `${hi}não consegui abrir esse formato de áudio. Grava direto aqui no WhatsApp ou me escreve que eu já cuido.`;
    case "download_failed":
      return `${hi}não consegui baixar seu áudio agora 🙏 Manda de novo em alguns segundos ou me escreve em texto que eu já resolvo.`;

    default:
      return `${hi}não consegui entender o áudio dessa vez 🙏 Pode repetir gravando de novo ou me escrever em texto?`;
  }
}

/**
 * Baixa e transcreve o áudio. Devolve o texto pronto para entrar no pipeline
 * textual do agente. Nunca lança: falhas viram código tratável.
 */
export async function transcribeInboundAudio(args: {
  media: AudioHint;
  messageId?: string;
  waha?: { apiUrl?: string; apiKey?: string; session?: string };
  timeoutMs?: number;
}): Promise<AudioTranscriptionResult> {
  if (!isAudioMedia(args.media)) return { ok: false, code: "not_audio" };

  const secs = durationSeconds(args.media);
  if (secs && secs > MAX_SECONDS) return { ok: false, code: "too_long", detail: `${Math.round(secs)}s` };
  const declaredBytes = Number(args.media.mediaSize ?? 0);
  if (declaredBytes && declaredBytes > MAX_AUDIO_BYTES) {
    return { ok: false, code: "too_long", detail: String(declaredBytes) };
  }

  const dl = await downloadInboundMedia({
    media: args.media,
    apiUrl: args.waha?.apiUrl,
    apiKey: args.waha?.apiKey,
    session: args.waha?.session,
    messageId: args.messageId,
    kind: "audio",
  });
  if (dl.ok !== true) {
    const fail = dl as Extract<AudioDownload, { ok: false }>;
    if (fail.code === "empty") return { ok: false, code: "empty_audio" };
    if (fail.code === "mime_not_allowed" || fail.code === "magic_mismatch") {
      return { ok: false, code: "unsupported_format", detail: fail.detail };
    }
    if (fail.code === "size_exceeds") return { ok: false, code: "too_long", detail: fail.detail };
    return { ok: false, code: "download_failed", detail: `${fail.code}|${fail.detail ?? ""}` };
  }
  if (dl.bytes.length > MAX_AUDIO_BYTES) return { ok: false, code: "too_long", detail: String(dl.bytes.length) };
  if (dl.bytes.length < 512) return { ok: false, code: "empty_audio" };

  const format = FORMAT_BY_MIME[dl.mime_type];
  if (!format) return { ok: false, code: "unsupported_format", detail: dl.mime_type };

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { ok: false, code: "transcription_failed", detail: "missing_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 25_000);
  try {
    const resp = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Transcreva literalmente o áudio em português do Brasil. Devolva SOMENTE a transcrição, "
              + "sem comentários, sem aspas, sem rótulos. Números e valores em dígitos (ex.: 32 reais). "
              + "Se não houver fala audível, devolva exatamente: [SEM_FALA].",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcreva este áudio." },
              { type: "input_audio", input_audio: { data: bytesToBase64(dl.bytes), format } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 200);
      console.error("[audio] transcription_http", resp.status, detail);
      return { ok: false, code: "transcription_failed", detail: `status_${resp.status}` };
    }
    const json = await resp.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!text || /^\[?sem_?fala\]?$/i.test(text)) return { ok: false, code: "empty_audio" };
    return { ok: true, text: text.slice(0, 1500), mime_type: dl.mime_type, bytes: dl.bytes.length };
  } catch (e) {
    const err = e as Error;
    return { ok: false, code: "transcription_failed", detail: err.name === "AbortError" ? "timeout" : "exception" };
  } finally {
    clearTimeout(timer);
  }
}
