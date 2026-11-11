import { beforeEach, describe, expect, it } from "vitest";
import { handleHabitReply, resetHabitGateCache, type HbSnapshotAs } from "../../supabase/functions/_shared/habits/whatsappReply";
import { crisisMatch, interpretQuitMessage, type QuitContext } from "../../supabase/functions/_shared/habits/quitInterpret";
import { habitReminders } from "../../supabase/functions/_shared/habits/reminders";

const base = { started_on: "2026-10-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_unit: null, quantity_period: null, rest_per_week: 1, cue_time: null, cue_text: null, minimum_text: null, status: "active" } as const;
const NOW = new Date("2026-11-10T18:00:00Z"); // 15:00 em São Paulo
const snap = (over: Partial<HbSnapshotAs> = {}): HbSnapshotAs => ({
  today: "2026-11-10", timezone: "America/Sao_Paulo", whatsapp_logging: true, nudges_enabled: true, max_nudges_per_day: 2,
  habits: [
    { ...base, id: "q1", title: "Delivery por impulso", kind: "quit", craving_plan: "esperar 10 minutos", sensitivity: "normal" },
    { ...base, id: "med", title: "Meditar 5 min", kind: "do_daily", cue_time: "07:30:00" },
  ],
  logs: [],
  cycles: [{ id: "c1", habit_id: "q1", started_on: "2026-10-31", ended_on: null, end_reason: null, baseline_daily_cost: 20, baseline_source: "user_informed" }],
  cravings: [], slips: [], automaticity: [], pauses: [],
  ...over,
});
function fakeDb(s: HbSnapshotAs | null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: fn === "hb_snapshot_as" ? s : fn === "hb_relapse_as" ? { started_on: "2026-11-10" } : "ok", error: null }; } };
}
const run = (db: ReturnType<typeof fakeDb>, text: string) => handleHabitReply(db, { userId: "u1", text, now: NOW });
beforeEach(() => resetHabitGateCache());

const ctx = (o: Partial<QuitContext> = {}): QuitContext => ({ quits: [{ id: "q1", title: "Delivery por impulso" }], openCravingHabitIds: [], noteOnlySlipHabitIds: [], autoPromptHabitId: null, ...o });

describe("interpretação de largar", () => {
  it("vontade: frase pura vale com um hábito; assunto alheio não", () => {
    expect(interpretQuitMessage("bateu vontade", ctx())).toEqual({ kind: "craving", habit_id: "q1" });
    expect(interpretQuitMessage("deu vontade de pedir delivery", ctx())).toEqual({ kind: "craving", habit_id: "q1" });
    expect(interpretQuitMessage("tenho vontade de viajar", ctx())).toBeNull();
  });
  it("recaída: só palavras fortes sem citar o hábito; 'falhei' solto não", () => {
    expect(interpretQuitMessage("cedi", ctx())).toEqual({ kind: "slip", habit_id: "q1" });
    expect(interpretQuitMessage("falhei no treino", ctx())).toBeNull();
    expect(interpretQuitMessage("falhei no delivery", ctx())).toEqual({ kind: "slip", habit_id: "q1" });
  });
  it("com dois hábitos e sem citar, pergunta qual", () => {
    const two = ctx({ quits: [{ id: "q1", title: "Delivery por impulso" }, { id: "q2", title: "Redes sociais antes de dormir" }] });
    expect(interpretQuitMessage("cedi", two)).toMatchObject({ kind: "quit_ask", what: "slip" });
  });
  it("resisti só vale com vontade aberta; recomeçar só depois de escorregão anotado", () => {
    expect(interpretQuitMessage("resisti", ctx())).toBeNull();
    expect(interpretQuitMessage("resisti", ctx({ openCravingHabitIds: ["q1"] }))).toEqual({ kind: "resisted", craving_habit_id: "q1" });
    expect(interpretQuitMessage("recomeçar", ctx())).toBeNull();
    expect(interpretQuitMessage("recomeçar", ctx({ noteOnlySlipHabitIds: ["q1"] }))).toEqual({ kind: "restart", habit_id: "q1" });
  });
  it("nota 1 a 7 só quando a pergunta foi enviada", () => {
    expect(interpretQuitMessage("5", ctx())).toBeNull();
    expect(interpretQuitMessage("5", ctx({ autoPromptHabitId: "med" }))).toEqual({ kind: "automaticity", habit_id: "med", score: 5 });
    expect(interpretQuitMessage("nota 7", ctx({ autoPromptHabitId: "med" }))).toMatchObject({ score: 7 });
    expect(interpretQuitMessage("8", ctx({ autoPromptHabitId: "med" }))).toBeNull();
  });
  it("crise: frases explícitas; 'morrer de rir' não", () => {
    expect(crisisMatch("não quero mais viver")).toBe(true);
    expect(crisisMatch("vou me matar")).toBe(true);
    expect(crisisMatch("quero morrer de rir")).toBe(false);
  });
});

