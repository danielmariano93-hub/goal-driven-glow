import { describe, expect, it } from "vitest";
import { interpretHabitMessage, pastForms, titleStems, type HabitLite, type InterpretContext } from "../../supabase/functions/_shared/habits/interpret";

const H = (id: string, title: string, kind: HabitLite["kind"] = "do_daily", extra: Partial<HabitLite> = {}): HabitLite => ({
  id, title, kind, quantity_target: null, quantity_unit: null, cue_time: null, ...extra,
});
const med = H("med", "Meditar 5 min");
const cam = H("cam", "Caminhar 20 min");
const ler = H("ler", "Ler 10 páginas", "do_quantity", { quantity_target: 10, quantity_unit: "páginas" });
const agua = H("agua", "Beber 2 L de água", "do_quantity", { quantity_target: 2, quantity_unit: "litros" });
const dor = H("dor", "Dormir antes das 23h");
const trein = H("trein", "Treinar", "do_weekly_count");
const ALL = [med, cam, ler, agua, dor, trein];

const ctx = (over: Partial<InterpretContext> = {}): InterpretContext => ({
  habits: ALL, dueUnlogged: [], dueNow: [], recentWhatsappLog: false, ...over,
});
const run = (text: string, over: Partial<InterpretContext> = {}) => interpretHabitMessage(text, ctx(over));

describe("formas do nome do hábito", () => {
  it("passado de primeira pessoa e radicais", () => {
    expect(pastForms("Meditar 5 min")).toContain("meditei");
    expect(pastForms("Caminhar 20 min")).toContain("caminhei");
    expect(pastForms("Ler 10 páginas")).toContain("li");
    expect(pastForms("Beber 2 L de água")).toContain("bebi");
    expect(pastForms("Dormir antes das 23h")).toContain("dormi");
    expect(titleStems("Ler 10 páginas")).toEqual(["pagin"]);
    expect(titleStems("Meditar 5 min")).toEqual(["medit"]);
  });
});

describe("registrar pelo nome do hábito", () => {
  it("forma verbal no passado vira 'feito'", () => {
    expect(run("meditei")).toEqual({ kind: "log", habit_id: "med", status: "done", day: "today" });
    expect(run("Caminhei hoje de manhã")).toMatchObject({ kind: "log", habit_id: "cam", status: "done" });
    expect(run("treinei hoje 40 min")).toMatchObject({ kind: "log", habit_id: "trein", status: "done" });
    expect(run("dormi cedo")).toMatchObject({ kind: "log", habit_id: "dor", status: "done" });
  });
  it("quantidade quando o hábito é de quantidade e há número", () => {
    expect(run("li 12 páginas")).toEqual({ kind: "log", habit_id: "ler", status: "quantity", quantity: 12, day: "today" });
    expect(run("bebi 1,5 litros")).toMatchObject({ kind: "log", habit_id: "agua", status: "quantity", quantity: 1.5 });
    expect(run("li hoje")).toMatchObject({ kind: "log", habit_id: "ler", status: "done" });
  });
  it("ontem muda o dia", () => {
    expect(run("caminhei ontem")).toMatchObject({ habit_id: "cam", day: "yesterday" });
  });
  it("não fiz, folga e versão mínima com o nome do hábito", () => {
    expect(run("não consegui meditar")).toMatchObject({ habit_id: "med", status: "skipped" });
    expect(run("folga de caminhar hoje")).toMatchObject({ habit_id: "cam", status: "rest" });
    expect(run("fiz o mínimo de meditação")).toMatchObject({ habit_id: "med", status: "minimum" });
    expect(run("fiz a caminhada")).toMatchObject({ habit_id: "cam", status: "done" });
  });
  it("empate entre hábitos vira pergunta, nunca palpite", () => {
    const r = interpretHabitMessage("meditei", ctx({ habits: [med, H("med2", "Meditar à noite")] }));
    expect(r).toMatchObject({ kind: "ask", status: "done" });
    expect((r as { candidates: string[] }).candidates.sort()).toEqual(["med", "med2"]);
  });
});

