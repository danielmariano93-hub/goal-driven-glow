import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyInbound } from "../../supabase/functions/_shared/messaging/wahaInbound";
import { describeMediaHint, downloadInboundMedia } from "../../supabase/functions/_shared/messaging/wahaMedia";

const SESSION = "default";
const wrap = (payload: unknown) => ({ event: "message", session: SESSION, payload });

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("classifyInbound — áudio e nota de voz", () => {
  it("extrai audioMessage do payload NOWEB", () => {
    const r = classifyInbound(wrap({
      id: "a1",
      from: "5511988887777@c.us",
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 7, ptt: true } },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.media?.mime_type).toBe("audio/ogg; codecs=opus");
      expect((r.media as { seconds?: number } | undefined)?.seconds).toBe(7);
    }
  });

  it("extrai pttMessage mesmo sem mimetype", () => {
    const r = classifyInbound(wrap({
      id: "a2",
      from: "5511988887777@c.us",
      message: { pttMessage: { seconds: 3 } },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.media?.mime_type).toBe("audio/ogg");
  });
});

describe("downloadInboundMedia — resiliência de áudio", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("URL insegura não aborta quando o provedor pode baixar autenticado", async () => {
    const fetchMock = vi.fn(async () => new Response(OGG, {
      status: 200, headers: { "content-type": "audio/ogg" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await downloadInboundMedia({
      media: { url: "mmg.whatsapp.net/x.enc", mime_type: "audio/ogg", id: "a3" },
      apiUrl: "https://waha.example.com",
      apiKey: "k",
      session: SESSION,
      messageId: "a3",
      kind: "audio",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("sem credenciais do provedor devolve no_url com o que está faltando", async () => {
    const r = await downloadInboundMedia({ media: { mime_type: "audio/ogg", id: "a4" }, kind: "audio" });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("no_url");
      expect(r.detail).toContain("api_url");
    }
  });

  it("descritor diagnóstico não expõe URL nem bytes", () => {
    const d = describeMediaHint({ url: "https://waha.example/x.ogg", mime_type: "audio/ogg; codecs=opus", id: "a5" });
    expect(d).toMatchObject({ present: true, mime: "audio/ogg", has_url: true, url_https: true, has_id: true });
    expect(JSON.stringify(d)).not.toContain("waha.example");
    expect(describeMediaHint(undefined)).toEqual({ present: false });
  });
});
