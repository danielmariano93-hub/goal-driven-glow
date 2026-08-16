// Sanitização de logs do fluxo nativo.
// Nunca deixar token, senha, base64 de áudio/documento ou mensagem inteira no console.
const SENSITIVE_KEYS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "id_token",
  "password",
  "new_password",
  "token",
  "authorization",
  "apikey",
  "audio",
  "audio_base64",
  "recordDataBase64",
  "base64",
  "file",
  "blob",
  "message",
  "text",
  "transcript",
  "content",
];

const MAX_STRING = 120;

function sanitizeString(value: string): string {
  if (value.length > MAX_STRING) return `${value.slice(0, 24)}…[${value.length} chars omitidos]`;
  return value;
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[profundidade omitida]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitizeForLog(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? "[omitido]" : sanitizeForLog(raw, depth + 1);
    }
    return out;
  }
  return "[valor omitido]";
}

/** Log seguro para diagnóstico nativo: nunca imprime segredo nem conteúdo do usuário. */
export function nativeLog(scope: string, event: string, details?: unknown): void {
  if (details === undefined) console.info(`[native:${scope}] ${event}`);
  else console.info(`[native:${scope}] ${event}`, sanitizeForLog(details));
}

export function nativeError(scope: string, event: string, details?: unknown): void {
  console.error(`[native:${scope}] ${event}`, details === undefined ? "" : sanitizeForLog(details));
}