describe("WhatsApp de largar", () => {
  it("vontade registra e devolve o plano da pessoa", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "bateu vontade");
    expect(r?.action).toBe("habit_craving");
    expect(r?.reply).toContain("esperar 10 minutos");
    expect(db.calls.find((c) => c.fn === "hb_craving_as")?.args).toMatchObject({ p_user: "u1", p_habit: "q1" });
  });
  it("escorregão só anota (sem zerar) e oferece recomeçar, sem culpa", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "cedi");
    expect(db.calls.find((c) => c.fn === "hb_relapse_as")?.args).toMatchObject({ p_reset: false });
    expect(r?.reply).toMatch(/sem culpa/i);
    expect(r?.reply).toContain("recomeçar");
  });
  it("recomeçar zera depois de um escorregão anotado nas últimas 24 h", async () => {
    const db = fakeDb(snap({ slips: [{ habit_id: "q1", local_date: "2026-11-10", reset: false, created_at: "2026-11-10T17:00:00Z" }] }));
    const r = await run(db, "recomeçar");
    expect(db.calls.find((c) => c.fn === "hb_relapse_as")?.args).toMatchObject({ p_reset: true });
    expect(r?.action).toBe("habit_restart");
  });
  it("'feito' não registra em hábito de largar: sem hábito de fazer pendente, não responde", async () => {
    const db = fakeDb(snap({ habits: [snap().habits[0]] }));
    expect(await run(db, "feito")).toBeNull();
    expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
  });
  it("crise recebe o apoio fixo mesmo sem hábitos de fazer", async () => {
    const r = await run(fakeDb(snap()), "não quero mais viver");
    expect(r?.action).toBe("habit_crisis_support");
    expect(r?.reply).toContain("188");
  });
  it("resumo dos hábitos inclui os dias sem", async () => {
    const r = await run(fakeDb(snap()), "como estão meus hábitos?");
    expect(r?.reply).toContain("Delivery por impulso: 10 dias sem");
  });
  it("nota de automaticidade grava quando a pergunta foi enviada e o hábito está na hora", async () => {
    const db = fakeDb(snap({ auto_prompt: { habit_id: "med", sent_at: "2026-11-10T14:00:00Z" } }));
    const r = await run(db, "6");
    expect(db.calls.find((c) => c.fn === "hb_automaticity_as")?.args).toMatchObject({ p_habit: "med", p_score: 6, p_skipped: false });
    expect(r?.action).toBe("habit_automaticity");
  });
});

describe("lembretes de F4", () => {
  const input = (s: HbSnapshotAs, now: Date, sentKeys: string[] = [], alreadySentToday = 0) => ({ snap: s, now, alreadySentToday, sentKeys: new Set(sentKeys), ignoredCueStreak: 0 });
  it("marco de dias sem (7) é reconhecido uma vez", () => {
    const s = snap({ cycles: [{ id: "c1", habit_id: "q1", started_on: "2026-11-03", ended_on: null, end_reason: null, baseline_daily_cost: null, baseline_source: null }] });
    const r = habitReminders(input(s, NOW));
    expect(r[0]).toMatchObject({ kind: "hb_streak_milestone", dedup_key: "hb-mile:q1:q7" });
    expect(habitReminders(input(s, NOW, ["hb-mile:q1:q7"])).filter((x) => x.kind === "hb_streak_milestone")).toEqual([]);
  });
  it("hábito sensível sem autorização não gera lembrete; com autorização a mensagem é discreta", () => {
    const sensitive = (consent: boolean) => snap({
      consent_sensitive: consent,
      habits: [{ ...base, id: "q1", title: "Cigarro", kind: "quit", sensitivity: "substance" }],
      cycles: [{ id: "c1", habit_id: "q1", started_on: "2026-11-03", ended_on: null, end_reason: null, baseline_daily_cost: null, baseline_source: null }],
    });
    expect(habitReminders(input(sensitive(false), NOW))).toEqual([]);
    const r = habitReminders(input(sensitive(true), NOW))[0];
    expect(r.body).not.toMatch(/cigarro/i);
    expect(r.title).not.toMatch(/cigarro/i);
  });
  it("automaticidade: pergunta aos 14 dias, uma vez por semana", () => {
    const s = snap({ habits: [{ ...base, id: "med", title: "Meditar 5 min", kind: "do_daily", started_on: "2026-10-01" }] });
    const r = habitReminders(input(s, NOW));
    expect(r[0]).toMatchObject({ kind: "hb_automaticity_due", dedup_key: "hb-auto:med:2026-11-10" });
    expect(habitReminders(input(s, NOW, ["hb-auto:med:2026-11-07"]))).toEqual([]);
  });
  it("manutenção não recebe lembrete de gatilho", () => {
    const logs = Array.from({ length: 30 }, (_, i) => ({ habit_id: "med", local_date: new Date(Date.UTC(2026, 9, 11 + i)).toISOString().slice(0, 10), status: "done" as const, quantity: null }));
    const auto = [1, 2, 3].map((n) => ({ habit_id: "med", answered_on: `2026-10-${10 + n * 5}`, score: 7, skipped: false }));
    const s = snap({ habits: [{ ...base, id: "med", title: "Meditar 5 min", kind: "do_daily", cue_time: "07:30:00", started_on: "2026-10-01" }], logs: logs.filter((l) => l.local_date < "2026-11-10"), automaticity: auto });
    expect(habitReminders(input(s, NOW)).filter((r) => r.kind === "hb_cue_reminder")).toEqual([]);
  });
});

