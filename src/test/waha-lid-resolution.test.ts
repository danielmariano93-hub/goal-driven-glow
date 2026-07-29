import { describe, it, expect } from "vitest";
import { classifyInbound, extractSenderLid } from "../../supabase/functions/_shared/messaging/wahaInbound";

const SESSION = "default";
const base = (payload: unknown, event = "message"): unknown => ({
  event, session: SESSION, payload,
});

const lidOnly = {
  id: "msg-lid-1",
  from: "31142858252478@lid",
  key: { id: "msg-lid-1", remoteJid: "31142858252478@lid" },
  body: "gastei 42,90 no almoço",
  timestamp: Math.floor(Date.now() / 1000),
};

describe("classifyInbound — WAHA 2026.x @lid", () => {
  it("sinaliza lid_pending (não descarta) quando só há @lid", () => {
    const r = classifyInbound(base(lidOnly), SESSION);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("lid_pending");
      expect(r.sender_lid).toBe("31142858252478@lid");
    }
  });

  it("classifica com sucesso quando o telefone é resolvido externamente", () => {
    const r = classifyInbound(base(lidOnly), SESSION, { resolvedPhone: "5511999998888@s.whatsapp.net" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from_phone).toBe("+5511999998888");
      expect(r.body).toBe("gastei 42,90 no almoço");
    }
  });

  it("cai em lid_unresolved quando a resolução externa falha", () => {
    const r = classifyInbound(base(lidOnly), SESSION, { resolvedPhone: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lid_unresolved");
  });

  it("usa senderPn quando presente, sem precisar resolver", () => {
    const r = classifyInbound(base({
      ...lidOnly,
      key: { id: "msg-lid-2", remoteJid: "31142858252478@lid", senderPn: "5511977079909@s.whatsapp.net" },
      id: "msg-lid-2",
    }), SESSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.from_phone).toBe("+5511977079909");
  });

  it("continua descartando grupos e fromMe mesmo com @lid", () => {
    const grupo = classifyInbound(base({ ...lidOnly, from: "12345@g.us" }), SESSION);
    expect(grupo.ok).toBe(false);
    if (!grupo.ok) expect(grupo.reason).toBe("group");

    const meu = classifyInbound(base({ ...lidOnly, fromMe: true }), SESSION);
    expect(meu.ok).toBe(false);
    if (!meu.ok) expect(meu.reason).toBe("from_me");
  });

  it("extractSenderLid encontra o lid em diferentes formatos", () => {
    expect(extractSenderLid(base(lidOnly))).toBe("31142858252478@lid");
    expect(extractSenderLid(base({ ...lidOnly, from: "5511999998888@c.us", key: {} }))).toBeNull();
  });
});
