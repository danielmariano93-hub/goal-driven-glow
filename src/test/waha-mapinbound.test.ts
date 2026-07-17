import { describe, it, expect } from "vitest";
import { classifyInbound } from "../../supabase/functions/_shared/messaging/wahaInbound";

const SESSION = "default";
const base = (payload: unknown, event = "message"): unknown => ({
  event, session: SESSION, payload,
});

describe("classifyInbound (WAHA NOWEB parser)", () => {
  it("resolves NOWEB @lid using remoteJidAlt (real phone JID)", () => {
    const r = classifyInbound(base({
      id: "abc123",
      from: "111111111@lid",
      remoteJidAlt: "5511999998888@s.whatsapp.net",
      key: { id: "abc123", remoteJid: "111111111@lid" },
      body: "oi",
      timestamp: Math.floor(Date.now() / 1000),
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from_phone).toBe("+5511999998888");
      expect(r.provider_message_id).toBe("abc123");
      expect(r.body).toBe("oi");
    }
  });

  it("resolves via key.remoteJidAlt when payload.remoteJidAlt is absent", () => {
    const r = classifyInbound(base({
      id: "id2",
      from: "222@lid",
      key: { id: "id2", remoteJid: "222@lid", remoteJidAlt: "5511988887777@s.whatsapp.net" },
      body: "olá",
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.from_phone).toBe("+5511988887777");
  });

  it("resolves via _data.key.remoteJidAlt", () => {
    const r = classifyInbound(base({
      id: "id3",
      from: "333@lid",
      _data: { key: { id: "id3", remoteJid: "333@lid", remoteJidAlt: "5521977776666@s.whatsapp.net" } },
      body: "x",
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.from_phone).toBe("+5521977776666");
  });

  it("drops NOWEB @lid without any alt field with reason=no_real_jid", () => {
    const r = classifyInbound(base({
      id: "id4",
      from: "444@lid",
      key: { id: "id4", remoteJid: "444@lid" },
      body: "x",
    }), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no_real_jid");
      expect(r.jid_domains).toContain("lid");
    }
  });

  it("accepts legacy @c.us JID", () => {
    const r = classifyInbound(base({
      id: "leg1",
      from: "5511988887777@c.us",
      body: "hey",
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.from_phone).toBe("+5511988887777");
  });

  it("drops fromMe (root)", () => {
    const r = classifyInbound(base({
      id: "m1", fromMe: true, from: "5511988887777@c.us", body: "x",
    }), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("from_me");
  });

  it("drops key.fromMe nested", () => {
    const r = classifyInbound(base({
      id: "m2", from: "5511988887777@c.us",
      key: { id: "m2", remoteJid: "5511988887777@c.us", fromMe: true },
      body: "x",
    }), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("from_me");
  });

  it("drops group JIDs (@g.us)", () => {
    const r = classifyInbound(base({
      id: "g1",
      from: "5511988887777-1234@g.us",
      key: { id: "g1", remoteJid: "5511988887777-1234@g.us" },
      body: "x",
    }), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("group");
  });

  it("drops non-message events", () => {
    const r = classifyInbound(base({}, "session.status"), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("event_ignored");
  });

  it("drops foreign session", () => {
    const r = classifyInbound({ event: "message", session: "other", payload: { id: "1", from: "5511988887777@c.us" } }, SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("foreign_session");
  });

  it("drops when no message id anywhere", () => {
    const r = classifyInbound(base({
      from: "5511988887777@c.us", body: "x",
    }), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_message_id");
  });

  it("extracts body from imageMessage.caption when body is empty", () => {
    const r = classifyInbound(base({
      id: "im1", from: "5511988887777@c.us",
      message: { imageMessage: { caption: "olha isso" } },
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe("olha isso");
  });

  it("sanitizes far-past timestamps back to now()", () => {
    const r = classifyInbound(base({
      id: "t1", from: "5511988887777@c.us", body: "x",
      timestamp: 1, // 1970
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = new Date(r.received_at).getTime();
      expect(Date.now() - t).toBeLessThan(5000);
    }
  });

  it("accepts message.any as an alias of message", () => {
    const r = classifyInbound(base({
      id: "any1", from: "5511988887777@c.us", body: "x",
    }, "message.any"), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider_message_id).toBe("any1");
  });

  it("prefers real JID over @lid even when @lid appears first", () => {
    const r = classifyInbound(base({
      id: "p1", from: "999@lid", participantAlt: "5511900001111@s.whatsapp.net",
      key: { id: "p1", remoteJid: "999@lid" },
      body: "x",
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.from_phone).toBe("+5511900001111");
  });
});
