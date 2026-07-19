import { describe, expect, it } from "vitest";
import { classifyInbound } from "../../supabase/functions/_shared/messaging/wahaInbound";

describe("WAHA image payload", () => {
  it("preserva mediaUrl, directPath e id para download autenticado", () => {
    const result = classifyInbound({ event: "message", session: "default", payload: {
      id: { _serialized: "abc" }, from: "5511999999999@c.us", timestamp: Date.now(),
      message: { imageMessage: { mimetype: "image/jpeg", mediaUrl: "https://example.com/i", directPath: "/x" } },
    } }, "default");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.media?.mediaUrl).toBe("https://example.com/i");
      expect(result.media?.directPath).toBe("/x");
    }
  });
});
