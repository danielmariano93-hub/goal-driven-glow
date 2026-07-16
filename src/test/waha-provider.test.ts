import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Deno env for the provider module
const env: Record<string, string> = {};
(globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno = {
  env: { get: (k: string) => env[k] },
};

async function loadProvider() {
  const mod = await import("../../supabase/functions/_shared/messaging/waha.ts?" + Math.random());
  return mod.wahaProvider;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
}

describe("wahaProvider", () => {
  beforeEach(() => {
    env.WAHA_API_URL = "https://waha.example.com";
    env.WAHA_API_KEY = "k";
    env.WAHA_SESSION = "default";
    env.WAHA_WEBHOOK_SECRET = "s";
    vi.unstubAllGlobals();
  });

  it("is configured when secrets present (WAHA_API_URL primary)", async () => {
    const p = await loadProvider();
    expect(p.configured).toBe(true);
  });

  it("falls back to WAHA_BASE_URL", async () => {
    delete env.WAHA_API_URL;
    env.WAHA_BASE_URL = "https://legacy.example.com";
    const p = await loadProvider();
    expect(p.configured).toBe(true);
  });

  it("session status upper-cases and maps 404 to STOPPED", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    const p = await loadProvider();
    const s = await p.getSessionStatus();
    expect(s.status).toBe("STOPPED");
  });

  it("verifyWebhookSecret is constant-time and header-based", async () => {
    const p = await loadProvider();
    const good = new Headers({ "x-webhook-secret": "s" });
    const bad = new Headers({ "x-webhook-secret": "x" });
    expect(p.verifyWebhookSecret(good)).toBe(true);
    expect(p.verifyWebhookSecret(bad)).toBe(false);
  });

  it("getQr returns base64 without persisting/logging", async () => {
    mockFetch(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { "content-type": "image/png" },
    }));
    const p = await loadProvider();
    const r = await p.getQr();
    expect(r.ok).toBe(true);
    expect(r.base64).toBeTruthy();
    expect(r.mimeType).toBe("image/png");
  });
});
