import { describe, expect, it } from "vitest";
import { habitReminders, IGNORED_STOP, type ReminderInput } from "../../supabase/functions/_shared/habits/reminders";
import { habitSuggestions } from "../../supabase/functions/_shared/habits/reminderSuggestions";
import type { HbSnapshotAs } from "../../supabase/functions/_shared/habits/whatsappReply";
import { decideCommunication, scopeOf, type CommunicationPreferences } from "../../supabase/functions/_shared/intelligence/communicationPolicy";
import { isHabitKind } from "../../supabase/functions/_shared/intelligence/habitKinds";
import { OPERATIONAL_KINDS } from "../../supabase/functions/_shared/agent/narrative/TonePolicy";
import { isRoutine } from "../../supabase/functions/_shared/proactive/pillars";

const habit = (over: Partial<HbSnapshotAs["habits"][number]> & { id: string; title: string }): HbSnapshotAs["habits"][number] => ({
  kind: "do_daily", started_on: "2026-11-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_unit: null,
  quantity_period: null, rest_per_week: 1, cue_time: null, cue_text: null, minimum_text: null, ...over,
});
const MED = habit({ id: "med", title: "Meditar 5 min", cue_time: "07:30:00", cue_text: "Depois do café" });
const CAM = habit({ id: "cam", title: "Caminhar 20 min", cue_time: "12:30:00", cue_text: "Depois do almoço" });
const DOR = habit({ id: "dor", title: "Dormir antes das 23h", cue_time: "22:00:00", cue_text: "Depois de escovar os dentes" });
const snap = (over: Partial<HbSnapshotAs> = {}): HbSnapshotAs => ({
  today: "2026-11-10", timezone: "America/Sao_Paulo", whatsapp_logging: true, nudges_enabled: true, max_nudges_per_day: 2,
  habits: [MED, CAM], logs: [], ...over,
});
/** Horário local (São Paulo, UTC-3) em 10/11/2026. */
const at = (hhmm: string) => new Date(Date.UTC(2026, 10, 10, Number(hhmm.slice(0, 2)) + 3, Number(hhmm.slice(3, 5))));
const input = (hhmm: string, over: Partial<ReminderInput> = {}): ReminderInput => ({
  snap: snap(), now: at(hhmm), alreadySentToday: 0, sentKeys: new Set(), ignoredCueStreak: 0, ...over,
});

describe("lembrete do gatilho", () => {
  it("só depois do horário do gatilho + 90 minutos", () => {
    expect(habitReminders(input("08:50"))).toEqual([]); // 07:30 + 90 = 09:00
    const r = habitReminders(input("09:00"));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "hb_cue_reminder", dedup_key: "hb-cue:2026-11-10:am", title: "Meditar 5 min" });
    expect(r[0].body).toBe('Depois do café: Meditar 5 min. Já fez? Responda "feito", "mínimo" ou "hoje não".');
  });
  it("não lembra de hábito que já foi registrado hoje", () => {
    const s = snap({ logs: [{ habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] });
    expect(habitReminders(input("10:00", { snap: s }))).toEqual([]);
  });
  it("folga de hoje também silencia", () => {
    const s = snap({ logs: [{ habit_id: "med", local_date: "2026-11-10", status: "rest", quantity: null }] });
    expect(habitReminders(input("10:00", { snap: s }))).toEqual([]);
  });
  it("hábito sem horário de gatilho não gera lembrete", () => {
    const s = snap({ habits: [habit({ id: "x", title: "Ler 10 páginas" })] });
    expect(habitReminders(input("15:00", { snap: s }))).toEqual([]);
  });
  it("hábito que ainda não começou ou não é previsto hoje não gera lembrete", () => {
    expect(habitReminders(input("10:00", { snap: snap({ habits: [habit({ id: "a", title: "Meditar", cue_time: "07:30:00", started_on: "2026-11-11" })] }) }))).toEqual([]);
    expect(habitReminders(input("10:00", { snap: snap({ habits: [habit({ id: "a", title: "Meditar", cue_time: "07:30:00", days_of_week: [0, 6] })] }) }))).toEqual([]); // terça
  });
  it("junta os pendentes do mesmo horário do dia em uma única mensagem", () => {
    const a = habit({ id: "a", title: "Meditar 5 min", cue_time: "07:30:00" });
    const b = habit({ id: "b", title: "Alongar", cue_time: "08:00:00" });
    const r = habitReminders(input("10:00", { snap: snap({ habits: [a, b] }) }));
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("Seus hábitos");
    expect(r[0].body).toBe('Faltam: Meditar 5 min, Alongar. Já fez algum? Responda, por exemplo, "fiz meditar 5 min".');
  });
  it("um lembrete por horário do dia, por chave", () => {
    expect(habitReminders(input("10:00", { sentKeys: new Set(["hb-cue:2026-11-10:am"]) }))).toEqual([]);
    const r = habitReminders(input("14:30", { sentKeys: new Set(["hb-cue:2026-11-10:am"]), snap: snap({ logs: [{ habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] }) }));
    expect(r[0]).toMatchObject({ dedup_key: "hb-cue:2026-11-10:pm", title: "Caminhar 20 min" });
  });
  it("nunca depois das 22h", () => {
    expect(habitReminders(input("22:30", { snap: snap({ habits: [DOR] }) }))).toEqual([]);
  });
});

