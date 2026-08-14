import { describe, expect, it } from "vitest";
import { decideCommunication, type CommunicationPreferences } from "../../supabase/functions/_shared/intelligence/communicationPolicy.ts";
import { catalogAllowsChannel, resolveSuggestionDispatchState } from "../../supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts";

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
  it("usa o catálogo como fonte única para o canal", () => {
    expect(catalogAllowsChannel({
      kind: "debt_overdue", active: true, allowed_channels: ["app", "whatsapp"],
      default_channels: ["app", "whatsapp"], requires_manual_approval: false,
      min_severity_for_whatsapp: "attention",
    }, "whatsapp", "attention").ok).toBe(true);
  });

  it("bloqueia WhatsApp quando o catálogo não habilita o canal", () => {
    const gate = catalogAllowsChannel({
      kind: "editorial", active: true, allowed_channels: ["app"],
      default_channels: ["app"], requires_manual_approval: false,
      min_severity_for_whatsapp: "attention",
    }, "whatsapp", "attention");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("channel_disabled_in_catalog");
  });

  it("mantém pendente o WhatsApp adiado mesmo após entrega no app", () => {
    expect(resolveSuggestionDispatchState({
      anyQueued: true,
      deferUntil: "2026-08-07T11:00:00.000Z",
      awaitingApproval: false,
    })).toBe("deferred");
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
