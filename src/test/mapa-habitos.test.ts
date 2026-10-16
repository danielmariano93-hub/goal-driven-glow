import { describe, it, expect } from "vitest";
import { buildMapaReading } from "@/lib/engine/mapaReading";
import { validateMapaReading, type MapaReading } from "@/lib/engine/mapaContracts";
import type { MapaMonthlyEntry } from "@/lib/engine/mapaMonthly";
import type { MapaCommitmentPeriod, MapaHabitInputs, MapaHealthInputs, MapaQuestionRow } from "@/lib/engine/mapaInputs";
import { monthlyGoalContributions } from "@/lib/engine/mapaPlanejamento";
import { scheduleQuestions } from "@/lib/engine/mapaQuestions";

const ASOF = "2026-10-16";
const NOW = "2026-10-16T15:00:00Z";
const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
const month = (ym: string, income: number, spend: Array<[string | null, number]>): MapaMonthlyEntry[] => [
  { date: `${ym}-05`, kind: "income", amount: income },
  ...spend.map(([cat, amount], i): MapaMonthlyEntry => ({ date: `${ym}-${String(10 + i).padStart(2, "0")}`, kind: "expense", amount, category_id: cat })),
];
const steady = (income = 8000) => MONTHS.flatMap((m) => month(m, income, [["c-moradia", 3000], ["c-lazer", 1000]]));
const run = (entries: MapaMonthlyEntry[], habits: Partial<MapaHabitInputs> = {}, health: Partial<MapaHealthInputs> = {}): MapaReading =>
  buildMapaReading({ asOf: ASOF, entries, habits, health, nowIso: NOW });
const ind = (r: MapaReading, id: string) => r.indicators.find((x) => x.id === id)!;
const goal = (period: string, status: MapaCommitmentPeriod["status"], key = "c-lazer"): MapaCommitmentPeriod => ({ key, period, status });

describe("Execução (E6)", () => {
  it("menos de 3 períodos comparáveis: sem dados, dizendo o que falta", () => {
    const r = run(steady(), { goalPeriods: [goal("2026-08", "cumprido"), goal("2026-09", "estourado")] });
    expect(ind(r, "execucao.aderencia")).toMatchObject({ status: "sem_dados", needs: { kind: "history" } });
    expect(ind(r, "execucao.sequencia").status).toBe("sem_dados");
  });

  it("aderência = cumpridos ÷ períodos fechados; mês em andamento não entra", () => {
    const r = run(steady(), { goalPeriods: [goal("2026-05", "cumprido"), goal("2026-06", "cumprido"), goal("2026-07", "estourado"), goal("2026-08", "cumprido"), goal("2026-09", "cumprido"), goal("2026-10", "estourado")] });
    expect(ind(r, "execucao.aderencia")).toMatchObject({ value: 80, status: "ok", confidence: "moderada" });
    expect(ind(r, "execucao.aderencia").inputs).toMatchObject({ cumpridos: 4, estourados: 1, periodos: 5 });
  });

  it("aderência baixa é atenção (nunca crítico) e sugere revisar a meta", () => {
    const r = run(steady(), { goalPeriods: [goal("2026-07", "estourado"), goal("2026-08", "estourado"), goal("2026-09", "estourado")] });
    expect(ind(r, "execucao.aderencia")).toMatchObject({ value: 0, status: "atencao" });
    expect(ind(r, "execucao.aderencia").reasons).toContain("aderencia_muito_baixa_revisar_meta");
  });

  it("sequência: meses seguidos com TODAS as metas cumpridas, do mais recente para trás", () => {
    const periods = [
      goal("2026-09", "cumprido", "a"), goal("2026-09", "cumprido", "b"),
      goal("2026-08", "cumprido", "a"), goal("2026-08", "cumprido", "b"),
      goal("2026-07", "cumprido", "a"), goal("2026-07", "estourado", "b"),
      goal("2026-06", "cumprido", "a"),
    ];
    const r = run(steady(), { goalPeriods: periods });
    expect(ind(r, "execucao.sequencia")).toMatchObject({ value: 2, direction: "neutral" });
  });

  it("fim de semana tem aderência própria (tipo diferente de compromisso, não é misturado com metas)", () => {
    const wk = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"].map((d, i) => goal(d, i === 3 ? "estourado" : "cumprido", "Lazer"));
    const r = run(steady(), { weekendPeriods: wk });
    expect(ind(r, "execucao.aderencia_fim_de_semana")).toMatchObject({ value: 75, status: "ok" });
    expect(ind(r, "execucao.aderencia").status).toBe("sem_dados");
  });
});