describe("orçamento e parada automática", () => {
  it("respeita o máximo diário da pessoa e o teto de 3", () => {
    expect(habitReminders(input("10:00", { alreadySentToday: 2 }))).toEqual([]);
    expect(habitReminders(input("10:00", { alreadySentToday: 1 }))).toHaveLength(1);
    expect(habitReminders(input("10:00", { snap: snap({ max_nudges_per_day: 0 }) }))).toEqual([]);
    expect(habitReminders(input("10:00", { snap: snap({ max_nudges_per_day: 9 }), alreadySentToday: 3 }))).toEqual([]);
  });
  it("lembretes desligados não geram nada", () => {
    expect(habitReminders(input("10:00", { snap: snap({ nudges_enabled: false }) }))).toEqual([]);
  });
  it(`${IGNORED_STOP} lembretes seguidos ignorados param os lembretes do gatilho`, () => {
    expect(habitReminders(input("10:00", { ignoredCueStreak: 2 }))).toHaveLength(1);
    expect(habitReminders(input("10:00", { ignoredCueStreak: 3 }))).toEqual([]);
  });
  it("mas quem registrou algo nas últimas 24 h não está ignorando", () => {
    const s = snap({ logs: [{ habit_id: "cam", local_date: "2026-11-09", status: "done", quantity: null, logged_at: "2026-11-09T20:00:00Z" }] });
    expect(habitReminders(input("10:00", { snap: s, ignoredCueStreak: 5 }))).toHaveLength(1);
  });
});

describe("resumo do fim do dia", () => {
  it("só com 2 hábitos previstos, pendência e dentro da janela 21:30–23:00", () => {
    const s = snap({ logs: [{ habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }], habits: [MED, habit({ id: "cam", title: "Caminhar 20 min" })] });
    expect(habitReminders(input("21:00", { snap: s }))).toEqual([]);
    const r = habitReminders(input("21:40", { snap: s }));
    expect(r[0]).toMatchObject({ kind: "hb_daily_recap", dedup_key: "hb-recap:2026-11-10", body: "Hoje: 1 de 2. Falta: Caminhar 20 min." });
    expect(habitReminders(input("23:30", { snap: s }))).toEqual([]);
  });
  it("com tudo feito ou um hábito só não manda resumo", () => {
    const all = snap({ logs: [{ habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }, { habit_id: "cam", local_date: "2026-11-10", status: "done", quantity: null }] });
    expect(habitReminders(input("21:40", { snap: all }))).toEqual([]);
    expect(habitReminders(input("21:40", { snap: snap({ habits: [habit({ id: "a", title: "Meditar" })] }) }))).toEqual([]);
  });
  it("uma vez por dia", () => {
    const s = snap({ habits: [habit({ id: "a", title: "Meditar" }), habit({ id: "b", title: "Caminhar" })] });
    expect(habitReminders(input("21:40", { snap: s, sentKeys: new Set(["hb-recap:2026-11-10"]) }))).toEqual([]);
  });
});