describe("F5/F6: medido e revisão semanal", () => {
  const input = (s: HbSnapshotAs, now: Date, sentKeys: string[] = []) => ({ snap: s, now, alreadySentToday: 0, sentKeys: new Set(sentKeys), ignoredCueStreak: 0 });
  // domingo 2026-11-08, 19:00 em São Paulo
  const SUN = new Date("2026-11-08T22:00:00Z");
  const week = (): HbSnapshotAs => snap({
    today: "2026-11-08", habits: [{ ...base, id: "med", title: "Meditar 5 min", kind: "do_daily", cue_time: "07:30:00", started_on: "2026-10-01" }],
    logs: ["2026-11-02", "2026-11-03", "2026-11-04"].map((d) => ({ habit_id: "med", local_date: d, status: "done" as const, quantity: null })), cycles: [],
  });
  it("domingo à noite sai a revisão com os números marcados, uma vez por semana", () => {
    const r = habitReminders(input(week(), SUN));
    expect(r[0]).toMatchObject({ kind: "hb_weekly_review", dedup_key: "hb-review:2026-11-02" });
    expect(r[0].body).toContain("Meditar 5 min: 3 de 7 dias.");
    expect(habitReminders(input(week(), SUN, ["hb-review:2026-11-02"])).some((x) => x.kind === "hb_weekly_review")).toBe(false);
  });
  it("não sai fora do domingo nem para hábito sensível", () => {
    expect(habitReminders(input({ ...week(), today: "2026-11-07" }, new Date("2026-11-07T22:00:00Z"))).some((x) => x.kind === "hb_weekly_review")).toBe(false);
    const s = week(); s.habits[0] = { ...s.habits[0], sensitivity: "health" };
    expect(habitReminders(input({ ...s, consent_sensitive: true }, SUN)).some((x) => x.kind === "hb_weekly_review")).toBe(false);
  });
  it("hábito medido pelo Nino não recebe lembrete de gatilho", () => {
    const s = { ...week(), today: "2026-11-05", logs: [], auto_rules: [{ habit_id: "med", rule_type: "no_spend_category", category_id: "c", limit_amount: null }] };
    expect(habitReminders(input(s, new Date("2026-11-05T22:00:00Z"))).filter((x) => x.kind === "hb_cue_reminder")).toEqual([]);
  });
  it("marcação medida entra na contagem do resumo", async () => {
    const s = { ...week(), today: "2026-11-05", logs: [], auto_logs: [{ habit_id: "med", local_date: "2026-11-04", status: "done" as const, quantity: null, source: "auto" }] };
    const r = await handleHabitReply(fakeDb(s), { userId: "u1", text: "como estão meus hábitos?", now: new Date("2026-11-05T18:00:00Z") });
    expect(r?.reply).toBeTruthy();
  });
});

describe("M5: formas que o WhatsApp não marca", () => {
  it("projeto e rotina em passos não recebem 'feito' nem quantidade por mensagem", async () => {
    const s = snap({
      habits: [
        { ...base, id: "ler", title: "Ler", kind: "do_quantity", quantity_target: 10, quantity_unit: "páginas", quantity_period: "day", form: "project" },
        { ...base, id: "man", title: "Rotina da manhã", kind: "do_daily", form: "steps" },
      ],
      cycles: [],
    });
    const db = fakeDb(s);
    expect(await run(db, "li 12 páginas")).toBeNull();
    expect(await run(db, "feito")).toBeNull();
    expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
  });
  it("teto sem registro conta como dentro do limite e não gera lembrete pendente", () => {
    const s = snap({
      habits: [{ ...base, id: "tela", title: "Tempo de tela", kind: "do_quantity", quantity_target: 3, quantity_unit: "horas", quantity_period: "day", cue_time: "21:00:00", form: "ceiling", direction: "at_most", implicit_ok: true }],
      cycles: [],
    });
    const r = habitReminders({ snap: s, now: NOW, alreadySentToday: 0, sentKeys: new Set(), ignoredCueStreak: 0 });
    expect(r.filter((x) => x.kind === "hb_cue_reminder").length).toBeLessThanOrEqual(1);
  });
});
