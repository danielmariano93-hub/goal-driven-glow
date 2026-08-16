// Transcrição de áudio inbound do WhatsApp (nota de voz / PTT).
//
// Decisão de produto: áudio NÃO é um fluxo separado. Ele é transcrito e o texto
// entra no mesmo pipeline textual do Nino — registrar gasto, perguntar, tudo.
// Assim não existe uma "inteligência de áudio" paralela para manter.
//
// Nota técnica: o WhatsApp envia OGG/Opus, formato recusado pelo endpoint
// dedicado de transcrição. Usamos o modelo multimodal do gateway, que aceita
// `input_audio` em ogg/mp3/m4a/wav/webm.

import { downloadInboundMedia, type DownloadResult, type MediaHint } from "./wahaMedia.ts";

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
    return { ok: false, code: "download_failed", detail: fail.code };
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
