import { describe, expect, it } from "vitest";
import { decideCommunication, WHATSAPP_ALLOWED_KINDS, type CommunicationPreferences } from "../../supabase/functions/_shared/intelligence/communicationPolicy.ts";

const prefs: CommunicationPreferences = {
  proactive_financial: true,
  whatsapp_proactive: true,
  max_proactive_per_day: 1,
  max_proactive_per_week: 3,
  quiet_start: "21:00",
  quiet_end: "08:00",
  anticipation_enabled: true,
  anticipation_whatsapp: true,
};

function candidate(over: Partial<Parameters<typeof decideCommunication>[0]["candidate"]> = {}) {
  return {
    id: "c1",
    user_id: "u1",
    kind: "spending_spike",
    severity: "attention" as const,
    channel_ready: "both" as const,
    title: "t",
    body: "b",
    evidence: {},
    dedup_key: "k1",
    action: null,
    ...over,
  };
}

const now = new Date("2026-08-06T15:00:00-03:00");

describe("catálogo autorizado de WhatsApp", () => {
  it("permite apenas os tipos do catálogo", () => {
    for (const kind of WHATSAPP_ALLOWED_KINDS) {
      const d = decideCommunication({ candidate: candidate({ kind }), target: "whatsapp", preferences: prefs, history: [], now });
      expect(d.reason, kind).not.toBe("kind_not_in_whatsapp_catalog");
    }
  });

  it("bloqueia tipo fora do catálogo", () => {
    const d = decideCommunication({ candidate: candidate({ kind: "novo_tipo_qualquer" }), target: "whatsapp", preferences: prefs, history: [], now });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("kind_not_in_whatsapp_catalog");
  });

  it("respeita consentimento de antecipação", () => {
    const c = candidate({ kind: "upcoming_cash_pressure" });
    expect(decideCommunication({ candidate: c, target: "whatsapp", preferences: { ...prefs, anticipation_enabled: false }, history: [], now }).reason).toBe("anticipation_opt_out");
    expect(decideCommunication({ candidate: c, target: "whatsapp", preferences: { ...prefs, anticipation_whatsapp: false }, history: [], now }).reason).toBe("anticipation_whatsapp_opt_out");
    expect(decideCommunication({ candidate: c, target: "whatsapp", preferences: { ...prefs, anticipation_kinds: ["weekend_spending_risk"] }, history: [], now }).reason).toBe("anticipation_kind_disabled");
  });

  it("horário de silêncio impede envio e adia", () => {
    const late = new Date("2026-08-06T22:10:00-03:00");
    const d = decideCommunication({ candidate: candidate(), target: "whatsapp", preferences: prefs, history: [], now: late });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("quiet_hours");
    expect(d.temporary).toBe(true);
  });

  it("máximo diário de 1 impede a segunda comunicação do dia", () => {
    const history = [{ created_at: new Date("2026-08-06T09:00:00-03:00").toISOString(), kind: "goal_at_risk", channel: "whatsapp", status: "delivered", dedup_key: "outro" }];
    const d = decideCommunication({ candidate: candidate(), target: "whatsapp", preferences: prefs, history, now });
    expect(d.reason).toBe("daily_frequency_cap");
  });

  it("máximo semanal de 3 impede excesso", () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      created_at: new Date(now.getTime() - (i + 1) * 86_400_000).toISOString(),
      kind: `outro_${i}`, channel: "whatsapp", status: "delivered", dedup_key: `d${i}`,
    }));
    const d = decideCommunication({ candidate: candidate(), target: "whatsapp", preferences: prefs, history, now });
    expect(d.reason).toBe("weekly_frequency_cap");
  });

  it("tipo silenciado não é enviado", () => {
    const d = decideCommunication({ candidate: candidate(), target: "whatsapp", preferences: { ...prefs, muted_proactive_kinds: ["spending_spike"] }, history: [], now });
    expect(d.reason).toBe("kind_opt_out");
  });
});