describe("Planejamento (E7)", () => {
  const flags = { "c-moradia": true, "c-lazer": false };
  it("viabilidade: essenciais + aportes + recorrentes não essenciais ÷ renda típica", () => {
    const r = run(steady(8000), { recurringNonEssentialMonthly: 500 }, {
      categoryEssential: flags,
      savingsGoals: [{ id: "g", name: "Viagem", target_amount: 6000, saved_amount: 0, created_at: "2026-01-01", target_date: "2027-04-16" }],
    });
    const v = ind(r, "planejamento.viabilidade");
    expect(v.inputs).toMatchObject({ essenciais_mensal: 3000, aportes_metas_mensal: 1000, recorrentes_nao_essenciais_mensal: 500 });
    expect(v.value).toBeCloseTo(4500 / 8000, 2);
    expect(v.status).toBe("ok");
  });

  it("plano que não cabe na renda é crítico", () => {
    const r = run(steady(2500), {}, { categoryEssential: flags });
    expect(ind(r, "planejamento.viabilidade")).toMatchObject({ status: "critico" });
    expect(ind(r, "planejamento.viabilidade").value).toBeCloseTo(1.2, 2); // essenciais 3000 ÷ renda 2500
  });

  it("sem flag de essencial não inventa viabilidade com gastos totais", () => {
    const r = run(steady(8000));
    expect(ind(r, "planejamento.viabilidade")).toMatchObject({ status: "sem_dados", needs: { code: "essencial_categoria" } });
  });

  it("metas sem prazo ficam fora do aporte e aparecem como motivo", () => {
    expect(monthlyGoalContributions([
      { id: "a", name: "A", target_amount: 1200, saved_amount: 0, created_at: "2026-01-01", target_date: "2027-10-16" },
      { id: "b", name: "B", target_amount: 900, saved_amount: 0, created_at: "2026-01-01", target_date: null },
      { id: "c", name: "C", target_amount: 100, saved_amount: 100, created_at: "2026-01-01", target_date: "2027-01-01" },
    ], ASOF)).toEqual({ total: 100, withDeadline: 1, withoutDeadline: 1 });
  });

  it("recorrentes registrados: precisa de ≥2 detectadas", () => {
    expect(ind(run(steady(), { recurringDetected: 1, recurringRegistered: 1 }), "planejamento.recorrentes_registrados").status).toBe("sem_dados");
    expect(ind(run(steady(), { recurringDetected: 4, recurringRegistered: 3 }), "planejamento.recorrentes_registrados")).toMatchObject({ value: 75, status: "ok" });
    expect(ind(run(steady(), { recurringDetected: 4, recurringRegistered: 1 }), "planejamento.recorrentes_registrados")).toMatchObject({ value: 25, status: "atencao" });
  });

  it("intencionalidade é descritiva (neutra) e exige ≥5 respostas", () => {
    expect(ind(run(steady(), { plannedAnswers: 2, totalAnswers: 4 }), "planejamento.intencionalidade")).toMatchObject({ status: "sem_dados", needs: { code: "planejado_vs_hora" } });
    expect(ind(run(steady(), { plannedAnswers: 6, totalAnswers: 8 }), "planejamento.intencionalidade")).toMatchObject({ value: 75, direction: "neutral", status: "ok" });
  });
});

describe("Acompanhamento (E8, exploratório)", () => {
  const est = (m: string, estimate: number, top?: string) => ({ month: m, estimate, top_category_id: top ?? null, answered_at: `${m}-28T12:00:00Z` });
  it("sem respostas: sem dados e pede a estimativa mensal", () => {
    expect(ind(run(steady()), "acompanhamento.calibragem_total")).toMatchObject({ status: "sem_dados", needs: { code: "estimativa_mensal" } });
  });

  it("calibragem = erro médio |estimado − real| ÷ real, com viés e rótulo exploratório", () => {
    // real = 4000 por mês. Estimativas 3000 (−25%) e 4800 (+20%): erro médio 22,5%; viés −2,5%.
    const r = run(steady(), { estimates: [est("2026-08", 3000), est("2026-09", 4800)] });
    const c = ind(r, "acompanhamento.calibragem_total");
    expect(c).toMatchObject({ value: 22.5, status: "atencao", direction: "lower_better" });
    expect(c.inputs.vies_medio_pct).toBe(-2.5);
    expect(c.reasons).toContain("exploratorio");
  });

  it("estimativa de mês em andamento ou sem gasto real não conta", () => {
    const r = run(steady(), { estimates: [est("2026-10", 100), est("2026-09", 4000)] });
    expect(ind(r, "acompanhamento.calibragem_total").status).toBe("sem_dados");
  });

  it("categoria que mais pesou: acerto ao comparar com o ledger", () => {
    const r = run(steady(), { estimates: [est("2026-08", 4000, "c-moradia"), est("2026-09", 4000, "c-lazer")] });
    expect(ind(r, "acompanhamento.categoria_que_mais_pesou")).toMatchObject({ value: 50, status: "ok" });
  });

  it("nunca produz status crítico em hábitos exploratórios", () => {
    const r = run(steady(), { estimates: [est("2026-08", 400), est("2026-09", 400)] });
    expect(ind(r, "acompanhamento.calibragem_total").status).toBe("atencao");
  });
});