describe("cola com o motor proativo", () => {
  const NOW = at("10:00");
  function fakeDb(snapshot: HbSnapshotAs | null, deliveries: Array<Record<string, unknown>> = []) {
    return {
      rpc: async () => ({ data: snapshot, error: null }),
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "gte", "order"]) chain[m] = () => chain;
        chain.limit = async () => ({ data: deliveries, error: null });
        return chain;
      },
    };
  }
  it("quem não tem Hábitos recebe []", async () => {
    expect(await habitSuggestions(fakeDb(null), "u1", NOW)).toEqual([]);
  });
  it("gera sugestão no formato do motor, com validade e rota", async () => {
    const out = await habitSuggestions(fakeDb(snap()), "u1", NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ user_id: "u1", kind: "hb_cue_reminder", severity: "info", channel_ready: "both", action: { type: "habit_reminder", route: "/h/hoje" }, dedup_key: "hb-cue:2026-11-10:am" });
    expect(Date.parse(out[0].expires_at)).toBeGreaterThan(NOW.getTime());
  });
  it("já entregue hoje no mesmo horário: não repete; e conta no orçamento do dia", async () => {
    const delivered = [{ kind: "hb_cue_reminder", dedup_key: "hb-cue:2026-11-10:am", status: "delivered", interacted_at: null, created_at: "2026-11-10T11:00:00Z" }];
    expect(await habitSuggestions(fakeDb(snap(), delivered), "u1", NOW)).toEqual([]);
  });
  it("três lembretes antigos ignorados param o lembrete", async () => {
    const old = (d: string) => ({ kind: "hb_cue_reminder", dedup_key: `hb-cue:${d}:am`, status: "delivered", interacted_at: null, created_at: `${d}T11:00:00Z` });
    const out = await habitSuggestions(fakeDb(snap(), [old("2026-11-09"), old("2026-11-08"), old("2026-11-07")]), "u1", NOW);
    expect(out).toEqual([]);
  });
  it("uma resposta recente zera a conta de ignorados", async () => {
    const mk = (d: string, interacted: string | null) => ({ kind: "hb_cue_reminder", dedup_key: `hb-cue:${d}:am`, status: "delivered", interacted_at: interacted, created_at: `${d}T11:00:00Z` });
    const out = await habitSuggestions(fakeDb(snap(), [mk("2026-11-09", "2026-11-09T11:30:00Z"), mk("2026-11-08", null), mk("2026-11-07", null)]), "u1", NOW);
    expect(out).toHaveLength(1);
  });
  it("erro no banco nunca derruba o motor", async () => {
    const boom = { rpc: async () => { throw new Error("db down"); }, from: () => ({}) };
    expect(await habitSuggestions(boom as never, "u1", NOW)).toEqual([]);
  });
});

