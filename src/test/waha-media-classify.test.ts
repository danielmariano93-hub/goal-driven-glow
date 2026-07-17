import { describe, it, expect } from "vitest";
import { classifyInbound } from "../../supabase/functions/_shared/messaging/wahaInbound";

const SESSION = "default";
const wrap = (payload: unknown, event = "message") => ({ event, session: SESSION, payload });

describe("classifyInbound — media extraction", () => {
  it("detects documentMessage in NOWEB payload even without media.url", () => {
    const r = classifyInbound(wrap({
      id: "mid1",
      from: "5511988887777@c.us",
      message: {
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "extrato.pdf",
        },
      },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.media).toBeDefined();
      expect(r.media?.mime_type).toBe("application/pdf");
      expect(r.media?.filename).toBe("extrato.pdf");
      expect(r.media?.url).toBeUndefined();
    }
  });

  it("detects imageMessage nested under _data.message", () => {
    const r = classifyInbound(wrap({
      id: "mid2",
      from: "5511988887777@c.us",
      _data: { message: { imageMessage: { mimetype: "image/jpeg" } } },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.media?.mime_type).toBe("image/jpeg");
  });

  it("captures direct https URL when provided", () => {
    const r = classifyInbound(wrap({
      id: "mid3",
      from: "5511988887777@c.us",
      media: { url: "https://waha.example/file.pdf", mimetype: "application/pdf", filename: "a.pdf" },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.media?.url).toBe("https://waha.example/file.pdf");
  });

  it("captures base64 payload when engine inlines it", () => {
    const r = classifyInbound(wrap({
      id: "mid4",
      from: "5511988887777@c.us",
      media: { data: "iVBORw0KGgo=", mimetype: "image/png" },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.media?.base64).toBe("iVBORw0KGgo=");
  });

  it("keeps media even when body/caption is empty", () => {
    const r = classifyInbound(wrap({
      id: "mid5",
      from: "5511988887777@c.us",
      message: { documentMessage: { mimetype: "application/pdf" } },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.media?.mime_type).toBe("application/pdf");
      expect(r.body).toBe("");
    }
  });
});