describe("Agendador de perguntas (E13)", () => {
  const base = { nowIso: NOW, asOf: ASOF, indicators: [] as MapaReading["indicators"], entries: steady(), estimates: [], questions: [] as MapaQuestionRow[], lastCfpbAt: "2026-10-10T12:00:00Z" };
  const q = (over: Partial<MapaQuestionRow> & { kind: string }): MapaQuestionRow => ({ due_at: "2026-10-01T00:00:00Z", answered_at: null, skipped_at: null, created_at: "2026-10-01T00:00:00Z", ...over });
  const need = (code: string) => ({ ...({} as MapaReading["indicators"][number]), id: `x.${code}`, needs: { kind: "capture" as const, code } });

  it("mês fechado sem estimativa: pergunta a estimativa nos primeiros 20 dias", () => {
    expect(scheduleQuestions(base).map((x) => x.kind)).toEqual(["estimativa_mensal"]);
    expect(scheduleQuestions({ ...base, asOf: "2026-10-25", nowIso: "2026-10-25T12:00:00Z", lastCfpbAt: "2026-10-24T12:00:00Z" })).toEqual([]);
    expect(scheduleQuestions({ ...base, estimates: [{ month: "2026-09", estimate: 1, answered_at: "2026-10-02T00:00:00Z" }] })).toEqual([]);
  });

  it("uma pergunta por vez: a que destrava mais indicadores vence a estimativa", () => {
    const due = scheduleQuestions({ ...base, indicators: [need("debt_rate"), need("debt_kind"), need("essencial_categoria")] });
    expect(due.map((x) => x.kind)).toEqual(["taxa_divida"]);
    expect(due[0].reason).toBe("destrava_2_indicadores");
  });

  it("orçamento: depois de 1 pergunta resolvida hoje, nenhuma outra; depois de 3 na semana, nenhuma", () => {
    expect(scheduleQuestions({ ...base, questions: [q({ kind: "essencial_categoria", answered_at: "2026-10-16T09:00:00Z" })], indicators: [need("liquidez_investimento")] })).toEqual([]);
    const week = [q({ kind: "a", answered_at: "2026-10-11T09:00:00Z" }), q({ kind: "b", skipped_at: "2026-10-12T09:00:00Z" }), q({ kind: "c", answered_at: "2026-10-13T09:00:00Z" })];
    expect(scheduleQuestions({ ...base, questions: week, indicators: [need("liquidez_investimento")] })).toEqual([]);
    expect(scheduleQuestions({ ...base, questions: week.slice(0, 2), indicators: [need("liquidez_investimento")] }).map((x) => x.kind)).toEqual(["liquidez_investimento"]);
  });

  it("pular adia 7 dias a mesma pergunta; 'depois' (due_at no futuro) segura até a hora", () => {
    const ind1 = [need("liquidez_investimento")];
    expect(scheduleQuestions({ ...base, indicators: ind1, entries: [], questions: [q({ kind: "liquidez_investimento", skipped_at: "2026-10-12T09:00:00Z" })] })).toEqual([]);
    expect(scheduleQuestions({ ...base, indicators: ind1, entries: [], questions: [q({ kind: "liquidez_investimento", skipped_at: "2026-10-08T09:00:00Z" })] }).map((x) => x.kind)).toEqual(["liquidez_investimento"]);
    expect(scheduleQuestions({ ...base, indicators: ind1, entries: [], questions: [q({ kind: "liquidez_investimento", due_at: "2026-10-18T00:00:00Z" })] })).toEqual([]);
  });

  it("CFPB tem cadência própria de 15 dias e não consome o orçamento", () => {
    const resolved = [q({ kind: "essencial_categoria", answered_at: "2026-10-16T09:00:00Z" })];
    const due = scheduleQuestions({ ...base, lastCfpbAt: "2026-09-25T12:00:00Z", questions: resolved });
    expect(due.map((x) => x.kind)).toEqual(["cfpb"]);
    expect(scheduleQuestions({ ...base, lastCfpbAt: null, entries: [] })[0]).toMatchObject({ kind: "cfpb", reason: "primeira_medicao" });
    expect(scheduleQuestions({ ...base, lastCfpbAt: "2026-10-10T12:00:00Z", entries: [] })).toEqual([]);
  });
});

describe("Leitura completa com hábitos", () => {
  it("respeita as invariantes do contrato e não repete ids", () => {
    const r = run(steady(), {
      goalPeriods: [goal("2026-07", "cumprido"), goal("2026-08", "cumprido"), goal("2026-09", "estourado")],
      recurringDetected: 3, recurringRegistered: 2, plannedAnswers: 3, totalAnswers: 6,
      estimates: [{ month: "2026-09", estimate: 4100, top_category_id: "c-moradia", answered_at: "2026-10-02T00:00:00Z" }],
    }, { categoryEssential: { "c-moradia": true, "c-lazer": false } });
    expect(validateMapaReading(r)).toEqual([]);
    expect(r.indicators.filter((i) => i.layer === "habitos").length).toBe(9);
    expect(r.indicators.filter((i) => i.layer === "habitos" && i.status === "critico")).toEqual([]);
  });
});
