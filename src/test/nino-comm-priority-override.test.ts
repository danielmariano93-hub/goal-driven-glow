import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMUNICATION_POLICY,
  attentionWeightOf,
  decideCommunication,
  normalizeCommunicationPolicy,
  type CommunicationPolicySettings,
  type CommunicationPreferences,
} from "../../supabase/functions/_shared/intelligence/communicationPolicy.ts";

const prefs: CommunicationPreferences = {
  proactive_financial: true,
  whatsapp_proactive: true,
  max_proactive_per_day: 1,
  max_proactive_per_week: 3,
  quiet_start: "21:00",
  quiet_end: "08:00",
};

const now = new Date("2026-09-02T15:00:00-03:00");

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    user_id: "u1",
    kind: "upcoming_cash_pressure",
    severity: "attention" as const,
    channel_ready: "both" as const,
    title: "t",
    body: "b",
    evidence: {},
    dedup_key: "k1",
    action: null,
    ...over,
  } as Parameters<typeof decideCommunication>[0]["candidate"];
}

/** Histórico que estoura o cap diário (1/dia) e o semanal (3/semana). */
function fullHistory() {
  return Array.from({ length: 3 }, (_, i) => ({
    created_at: new Date(now.getTime() - i * 3_600_000).toISOString(),
    kind: `outro_${i}`,
    channel: "app",
    status: "delivered",
    dedup_key: `d${i}`,
  }));
}

const pilot: CommunicationPolicySettings = {
  ...DEFAULT_COMMUNICATION_POLICY,
  pilot_mode: true,
  allow_high_priority_override: true,
  cap_behavior: "defer",
  high_priority_kinds: ["upcoming_cash_pressure"],
};

describe("nino_comm_priority.v1", () => {
  it("A — padrão do código mantém o comportamento conservador", () => {
    const d = decideCommunication({ candidate: candidate(), target: "app", preferences: prefs, history: fullHistory(), now });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("daily_frequency_cap");
  });

  it("B — alta relevância fura o cap quando o override está ligado", () => {
    const d = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 120 } }),
      target: "app", preferences: prefs, history: fullHistory(), now, policy: pilot,
    });
    expect(d.allowed).toBe(true);
    expect(d.cap_override).toBe(true);
    expect(d.cap_original_reason).toBe("daily_frequency_cap");
    expect(d.priority_band).toBe("very_high");
  });

  it("C — relevância baixa continua sendo segurada", () => {
    const d = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 10 } }),
      target: "app", preferences: prefs, history: fullHistory(), now, policy: pilot,
    });
    expect(d.allowed).toBe(false);
    expect(d.cap_override).toBeUndefined();
  });

  it("D — relevância média é adiada, não descartada", () => {
    const d = decideCommunication({
      candidate: candidate({ kind: "spending_spike", evidence: { priority_score: 50 } }),
      target: "app", preferences: prefs, history: fullHistory(), now, policy: pilot,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("medium_priority_frequency_defer");
    expect(d.temporary).toBe(true);
    expect(d.retryAt).toBeTruthy();
  });

  it("E — severidade crítica continua furando o cap sem depender do piloto", () => {
    const d = decideCommunication({
      candidate: candidate({ severity: "critical" }),
      target: "app", preferences: prefs, history: fullHistory(), now,
    });
    expect(d.allowed).toBe(true);
  });

  it("F — duplicidade nunca é furada por prioridade", () => {
    const history = [{
      created_at: new Date(now.getTime() - 3_600_000).toISOString(),
      kind: "upcoming_cash_pressure", channel: "app", status: "delivered", dedup_key: "k1",
    }];
    const d = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 300 } }),
      target: "app", preferences: prefs, history, now, policy: pilot,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("dedup_key_14d");
  });

  it("G — recusa do cliente nunca é furada por prioridade", () => {
    const d = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 300 } }),
      target: "whatsapp",
      preferences: { ...prefs, whatsapp_proactive: false },
      history: [], now, policy: pilot,
    });
    expect(d.reason).toBe("whatsapp_opt_out");
  });

  it("H — horário de silêncio adia por padrão e só envia na hora se configurado", () => {
    const late = new Date("2026-09-02T22:30:00-03:00");
    const deferred = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 200 } }),
      target: "whatsapp", preferences: prefs, history: [], now: late, policy: pilot,
    });
    expect(deferred.reason).toBe("quiet_hours");
    expect(deferred.temporary).toBe(true);

    const immediate = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 200 } }),
      target: "whatsapp", preferences: prefs, history: [], now: late,
      policy: { ...pilot, quiet_hours_high_priority_behavior: "immediate" },
    });
    expect(immediate.allowed).toBe(true);
  });

  it("I — orçamento é ponderado: mensagens leves não consomem a vez de uma decisão financeira", () => {
    const light = Array.from({ length: 2 }, (_, i) => ({
      created_at: new Date(now.getTime() - i * 3_600_000).toISOString(),
      kind: "emotional_checkin_due", channel: "app", status: "delivered", dedup_key: `l${i}`,
    }));
    const d = decideCommunication({ candidate: candidate(), target: "app", preferences: prefs, history: light, now });
    expect(d.allowed).toBe(true);
    expect(attentionWeightOf("emotional_checkin_due", DEFAULT_COMMUNICATION_POLICY))
      .toBeLessThan(attentionWeightOf("upcoming_cash_pressure", DEFAULT_COMMUNICATION_POLICY));
  });

  it("J — a configuração salva é a configuração usada (sem teto oculto)", () => {
    const normalized = normalizeCommunicationPolicy({
      pilot_mode: true, high_priority_threshold: 40, critical_priority_threshold: 200,
      allow_high_priority_override: true, high_priority_kinds: ["debt_overdue"],
      cap_behavior: "defer", quiet_hours_high_priority_behavior: "immediate",
      attention_weights: { care: 1, informational: 3, financial: 9 },
      pilot_budget_multiplier: 7,
    });
    expect(normalized.high_priority_threshold).toBe(40);
    expect(normalized.pilot_budget_multiplier).toBe(7);
    expect(normalized.attention_weights.financial).toBe(9);
    const d = decideCommunication({
      candidate: candidate({ evidence: { priority_score: 45 } }),
      target: "app", preferences: prefs, history: fullHistory(), now, policy: normalized,
    });
    expect(d.allowed).toBe(true);
    expect(d.priority_band).toBe("high");
  });
});
