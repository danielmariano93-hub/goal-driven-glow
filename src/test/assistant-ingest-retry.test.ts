import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client used inside AssessorAttachButton
const invoke = vi.fn();
const uploadToSignedUrl = vi.fn();
const upload = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    storage: {
      from: () => ({
        uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(...args),
        upload: (...args: unknown[]) => upload(...args),
      }),
    },
  },
}));

import { ingestDocument } from "@/components/assessor/AssessorAttachButton";

function makePdf(): File {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const file = new File([bytes], "extrato.pdf", { type: "application/pdf" });
  if (typeof (file as unknown as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  }
  return file;
}

function modesCalled() {
  return invoke.mock.calls.map((c) => (c[1] as { body?: { mode?: string } })?.body?.mode);
}

describe("ingestDocument", () => {
  beforeEach(() => {
    invoke.mockReset();
    uploadToSignedUrl.mockReset();
    upload.mockReset();
    vi.useFakeTimers();
  });

  it("upload OK + finalize retorna processing sem bloquear o painel", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: null });

    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({
          data: { document_id: "doc-1", upload_url: "https://signed", storage_path: "u/doc-1.pdf", token: "tkn" },
          error: null,
        });
      }
      if (mode === "verify-upload") {
        return Promise.resolve({ data: { exists: true, size: 100 }, error: null });
      }
      if (mode === "finalize") {
        return Promise.resolve({ data: { document_id: "doc-1", status: "processing", correlation_id: "cid-1" }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    const result = await ingestDocument(makePdf(), null, "extrato do mês");

    expect(result.status).toBe("processing");
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    const modes = modesCalled();
    expect(modes.filter((m) => m === "create-upload")).toHaveLength(1);
    expect(modes.filter((m) => m === "finalize")).toHaveLength(1);
    expect(modes).not.toContain("status");
    expect(modes).not.toContain("resume");
    const createCall = invoke.mock.calls.find((c) => (c[1] as { body?: { mode?: string } })?.body?.mode === "create-upload");
    expect((createCall?.[1] as { body: { guidance?: string } }).body.guidance).toBe("extrato do mês");
  });

  it("uploadToSignedUrl falha → fallback autenticado grava → verify OK → finalize prossegue", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: new Error("network") });
    upload.mockResolvedValue({ error: null, data: { path: "u/doc-2.pdf" } });

    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({ data: { document_id: "doc-2", upload_url: "u", storage_path: "u/doc-2.pdf", token: "t" }, error: null });
      }
      if (mode === "verify-upload") {
        return Promise.resolve({ data: { exists: true, size: 42 }, error: null });
      }
      if (mode === "finalize") {
        return Promise.resolve({ data: { document_id: "doc-2", status: "needs_review", items_count: 1 }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    const result = await ingestDocument(makePdf(), null, "");
    expect(result.status).toBe("needs_review");
    expect(upload).toHaveBeenCalledTimes(1);
    const modes = modesCalled();
    expect(modes).toContain("finalize");
    expect(modes).not.toContain("mark-upload-missing");
  });

  it("uploadToSignedUrl falha e fallback também falha → mark-upload-missing e finalize nunca é chamado", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: new Error("network") });
    upload.mockResolvedValue({ error: new Error("network"), data: null });

    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({ data: { document_id: "doc-2b", upload_url: "u", storage_path: "u/doc-2b.pdf", token: "t" }, error: null });
      }
      if (mode === "verify-upload") {
        return Promise.resolve({ data: { exists: false, size: 0 }, error: null });
      }
      if (mode === "mark-upload-missing") {
        return Promise.resolve({
          data: { document_id: "doc-2b", status: "failed", error: "upload_missing", user_message: "Não consegui salvar o arquivo." },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    await expect(ingestDocument(makePdf(), null, "")).rejects.toThrow(/salvar o arquivo/);
    const modes = modesCalled();
    expect(modes).toContain("mark-upload-missing");
    expect(modes).not.toContain("finalize");
  });

  it("uploadToSignedUrl 'sucesso' sem objeto → fallback autenticado grava → finalize prossegue", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: null });
    upload.mockResolvedValue({ error: null, data: { path: "u/doc-3.pdf" } });

    let verifyCall = 0;
    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({ data: { document_id: "doc-3", upload_url: "u", storage_path: "u/doc-3.pdf", token: "t" }, error: null });
      }
      if (mode === "verify-upload") {
        verifyCall++;
        if (verifyCall === 1) return Promise.resolve({ data: { exists: false, size: 0 }, error: null });
        return Promise.resolve({ data: { exists: true, size: 42 }, error: null });
      }
      if (mode === "finalize") {
        return Promise.resolve({ data: { document_id: "doc-3", status: "needs_review", items_count: 2 }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    const result = await ingestDocument(makePdf(), null, "");
    expect(result.status).toBe("needs_review");
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    const modes = modesCalled();
    expect(modes.filter((m) => m === "verify-upload")).toHaveLength(2);
    expect(modes.filter((m) => m === "finalize")).toHaveLength(1);
    expect(modes).not.toContain("mark-upload-missing");
  });

  it("fallback também falha → mark-upload-missing e finalize nunca é chamado", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: null });
    upload.mockResolvedValue({ error: new Error("network"), data: null });

    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({ data: { document_id: "doc-4", upload_url: "u", storage_path: "u/doc-4.pdf", token: "t" }, error: null });
      }
      if (mode === "verify-upload") {
        return Promise.resolve({ data: { exists: false, size: 0 }, error: null });
      }
      if (mode === "mark-upload-missing") {
        return Promise.resolve({
          data: { document_id: "doc-4", status: "failed", error: "upload_missing", user_message: "Não consegui salvar o arquivo." },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    await expect(ingestDocument(makePdf(), null, "")).rejects.toThrow(/salvar o arquivo/);
    const modes = modesCalled();
    expect(modes.filter((m) => m === "verify-upload")).toHaveLength(2);
    expect(modes).toContain("mark-upload-missing");
    expect(modes).not.toContain("finalize");
  });
});
