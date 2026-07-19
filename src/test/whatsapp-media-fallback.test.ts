import { describe, it, expect } from "vitest";
import { shouldFallbackForMedia, isUniqueViolation } from "../../supabase/functions/_shared/messaging/mediaFallback";

describe("shouldFallbackForMedia", () => {
  it("dispara para imagens processáveis", () => {
    expect(shouldFallbackForMedia({ mime_type: "image/jpeg" })).toBe(true);
    expect(shouldFallbackForMedia({ mime_type: "image/png" })).toBe(true);
    expect(shouldFallbackForMedia({ mime_type: "image/webp" })).toBe(true);
  });

  it("dispara para PDFs e documentos (planilhas, csv)", () => {
    expect(shouldFallbackForMedia({ mime_type: "application/pdf" })).toBe(true);
    expect(shouldFallbackForMedia({ mime_type: "text/csv" })).toBe(true);
    expect(shouldFallbackForMedia({
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })).toBe(true);
  });

  it("NÃO dispara para áudio — segue o fluxo textual", () => {
    expect(shouldFallbackForMedia({ mime_type: "audio/ogg" })).toBe(false);
    expect(shouldFallbackForMedia({ mime_type: "audio/mpeg" })).toBe(false);
    expect(shouldFallbackForMedia({ mime_type: "audio/opus" })).toBe(false);
  });

  it("NÃO dispara para vídeo, sticker/gif animado ou tipos desconhecidos", () => {
    expect(shouldFallbackForMedia({ mime_type: "video/mp4" })).toBe(false);
    expect(shouldFallbackForMedia({ mime_type: "image/gif" })).toBe(false);
    expect(shouldFallbackForMedia({ mime_type: "application/zip" })).toBe(false);
    expect(shouldFallbackForMedia(null)).toBe(false);
    expect(shouldFallbackForMedia(undefined)).toBe(false);
  });

  it("aceita octet-stream com extensão conhecida (fallback WAHA)", () => {
    expect(shouldFallbackForMedia({ mime_type: "application/octet-stream", filename: "extrato.pdf" })).toBe(true);
    expect(shouldFallbackForMedia({ mime_type: "application/octet-stream", filename: "gasto.jpg" })).toBe(true);
    expect(shouldFallbackForMedia({ mime_type: "application/octet-stream", filename: "audio.ogg" })).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("reconhece código Postgres 23505 direto", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("reconhece mensagens de duplicate key / unique constraint", () => {
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "x"' })).toBe(true);
    expect(isUniqueViolation({ details: "Key (idempotency_key)=(y) already exists.", message: "unique constraint" })).toBe(true);
  });

  it("não confunde erros comuns", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({ code: "23503", message: "foreign key" })).toBe(false);
    expect(isUniqueViolation({ message: "timeout" })).toBe(false);
  });
});
