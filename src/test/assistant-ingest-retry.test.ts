import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client used inside AssessorAttachButton
const invoke = vi.fn();
const uploadToSignedUrl = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    storage: {
      from: () => ({ uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(...args) }),
    },
  },
}));

// Speed up polling — actual timers are fine but we override the constant by tapping into the module.
import { ingestDocument } from "@/components/assessor/AssessorAttachButton";

function makePdf(): File {
  // Minimal valid-looking PDF blob (content irrelevant, only File API is exercised in client).
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return new File([bytes], "extrato.pdf", { type: "application/pdf" });
}

describe("ingestDocument: retry after transient finalize failure", () => {
  beforeEach(() => {
    invoke.mockReset();
    uploadToSignedUrl.mockReset();
    vi.useFakeTimers();
  });

  it("upload OK + finalize retorna processing + status vira needs_review após poll/resume", async () => {
    // Sequence:
    //  1. create-upload
    //  2. uploadToSignedUrl
    //  3. finalize (returns processing)
    //  4. status (still processing)
    //  5. status (needs_review) — polling wins here
    uploadToSignedUrl.mockResolvedValue({ error: null });

    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      const mode = opts.body.mode;
      if (mode === "create-upload") {
        return Promise.resolve({
          data: {
            document_id: "doc-1",
            upload_url: "https://signed",
            storage_path: "u/doc-1.pdf",
            token: "tkn",
          },
          error: null,
        });
      }
      if (mode === "finalize") {
        return Promise.resolve({
          data: { document_id: "doc-1", status: "processing", correlation_id: "cid-1" },
          error: null,
        });
      }
      if (mode === "status") {
        // First status call still processing, then terminal.
        const seen = (invoke.mock.calls || []).filter((c) => c[1]?.body?.mode === "status").length;
        if (seen <= 1) {
          return Promise.resolve({ data: { document_id: "doc-1", status: "processing" }, error: null });
        }
        return Promise.resolve({
          data: { document_id: "doc-1", status: "needs_review", items_count: 3, document_kind: "statement" },
          error: null,
        });
      }
      if (mode === "resume") {
        return Promise.resolve({ data: { document_id: "doc-1", status: "processing" }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("unexpected " + mode) });
    });

    const pending = ingestDocument(makePdf(), null, "extrato do mês");
    // Drain poll timers.
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.status).toBe("needs_review");
    expect(result.items_count).toBe(3);
    // Exactly one upload — retry must NOT re-upload the PDF.
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    const modes = invoke.mock.calls.map((c) => c[1]?.body?.mode);
    expect(modes.filter((m) => m === "create-upload")).toHaveLength(1);
    expect(modes.filter((m) => m === "finalize")).toHaveLength(1);
    expect(modes.filter((m) => m === "status").length).toBeGreaterThanOrEqual(2);
  });

  it("falha de upload propaga com code=upload e não invoca finalize", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: new Error("network") });
    invoke.mockImplementation((_fn: string, opts: { body: Record<string, unknown> }) => {
      if (opts.body.mode === "create-upload") {
        return Promise.resolve({ data: { document_id: "doc-2", upload_url: "u", storage_path: "u/doc-2.pdf", token: "t" }, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("should not reach") });
    });

    await expect(ingestDocument(makePdf(), null, "")).rejects.toThrow(/enviar o arquivo/);
    const modes = invoke.mock.calls.map((c) => c[1]?.body?.mode);
    expect(modes).toContain("create-upload");
    expect(modes).not.toContain("finalize");
  });
});