describe("gatilho curto, sem nome de hábito", () => {
  it("aplica-se ao único hábito pendente", () => {
    expect(run("feito", { dueUnlogged: ["cam"], dueNow: ["cam"] })).toEqual({ kind: "log", habit_id: "cam", status: "done", day: "today" });
    expect(run("ok, feito!", { dueUnlogged: ["cam"], dueNow: ["cam"] })).toMatchObject({ habit_id: "cam", status: "done" });
    expect(run("hoje não", { dueUnlogged: ["dor"], dueNow: [] })).toMatchObject({ habit_id: "dor", status: "skipped" });
    expect(run("só o mínimo", { dueUnlogged: ["med"], dueNow: ["med"] })).toMatchObject({ habit_id: "med", status: "minimum" });
  });
  it("prefere o que já passou do horário do gatilho", () => {
    expect(run("feito", { dueUnlogged: ["med", "dor"], dueNow: ["med"] })).toMatchObject({ habit_id: "med" });
  });
  it("vários pendentes: pergunta qual", () => {
    expect(run("feito", { dueUnlogged: ["med", "cam"], dueNow: ["med", "cam"] })).toMatchObject({ kind: "ask", status: "done" });
  });
  it("sem pendência não adivinha", () => {
    expect(run("feito")).toBeNull();
    expect(run("hoje não")).toBeNull();
  });
  it("frase com outro assunto não é gatilho", () => {
    expect(run("fiz a transferência", { dueUnlogged: ["cam"], dueNow: ["cam"] })).toBeNull();
    expect(run("já fiz isso com o contador", { dueUnlogged: ["cam"], dueNow: ["cam"] })).toBeNull();
  });
});

describe("consulta e desfazer", () => {
  it("resumo dos hábitos, mesmo em forma de pergunta", () => {
    expect(run("como estão meus hábitos?")).toEqual({ kind: "status" });
    expect(run("o que falta hoje")).toEqual({ kind: "status" });
    expect(run("meus hábitos")).toEqual({ kind: "status" });
  });
  it("desfaz só logo depois de um registro feito pelo WhatsApp", () => {
    expect(run("desfaz", { recentWhatsappLog: true })).toEqual({ kind: "undo" });
    expect(run("foi engano", { recentWhatsappLog: true })).toEqual({ kind: "undo" });
    expect(run("desfaz")).toBeNull();
  });
});

describe("falha fechada: o que NÃO deve virar hábito", () => {
  it("dinheiro fica com o agente", () => {
    expect(run("caminhei até o mercado e paguei 30")).toBeNull();
    expect(run("gastei 40 depois de treinar")).toBeNull();
    expect(run("li o contrato, quanto é a fatura?")).toBeNull();
  });
  it("pergunta e frase longa", () => {
    expect(run("você já meditou hoje?")).toBeNull();
    expect(run("meditei e depois fui ao trabalho, almocei com a equipe, voltei para casa, jantei, estudei bastante e fui dormir tarde, foi um dia longo demais")).toBeNull();
  });
  it("substantivo solto e forma negada", () => {
    expect(run("água")).toBeNull();
    expect(run("tomei água")).toBeNull();
    expect(run("dormi mal")).toBeNull();
    expect(run("li pouco")).toBeNull();
  });
  it("sem hábitos ativos", () => {
    expect(interpretHabitMessage("meditei", ctx({ habits: [] }))).toBeNull();
    expect(interpretHabitMessage("feito", ctx({ habits: [] }))).toBeNull();
  });
  it("conversa normal não vira hábito", () => {
    for (const t of ["oi", "bom dia", "qual meu saldo", "quanto gastei esse mês", "obrigado", "sim", "não"]) expect(run(t, { dueUnlogged: ["cam"], dueNow: ["cam"] }), t).toBeNull();
  });
});
