import { beforeEach, describe, expect, it } from "vitest";
import { handleHabitReply, localMinutes, resetHabitGateCache, type HbSnapshotAs } from "../../supabase/functions/_shared/habits/whatsappReply";

const habit = (over: Partial<HbSnapshotAs["habits"][number]> & { id: string; title: string }): HbSnapshotAs["habits"][number] => ({
  kind: "do_daily", started_on: "2026-11-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_unit: null,
  quantity_period: null, rest_per_week: 1, cue_time: null, cue_text: null, minimum_text: null, ...over,
});

const snap = (over: Partial<HbSnapshotAs> = {}): HbSnapshotAs => ({
  today: "2026-11-10", timezone: "America/Sao_Paulo", whatsapp_logging: true, nudges_enabled: true, max_nudges_per_day: 2,
  habits: [
    habit({ id: "med", title: "Meditar 5 min", cue_time: "07:30:00", minimum_text: "3 respirações" }),
    habit({ id: "cam", title: "Caminhar 20 min", cue_time: "12:30:00" }),
    habit({ id: "ler", title: "Ler 10 páginas", kind: "do_quantity", quantity_target: 10, quantity_unit: "páginas", quantity_period: "day" }),
  ],
  logs: [
    { habit_id: "med", local_date: "2026-11-07", status: "done", quantity: null }, { habit_id: "med", local_date: "2026-11-08", status: "done", quantity: null },
    { habit_id: "med", local_date: "2026-11-09", status: "done", quantity: null },
  ],
  ...over,
});

type Call = { fn: string; args: Record<string, unknown> };
function fakeDb(snapshot: HbSnapshotAs | null, opts: { logError?: string } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "hb_snapshot_as") return { data: snapshot, error: null };
      if (fn === "hb_log_as" && opts.logError) return { data: null, error: { message: opts.logError } };
      return { data: "ok", error: null };
    },
  };
}
// 15:00 em São Paulo (18:00 UTC): os dois hábitos com horário já passaram do gatilho.
const NOW = new Date("2026-11-10T18:00:00Z");
const run = (db: ReturnType<typeof fakeDb>, text: string, extra: Record<string, unknown> = {}) =>
  handleHabitReply(db, { userId: "u1", text, now: NOW, ...extra });

beforeEach(() => resetHabitGateCache());

describe("hora local", () => {
  it("minutos desde 00:00 no fuso da pessoa", () => {
    expect(localMinutes(new Date("2026-11-10T18:00:00Z"), "America/Sao_Paulo")).toBe(15 * 60);
    expect(localMinutes(new Date("2026-11-10T02:30:00Z"), "America/Sao_Paulo")).toBe(23 * 60 + 30);
    expect(localMinutes(new Date("2026-11-10T18:00:00Z"), "fuso/invalido")).toBe(18 * 60);
  });
});

describe("portão: só quem tem Hábitos", () => {
  it("sem liberação devolve null e não consulta de novo por 2 minutos", async () => {
    const db = fakeDb(null);
    expect(await run(db, "meditei")).toBeNull();
    expect(await run(db, "meditei")).toBeNull();
    expect(db.calls.filter((c) => c.fn === "hb_snapshot_as")).toHaveLength(1);
    expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
  });
  it("marcar pelo WhatsApp desligado ou sem hábitos ativos devolve null", async () => {
    expect(await run(fakeDb(snap({ whatsapp_logging: false })), "meditei")).toBeNull();
    expect(await run(fakeDb(snap({ habits: [] })), "meditei")).toBeNull();
  });
  it("erro ao consultar propaga (o webhook cai no caminho normal)", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(run(db as never, "meditei")).rejects.toThrow(/hb_snapshot_as/);
  });
});

