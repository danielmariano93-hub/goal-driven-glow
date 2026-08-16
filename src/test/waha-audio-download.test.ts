import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyInbound } from "../../supabase/functions/_shared/messaging/wahaInbound";
import { describeMediaHint, downloadInboundMedia, pcmFloatToWav, prepareAudioForTranscription } from "../../supabase/functions/_shared/messaging/wahaMedia";

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

  it("rebasa uma rota de mídia do payload na origem confiável e usa somente X-Api-Key", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://waha.example.com/api/files/default/voice.ogg");
      expect(init?.headers).toEqual({ "X-Api-Key": "secret" });
      return new Response(OGG, { status: 200, headers: { "content-type": "audio/ogg" } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await downloadInboundMedia({
      media: { url: "http://waha:3000/api/files/default/voice.ogg", mime_type: "audio/ogg", id: "msg" },
      apiUrl: "https://waha.example.com", apiKey: "secret", session: SESSION, messageId: "msg", kind: "audio",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não envia credencial para um caminho arbitrário recebido no payload", async () => {
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      requested.push(String(url));
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    await downloadInboundMedia({
      media: { url: "http://evil.invalid/private/audio.ogg", mime_type: "audio/ogg", id: "msg" },
      apiUrl: "https://waha.example.com", apiKey: "secret", session: SESSION, messageId: "msg", kind: "audio",
    });
    expect(requested.every((url) => url.startsWith("https://waha.example.com/api/"))).toBe(true);
    expect(requested.some((url) => url.includes("evil.invalid"))).toBe(false);
  });

  it("não mascara 404 com tentativas redundantes de autenticação", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await downloadInboundMedia({
      media: { mime_type: "audio/ogg", id: "msg" }, apiUrl: "https://waha.example.com",
      apiKey: "secret", session: SESSION, messageId: "msg", kind: "audio",
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.detail).toContain("status_404");
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("resolve mídia pela rota canônica da mensagem quando o payload não traz URL útil", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("downloadMedia=true")) {
        return Response.json({ media: { url: "http://waha:3000/api/files/default/resolved.ogg" } });
      }
      if (value.endsWith("/api/files/default/resolved.ogg")) {
        return new Response(OGG, { status: 200, headers: { "content-type": "audio/ogg" } });
      }
      return new Response("missing", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await downloadInboundMedia({
      media: { mime_type: "audio/ogg", id: "msg", chatId: "5511999999999@c.us" },
      apiUrl: "https://waha.example.com", apiKey: "secret", session: SESSION, messageId: "msg", kind: "audio",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("downloadMedia=true"))).toBe(true);
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

describe("conversão PCM para WAV", () => {
  it("gera um arquivo WAV completo com cabeçalho e amostras", () => {
    const wav = pcmFloatToWav([new Float32Array([0, 0.5, -0.5])], 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(6);
  });
});

describe("preparação para transcrição", () => {
  it("preserva OGG/Opus original sem conversão intermediária", () => {
    const prepared = prepareAudioForTranscription(OGG, "audio/ogg");
    expect(prepared.bytes).toBe(OGG);
    expect(prepared.mime).toBe("audio/ogg");
    expect(prepared.filename).toBe("recording.ogg");
  });

  it("preserva formatos aceitos e rejeita MIME desconhecido", () => {
    expect(prepareAudioForTranscription(new Uint8Array([1]), "audio/mpeg").filename).toBe("recording.mp3");
    expect(() => prepareAudioForTranscription(new Uint8Array([1]), "audio/flac")).toThrow("unsupported_audio");
  });
});