describe("política de envio: Hábitos tem escopo próprio, o resto não muda", () => {
  const prefs: CommunicationPreferences = {
    proactive_financial: false, emotional_checkin: true, smart_tips: true, whatsapp_proactive: true,
    quiet_start: "21:00", quiet_end: "08:00", max_proactive_per_week: 3, max_proactive_per_day: 1, muted_proactive_kinds: [], timezone: "America/Sao_Paulo",
  } as CommunicationPreferences;
  const cand = (kind: string, dedup: string) => ({ id: dedup, user_id: "u1", kind, severity: "info" as const, title: "t", body: "b", channel_ready: "both" as const, dedup_key: dedup, evidence: {} });
  const row = (kind: string, dedup: string, whenIso: string, channel: "app" | "whatsapp" = "whatsapp") => ({ created_at: whenIso, kind, channel, status: "delivered" as const, dedup_key: dedup });
  const now = new Date("2026-11-10T15:00:00Z"); // 12:00 em São Paulo

  it("tipos de hábito são reconhecidos e têm escopo 'habit'", () => {
    expect(isHabitKind("hb_cue_reminder")).toBe(true);
    expect(scopeOf("hb_daily_recap")).toBe("habit");
    expect(scopeOf("emotional_checkin_due")).toBe("care");
    expect(scopeOf("goal_at_risk")).toBe("financial");
  });
  it("não dependem do consentimento de insight financeiro", () => {
    const d = decideCommunication({ candidate: cand("hb_cue_reminder", "hb-cue:2026-11-10:am"), target: "whatsapp", preferences: prefs, history: [], now });
    expect(d.allowed).toBe(true);
    const fin = decideCommunication({ candidate: cand("goal_at_risk", "g1"), target: "whatsapp", preferences: prefs, history: [], now });
    expect(fin.allowed).toBe(false);
    expect(fin.reason).toBe("financial_opt_out");
  });
  it("até 3 mensagens de hábito por dia passam (chaves diferentes); a 4ª bate no teto", () => {
    const p = { ...prefs, proactive_financial: true };
    const rows = [
      row("hb_cue_reminder", "hb-cue:2026-11-10:am", "2026-11-10T11:30:00Z"),
      row("hb_cue_reminder", "hb-cue:2026-11-10:pm", "2026-11-10T14:00:00Z"),
    ];
    expect(decideCommunication({ candidate: cand("hb_daily_recap", "hb-recap:2026-11-10"), target: "whatsapp", preferences: p, history: rows, now }).allowed).toBe(true);
    const three = [...rows, row("hb_daily_recap", "hb-recap:2026-11-10", "2026-11-10T14:30:00Z")];
    const fourth = decideCommunication({ candidate: cand("hb_cue_reminder", "hb-cue:2026-11-10:ev"), target: "whatsapp", preferences: p, history: three, now });
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("daily_frequency_cap");
  });
  it("a mesma chave não repete (dedup) e o horário de silêncio continua valendo", () => {
    const h = [row("hb_cue_reminder", "hb-cue:2026-11-10:am", "2026-11-10T11:30:00Z")];
    expect(decideCommunication({ candidate: cand("hb_cue_reminder", "hb-cue:2026-11-10:am"), target: "whatsapp", preferences: prefs, history: h, now }).reason).toBe("dedup_key_14d");
    const night = new Date("2026-11-11T01:30:00Z"); // 22:30 em São Paulo
    expect(decideCommunication({ candidate: cand("hb_daily_recap", "hb-recap:2026-11-10"), target: "whatsapp", preferences: prefs, history: [], now: night }).reason).toBe("quiet_hours");
  });
  it("lembretes de hábito não consomem a cota dos alertas financeiros, e vice-versa", () => {
    const habitRows = [row("hb_cue_reminder", "hb-cue:2026-11-10:am", "2026-11-10T11:30:00Z")];
    const fin = decideCommunication({ candidate: cand("goal_at_risk", "g1"), target: "whatsapp", preferences: { ...prefs, proactive_financial: true }, history: habitRows, now });
    expect(fin.allowed).toBe(true);
    const finRows = [row("goal_at_risk", "g0", "2026-11-10T11:00:00Z")];
    const habit = decideCommunication({ candidate: cand("hb_cue_reminder", "hb-cue:2026-11-10:pm"), target: "whatsapp", preferences: prefs, history: finRows, now });
    expect(habit.allowed).toBe(true);
  });
  it("o texto é fixo (nunca passa pela camada de linguagem) e a rotina não disputa cota de pilar", () => {
    expect(OPERATIONAL_KINDS.has("hb_cue_reminder")).toBe(true);
    expect(OPERATIONAL_KINDS.has("hb_daily_recap")).toBe(true);
    expect(isRoutine("hb_cue_reminder")).toBe(true);
  });
});