describe("marcar", () => {
  it("'meditei' grava feito com origem WhatsApp e idempotência, e responde com sequência e contagem", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "meditei", { idempotencyKey: "in-1" });
    const call = db.calls.find((c) => c.fn === "hb_log_as")!;
    expect(call.args).toMatchObject({ p_user: "u1", p_habit: "med", p_date: "2026-11-10", p_status: "done", p_source: "whatsapp", p_idem: "in-1:med" });
    expect(r?.action).toBe("habit_log_done");
    expect(r?.reply).toMatch(/Marcado: Meditar 5 min\./);
    expect(r?.reply).toMatch(/4 dias seguidos\./); // 07, 08, 09 + hoje
    expect(r?.reply).toMatch(/Hoje: 1 de 3\./);
    expect(r?.reply).toMatch(/desfaz/);
  });
  it("quantidade: li 12 páginas bate a meta", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "li 12 páginas");
    expect(db.calls.find((c) => c.fn === "hb_log_as")!.args).toMatchObject({ p_habit: "ler", p_status: "quantity", p_quantity: 12 });
    expect(r?.reply).toMatch(/12 páginas em Ler 10 páginas\. Meta batida/);
  });
  it("quantidade abaixo da meta diz quanto falta", async () => {
    const r = await run(fakeDb(snap()), "li 4 páginas");
    expect(r?.reply).toMatch(/4 de 10 páginas.*Faltam 6/);
  });
  it("'feito' sem nome com dois pendentes não grava nada", async () => {
    const s = snap({ logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] });
    const db = fakeDb(s);
    await run(db, "feito");
    // med já feito hoje; cam (12:30) e ler (sem horário) estão pendentes e passaram do horário → são 2 → pergunta
    expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
  });
  it("'feito' com um único pendente grava nele", async () => {
    const s = snap({ habits: snap().habits.slice(0, 2), logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] });
    const db = fakeDb(s);
    const r = await run(db, "feito");
    expect(db.calls.find((c) => c.fn === "hb_log_as")!.args).toMatchObject({ p_habit: "cam", p_status: "done" });
    expect(r?.reply).toMatch(/Marcado: Caminhar 20 min/);
  });
  it("hoje não e versão mínima têm texto sem culpa", async () => {
    const s = snap({ habits: [snap().habits[0]] });
    const skip = await run(fakeDb(s), "hoje não");
    expect(skip?.reply).toMatch(/não rolou\. Sem culpa/);
    const min = await run(fakeDb(s), "só o mínimo");
    expect(min?.reply).toMatch(/versão mínima de Meditar 5 min \(3 respirações\)\. Conta como feito/);
  });
  it("ontem grava no dia anterior", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "caminhei ontem");
    expect(db.calls.find((c) => c.fn === "hb_log_as")!.args).toMatchObject({ p_habit: "cam", p_date: "2026-11-09" });
    expect(r?.reply).toMatch(/Marcado de ontem: Caminhar 20 min/);
  });
  it("vários pendentes: pergunta qual, sem gravar", async () => {
    const db = fakeDb(snap());
    const r = await run(db, "feito");
    expect(r?.action).toBe("habit_ask");
    expect(r?.reply).toMatch(/Qual hábito\? Meditar 5 min, Caminhar 20 min, Ler 10 páginas/);
    expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
  });
});

describe("regras do servidor viram mensagem amigável", () => {
  it("folgas esgotadas", async () => {
    const db = fakeDb(snap(), { logError: "rest_budget_exhausted" });
    const r = await run(db, "folga de meditar");
    expect(r).toEqual({ action: "habit_rejected", reply: expect.stringMatching(/folgas desta semana de Meditar 5 min acabaram/) });
  });
  it("janela de 7 dias fechada", async () => {
    const r = await run(fakeDb(snap(), { logError: "edit_window_closed" }), "meditei");
    expect(r?.reply).toMatch(/últimos 7 dias/);
  });
  it("erro inesperado propaga (o webhook cai no caminho normal)", async () => {
    await expect(run(fakeDb(snap(), { logError: "deadlock detected" }), "meditei")).rejects.toThrow(/hb_log_as/);
  });
});

describe("consultar e desfazer", () => {
  it("resumo do dia", async () => {
    const s = snap({ logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] });
    const r = await run(fakeDb(s), "como estão meus hábitos?");
    expect(r?.action).toBe("habit_status");
    expect(r?.reply).toBe("Hoje: 1 de 3.\nFeitos: Meditar 5 min.\nFalta: Caminhar 20 min, Ler 10 páginas.");
  });
  it("tudo marcado", async () => {
    const s = snap({ habits: [snap().habits[0]], logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null }] });
    expect((await run(fakeDb(s), "meus hábitos"))?.reply).toMatch(/Hoje: 1 de 1\.\nFeitos: Meditar 5 min\.\nTudo marcado por hoje\./);
  });
  it("desfaz apaga o último registro feito pelo WhatsApp há menos de 15 minutos", async () => {
    const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const s = snap({ logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null, source: "whatsapp", logged_at: recent }] });
    const db = fakeDb(s);
    const r = await run(db, "desfaz");
    expect(db.calls.find((c) => c.fn === "hb_unlog_as")!.args).toMatchObject({ p_habit: "med", p_date: "2026-11-10" });
    expect(r?.reply).toMatch(/Desfeito: Meditar 5 min/);
  });
  it("desfaz não mexe em registro antigo nem em registro feito pelo app", async () => {
    const old = new Date(NOW.getTime() - 40 * 60_000).toISOString();
    const s = snap({ logs: [...snap().logs, { habit_id: "med", local_date: "2026-11-10", status: "done", quantity: null, source: "whatsapp", logged_at: old }] });
    const db = fakeDb(s);
    expect(await run(db, "desfaz")).toBeNull();
    expect(db.calls.some((c) => c.fn === "hb_unlog_as")).toBe(false);
  });
});

describe("conversa normal segue para o agente", () => {
  it("dinheiro, perguntas e saudações não viram hábito", async () => {
    for (const t of ["qual meu saldo?", "gastei 40 no mercado", "bom dia", "obrigado", "quanto gastei esse mês"]) {
      const db = fakeDb(snap());
      expect(await run(db, t), t).toBeNull();
      expect(db.calls.some((c) => c.fn === "hb_log_as")).toBe(false);
    }
  });
});
