import { describe, expect, it } from "vitest";
import { decideCommunication, type CommunicationPreferences } from "../../supabase/functions/_shared/intelligence/communicationPolicy.ts";

const baseCandidate = {
  id: "cand-1",
  user_id: "u1",
  kind: "spending_spike",
  severity: "attention" as const,
  channel_ready: "both" as const,
  title: "Gasto atípico",
  body: "Você gastou acima da média",
  evidence: {},
  dedup_key: "spending_spike:cat:2026-07-27",
  priority: 100,
  action: null,
};

const prefs: CommunicationPreferences = {
  proactive_financial: true,
  whatsapp_proactive: true,
  max_proactive_per_week: 3,
  quiet_start: "22:00",
  quiet_end: "07:00",
};

describe("communicationPolicy", () => {
  const now = new Date("2026-07-27T15:00:00-03:00");

  it("permite envio quando dentro da política", () => {
    const d = decideCommunication({ candidate: baseCandidate, target: "app", preferences: prefs, history: [], now });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("eligible");
  });

  it("bloqueia canal não pronto", () => {
    const d = decideCommunication({
      candidate: { ...baseCandidate, channel_ready: "app" },
      target: "whatsapp", preferences: prefs, history: [], now,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("channel_not_ready");
  });

  it("respeita opt-out granular de WhatsApp", () => {
    const d = decideCommunication({
      candidate: baseCandidate, target: "whatsapp",
      preferences: { ...prefs, whatsapp_proactive: false }, history: [], now,
    });
    expect(d.reason).toBe("whatsapp_opt_out");
  });

  it("respeita quiet hours no WhatsApp", () => {
    const late = new Date("2026-07-27T23:30:00-03:00");
    const d = decideCommunication({
      candidate: baseCandidate, target: "whatsapp",
      preferences: prefs, history: [], now: late,
    });
    expect(d.reason).toBe("quiet_hours");
  });

  it("aplica limite semanal (frequency cap) para severidade não crítica", () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      created_at: new Date(now.getTime() - (i + 1) * 86400000).toISOString(),
      kind: "other", channel: "app", status: "delivered",
    }));
    const d = decideCommunication({ candidate: baseCandidate, target: "app", preferences: prefs, history, now });
    expect(d.reason).toBe("weekly_frequency_cap");
  });

  it("severidade crítica ignora frequency cap", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      created_at: new Date(now.getTime() - (i + 1) * 86400000).toISOString(),
      kind: "other", channel: "app", status: "delivered",
    }));
    const d = decideCommunication({
      candidate: { ...baseCandidate, severity: "critical" },
      target: "app", preferences: prefs, history, now,
    });
    expect(d.allowed).toBe(true);
  });

  it("aplica cooldown de 24h por tipo (dedup)", () => {
    const history = [{
      created_at: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
      kind: baseCandidate.kind, channel: "app", status: "delivered",
    }];
    const d = decideCommunication({ candidate: baseCandidate, target: "app", preferences: prefs, history, now });
    expect(d.reason).toBe("kind_cooldown_24h");
  });

  it("prioridade cresce com severidade", () => {
    const info = decideCommunication({ candidate: { ...baseCandidate, severity: "info" }, target: "app", preferences: prefs, history: [], now });
    const attention = decideCommunication({ candidate: baseCandidate, target: "app", preferences: prefs, history: [], now });
    const critical = decideCommunication({ candidate: { ...baseCandidate, severity: "critical" }, target: "app", preferences: prefs, history: [], now });
    expect(info.priority).toBeLessThan(attention.priority);
    expect(attention.priority).toBeLessThan(critical.priority);
  });
});
