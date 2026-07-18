import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadInboundMedia } from "../../supabase/functions/_shared/messaging/wahaMedia";

// Minimal 3x1 PNG (valid magic bytes + IHDR)
const PNG_BYTES = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x03,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0xd9,0x4a,0x22,
  0xe8,0x00,0x00,0x00,0x0c,0x49,0x44,0x41,0x54,0x08,0x99,0x63,0xf8,0xcf,0xc0,0x00,
  0x00,0x00,0x03,0x00,0x01,0x5b,0x9f,0xa2,0x36,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,
  0x44,0xae,0x42,0x60,0x82,
]);

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("downloadInboundMedia", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  it("decodes inline base64 and validates magic bytes", async () => {
    const r = await downloadInboundMedia({ media: { base64: b64(PNG_BYTES), mime_type: "image/png" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime_type).toBe("image/png");
  });

  it("rejects base64 that decodes to a disallowed mime", async () => {
    const html = new TextEncoder().encode("<html>hi</html>");
    const r = await downloadInboundMedia({ media: { base64: b64(html), mime_type: "text/html" } });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("magic_mismatch");
  });

  it("rejects unsafe (http/localhost) URLs before any network call", async () => {
    let called = false;
    globalThis.fetch = vi.fn(async () => { called = true; return new Response("nope"); }) as unknown as typeof fetch;
    const r = await downloadInboundMedia({ media: { url: "http://127.0.0.1/x.pdf", mime_type: "application/pdf" } });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("unsafe_url");
    expect(called).toBe(false);
  });

  it("returns no_url when nothing is provided", async () => {
    const r = await downloadInboundMedia({ media: {} });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("no_url");
  });

  it("downloads via WAHA-authenticated endpoint when payload has no URL", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const key = ((init?.headers ?? {}) as Record<string, string>)["X-Api-Key"];
      expect(key).toBe("secret-key");
      return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await downloadInboundMedia({
      media: { mime_type: "image/png" },
      apiUrl: "https://waha.example.com",
      apiKey: "secret-key",
      session: "default",
      messageId: "abc123",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps size at 20MB via content-length header", async () => {
    globalThis.fetch = vi.fn(async () => new Response("x", {
      status: 200, headers: { "content-length": String(30 * 1024 * 1024) },
    })) as unknown as typeof fetch;
    const r = await downloadInboundMedia({ media: { url: "https://example.com/big.pdf", mime_type: "application/pdf" } });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("size_exceeds");
  });

  it("rejects non-https URLs", async () => {
    const r = await downloadInboundMedia({ media: { url: "http://example.com/x.pdf", mime_type: "application/pdf" } });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("unsafe_url");
  });
});
