import { describe, expect, it } from "vitest";
import { ackFromNumber, ackFromPayload, chatIdFromPhone } from "../../supabase/functions/_shared/messaging/wahaAck";
import { rotateProactiveAudience } from "../../supabase/functions/_shared/intelligence/proactiveAudience";
import { decideCommunication, type CommunicationPreferences } from "../../supabase/functions/_shared/intelligence/communicationPolicy";

describe("wahaAck", () => {
  it("traduz ACK numérico do WhatsApp", () => {
    expect(ackFromNumber(-1)).toBe("failed");
    expect(ackFromNumber(0)).toBe("pending");
    expect(ackFromNumber(1)).toBe("server");
    expect(ackFromNumber(2)).toBe("delivered");
    expect(ackFromNumber(3)).toBe("read");
    expect(ackFromNumber(null)).toBe("unknown");
  });

  it("lê ACK de payloads e listas do provedor", () => {
    expect(ackFromPayload({ ack: 2 })).toBe("delivered");
    expect(ackFromPayload([{ ackName: "READ" }])).toBe("read");
    expect(ackFromPayload({ status: "error" })).toBe("failed");
    expect(ackFromPayload({})).toBe("unknown");
    expect(ackFromPayload(null)).toBe("unknown");
  });

  it("monta chatId a partir do E.164", () => {
    expect(chatIdFromPhone("+5511999998888")).toBe("5511999998888@c.us");
  });
});

describe("rotateProactiveAudience", () => {
  it("prioriza quem nunca foi escaneado e depois o mais antigo", () => {
    const order = rotateProactiveAudience(
      ["a", "b", "c"],
      new Map([["a", "2026-08-01T00:00:00Z"], ["b", null], ["c", "2026-07-01T00:00:00Z"]]),
      3,
    );
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("respeita o limite da rodada", () => {
    expect(rotateProactiveAudience(["a", "b", "c"], new Map(), 2)).toHaveLength(2);
  });
});

describe("communicationPolicy — bloqueio temporário", () => {
  const candidate = {
    id: "c1", user_id: "u1", kind: "spending_spike", severity: "attention" as const,
    channel_ready: "both" as const, title: "t", body: "b", evidence: {},
    dedup_key: "spending_spike:2026-08-03", priority: 100, action: null,
  };
  const prefs: CommunicationPreferences = {
    proactive_financial: true, whatsapp_proactive: true, max_proactive_per_week: 3,
    quiet_start: "22:00", quiet_end: "07:00", timezone: "America/Sao_Paulo",
  };

  it("horário de silêncio adia em vez de descartar", () => {
    const d = decideCommunication({
      candidate, target: "whatsapp", preferences: prefs, history: [],
      now: new Date("2026-08-03T23:30:00-03:00"),
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("quiet_hours");
    expect(d.temporary).toBe(true);
    expect(d.retryAt).toBeTruthy();
  });

  it("opt-out de WhatsApp é definitivo, não temporário", () => {
    const d = decideCommunication({
      candidate, target: "whatsapp",
      preferences: { ...prefs, whatsapp_proactive: false }, history: [],
      now: new Date("2026-08-03T15:00:00-03:00"),
    });
    expect(d.temporary).not.toBe(true);
  });
});
