import { describe, expect, it } from "vitest";
import {
  emotionalReminderDue,
} from "../../supabase/functions/_shared/intelligence/emotionalReminder.ts";
import {
  parseEmotionFromText,
  resolveEmotionTerm,
} from "../../supabase/functions/_shared/intelligence/emotionParse.ts";
import { isCareKind } from "../../supabase/functions/_shared/intelligence/careKinds.ts";
import { decideCommunication } from "../../supabase/functions/_shared/intelligence/communicationPolicy.ts";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter.ts";
import { interpret } from "../../supabase/functions/_shared/agent/parser.ts";

const at = (iso: string) => new Date(iso);
const capability = (text: string) => classifyCapability(text, interpret(text), null);

describe("lembrete de humor", () => {
  it("é devido para quem só usa o WhatsApp, sem exigir uso do app", () => {
    const result = emotionalReminderDue({
      now: at("2026-08-18T23:30:00Z"), // 20h30 em São Paulo
      timezone: "America/Sao_Paulo",
      lastActivityAt: null,
      checkinDates: [],
      settings: { enabled: true, hour: 19, requiresActivity: false },
    });
    expect(result.due).toBe(true);
  });

  it("respeita a hora configurada no painel", () => {
    const result = emotionalReminderDue({
      now: at("2026-08-18T18:00:00Z"), // 15h em São Paulo
      timezone: "America/Sao_Paulo",
      checkinDates: [],
      settings: { enabled: true, hour: 21 },
    });
    expect(result.due).toBe(false);
    expect(result.reason).toBe("before_target_hour");
  });

  it("não repete quando já houve check-in no dia", () => {
    const result = emotionalReminderDue({
      now: at("2026-08-18T23:30:00Z"),
      timezone: "America/Sao_Paulo",
      checkinDates: ["2026-08-18T14:00:00Z"],
      settings: { enabled: true, hour: 19 },
    });
    expect(result.due).toBe(false);
    expect(result.reason).toBe("already_checked_in");
  });

  it("fica desligado quando o admin desativa", () => {
    const result = emotionalReminderDue({
      now: at("2026-08-18T23:30:00Z"),
      checkinDates: [],
      settings: { enabled: false },
    });
    expect(result.due).toBe(false);
  });
});

describe("leitura de sentimento em pt-BR", () => {
  it("entende sinônimos naturais", () => {
    expect(resolveEmotionTerm("ansioso")?.key).toBe("atento");
    expect(resolveEmotionTerm("cansada")?.key).toBe("frustrado");
    expect(parseEmotionFromText("hoje eu me senti bem tranquilo")?.key).toBe("tranquilo");
    expect(parseEmotionFromText("comprei no impulso e fiquei com culpa")?.key).toBe("culpado");
  });

  it("não invade frases sem sentimento", () => {
    expect(parseEmotionFromText("qual meu saldo hoje")).toBeNull();
  });
});

describe("roteamento do check-in", () => {
  it("manda registrar quando a pessoa conta como se sentiu", () => {
    const decision = capability("hoje eu fui ansioso");
    expect(decision.required_tool).toBe("log_emotional_checkin");
  });

  it("não confunde preocupação financeira com humor", () => {
    const decision = capability("estou preocupado com a fatura do cartão");
    expect(decision.required_tool).not.toBe("log_emotional_checkin");
  });
});

describe("cota separada de cuidado", () => {
  const prefs = { whatsapp_proactive: true, max_proactive_per_day: 1, max_proactive_per_week: 3 };
  const now = at("2026-08-18T15:00:00Z");
  const financialToday = [{
    created_at: "2026-08-18T13:00:00Z",
    kind: "debt_overdue",
    channel: "whatsapp",
    status: "delivered",
    dedup_key: "debt:1",
  }];

  it("marca o lembrete como comunicação de cuidado", () => {
    expect(isCareKind("emotional_checkin_due")).toBe(true);
    expect(isCareKind("debt_overdue")).toBe(false);
  });

  it("libera o lembrete mesmo com a cota financeira do dia consumida", () => {
    const decision = decideCommunication({
      candidate: {
        id: "1", kind: "emotional_checkin_due", severity: "info", dedup_key: "emo:2026-08-18",
      } as never,
      target: "whatsapp",
      preferences: prefs,
      history: financialToday,
      careQuota: { maxPerDay: 1, maxPerWeek: 4 },
      now,
    });
    expect(decision.allowed).toBe(true);
  });

  it("respeita a cota de cuidado configurada", () => {
    const decision = decideCommunication({
      candidate: {
        id: "1", kind: "emotional_checkin_due", severity: "info", dedup_key: "emo:2026-08-18",
      } as never,
      target: "whatsapp",
      preferences: prefs,
      history: financialToday,
      careQuota: { maxPerDay: 0, maxPerWeek: 4 },
      now,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("daily_frequency_cap");
  });
});
