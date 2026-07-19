// Predicados puros usados pelo webhook para decidir se uma mídia inbound
// deve disparar o fallback "abra no Assessor". Isolar aqui garante que a
// regra é testável sem subir a edge function inteira.
//
// Decisão de produto:
//   - Imagens (jpeg/png/webp), PDFs e documentos comuns (pdf/csv/xls*)
//     têm OCR/parse no Assessor. Devem retornar `true`.
//   - Áudio, vídeo, sticker, gif animado etc. NÃO têm pipeline dedicado
//     e devem continuar seguindo o fluxo textual do orquestrador —
//     retornam `false` e a mensagem cai no runOrchestrator normal.
//
// Também exportamos um detector confiável de unique_violation
// (código Postgres 23505) para reconhecer reentregas idempotentes.

export type FallbackHint = {
  mime_type?: string | null;
  mimetype?: string | null;
  mimeType?: string | null;
  filename?: string | null;
};

const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const DOC_MIMES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
const DOC_EXTS = new Set(["pdf", "csv", "xls", "xlsx", "ofx", "png", "jpg", "jpeg", "webp"]);

function pickMime(hint: FallbackHint): string {
  return String(hint.mime_type ?? hint.mimeType ?? hint.mimetype ?? "").toLowerCase();
}

function pickExt(hint: FallbackHint): string {
  const name = String(hint.filename ?? "").toLowerCase();
  const m = name.match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : "";
}

/** True quando o Assessor sabe processar o anexo (imagem, PDF, planilha). */
export function shouldFallbackForMedia(hint: FallbackHint | null | undefined): boolean {
  if (!hint) return false;
  const mime = pickMime(hint);
  if (mime.startsWith("audio/")) return false;
  if (mime.startsWith("video/")) return false;
  if (mime === "image/gif") return false; // stickers/gifs animados
  if (IMAGE_MIMES.has(mime)) return true;
  if (DOC_MIMES.has(mime)) return true;
  if (mime.startsWith("image/")) return true; // fallback conservador para novos formatos
  // Sem mime confiável: aceita apenas quando o arquivo tem extensão conhecida.
  if (!mime || mime === "application/octet-stream") {
    return DOC_EXTS.has(pickExt(hint));
  }
  return false;
}

/** Detector abrangente para o erro Postgres 23505 (unique_violation).
 *  PostgREST devolve `code` diretamente, mas alguns clientes empacotam a
 *  origem no `details`/`message`. Aceitamos qualquer forma consistente. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  if (e.code === "23505") return true;
  const text = `${String(e.message ?? "")} ${String(e.details ?? "")}`.toLowerCase();
  return text.includes("duplicate key") || text.includes("unique constraint");
}
