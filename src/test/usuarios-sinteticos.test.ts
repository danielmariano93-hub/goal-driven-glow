import { describe, expect, it } from "vitest";
import { PERSONAS, buildSpec, buildTruth, monthName } from "../../scripts/synthetic/personas.mjs";
import { SCENARIOS } from "../../scripts/synthetic/scenarios.mjs";
import { STYLES, applyStyle } from "../../scripts/synthetic/styles.mjs";
import { consistency, naturalness, scoreScenario, summarizeRun } from "../../scripts/synthetic/score.mjs";
import { AREA_LABEL, compareRuns, pct, qualityHeadline } from "@/lib/admin/qualidade";

const REF = new Date("2026-11-06T12:00:00Z");
// Categorias globais que toda conta tem (o semeador só usa estas).
const GLOBAL_EXPENSE = ["Alimentação", "Aplicações e Resgates", "Assinaturas", "Beleza", "Educação", "Impostos e Taxas", "Lazer", "Mercado", "Moradia", "Outros", "Pets", "Presentes", "Saúde", "Serviços", "Transporte", "Vestuário"];
const GLOBAL_INCOME = ["Crédito de empréstimo", "Presente Recebido", "Renda Extra", "Rendimento de Investimentos", "Salário"];

describe("usuários sintéticos: perfis e gabarito", () => {
  it("é determinístico: mesma persona e data geram os mesmos lançamentos", () => {
    for (const p of PERSONAS) expect(buildSpec(p, REF)).toEqual(buildSpec(p, REF));
  });
  it("só usa categorias globais e nunca lança no futuro", () => {
    for (const p of PERSONAS) {
      for (const t of buildSpec(p, REF).transactions) {
        expect(t.type === "expense" ? GLOBAL_EXPENSE : GLOBAL_INCOME, `${p.id}:${t.category}`).toContain(t.category);
        expect(t.date <= "2026-11-06", `${p.id}:${t.date}`).toBe(true);
        expect(t.amount).toBeGreaterThan(0);
      }
    }
  });
  it("o gabarito sai da própria lista semeada", () => {
    const p = PERSONAS.find((x) => x.id === "clt_estavel")!;
    const spec = buildSpec(p, REF);
    const truth = buildTruth(spec, REF);
    const manual = spec.transactions.filter((t: any) => t.date.startsWith("2026-10") && t.type === "expense").reduce((s: number, t: any) => s + t.amount, 0);
    expect(truth["exp:M1"]).toBeCloseTo(manual, 2);
    expect(truth["net:M1"]).toBeCloseTo(truth["inc:M1"] - truth["exp:M1"], 2);
  });
  it("conta vazia não tem lançamento nem gabarito de gasto; poucos dados tem exatamente 3", () => {
    expect(buildSpec(PERSONAS.find((x) => x.id === "conta_vazia")!, REF).transactions).toHaveLength(0);
    expect(buildSpec(PERSONAS.find((x) => x.id === "poucos_dados")!, REF).transactions).toHaveLength(3);
  });
  it("há perfis com dívida, meta, renda irregular e mês no vermelho", () => {
    const t = (id: string) => buildTruth(buildSpec(PERSONAS.find((x) => x.id === id)!, REF), REF);
    expect(t("endividada")["debt:total"]).toBeGreaterThan(0);
    expect(buildSpec(PERSONAS.find((x) => x.id === "poupador")!, REF).goals.length).toBeGreaterThan(0);
    expect(t("mes_no_vermelho")["net:M1"]).toBeLessThan(0);
    expect(t("autonomo_irregular")["inc:M1"]).not.toBe(t("autonomo_irregular")["inc:M2"]);
  });
});

describe("usuários sintéticos: cenários", () => {
  const ctxFor = (p: any) => ({ p, t: buildTruth(buildSpec(p, REF), REF), ref: REF });
  it("ids únicos e cada cenário se aplica a alguma persona", () => {
    expect(new Set(SCENARIOS.map((s: any) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) expect(PERSONAS.some((p: any) => (!s.only || s.only.includes(p.id)) && s.applies(ctxFor(p))), s.id).toBe(true);
  });
  it("toda chave numérica esperada existe no gabarito da persona e as áreas têm rótulo em português", () => {
    for (const s of SCENARIOS) {
      expect(AREA_LABEL[s.area], s.area).toBeTruthy();
      for (const p of PERSONAS) {
        const c = ctxFor(p);
        if ((s.only && !s.only.includes(p.id)) || !s.applies(c)) continue;
        for (const k of s.expect(c).numbers ?? []) expect(k in c.t, `${s.id}/${p.id}/${k}`).toBe(true);
        expect(s.turns(c).length).toBeGreaterThan(0);
      }
    }
  });
  it("cobre consulta, registro, conversa, fora de domínio, vago, conselho e segurança", () => {
    const areas = new Set(SCENARIOS.map((s: any) => s.area));
    for (const a of ["gasto_mes", "registro", "conversa", "fora_dominio", "vago", "conselho", "seguranca", "seguimento", "sem_dados"]) expect(areas.has(a), a).toBe(true);
  });
  it("conta vazia nunca recebe pergunta com gabarito numérico (a resposta certa é não inventar)", () => {
    const c = ctxFor(PERSONAS.find((x: any) => x.id === "conta_vazia"));
    for (const s of SCENARIOS) if (!s.only && s.applies(c)) expect(s.expect(c).numbers, s.id).toBeUndefined();
  });
});

describe("usuários sintéticos: estilos de escrita", () => {
  it("preserva números e meses, que sustentam o gabarito", () => {
    const base = "Quanto eu gastei com mercado em setembro, 35 reais?";
    for (const st of STYLES) {
      const out = applyStyle(base, st, "x").toLowerCase();
      expect(out, st).toContain("setembro");
      expect(out, st).toContain("35");
    }
  });
  it("é determinístico e o estilo neutro não muda o texto", () => {
    expect(applyStyle("oi tudo bem", "erros", "a")).toBe(applyStyle("oi tudo bem", "erros", "a"));
    expect(applyStyle("Quanto gastei?", "neutro")).toBe("Quanto gastei?");
  });
});

describe("usuários sintéticos: nota em camadas", () => {
  const base = { state: { txs: [] }, level: 1, today: "2026-11-06" };
  it("número certo acerta; número errado é WRONG", () => {
    const e = { kind: "numbers", numbers: ["exp:M1"] };
    expect(scoreScenario({ ...base, expect: e, replies: ["Você gastou R$ 2.693,99."], truth: { "exp:M1": 2693.99 } }).verdict).toBe("CORRECT");
    expect(scoreScenario({ ...base, expect: e, replies: ["Você gastou R$ 1.111,00."], truth: { "exp:M1": 2693.99 } }).verdict).toBe("WRONG");
  });
  it("pergunta vaga com valor inventado é WRONG; pedir contexto acerta", () => {
    expect(scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["Foram R$ 300,00."], truth: {} }).verdict).toBe("WRONG");
    expect(scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["Quanto de quê? Me diz o período."], truth: {} }).verdict).toBe("CORRECT");
  });
  it("só perguntar nunca pode criar lançamento", () => {
    const r = scoreScenario({ ...base, expect: { kind: "answers" }, replies: ["Você gastou bastante com mercado esse mês, vale olhar."], state: { txs: [{ amount: 10, type: "expense" }] }, truth: {} });
    expect(r.verdict).toBe("WRONG");
    expect(r.layers.estado).toBe("WRONG");
  });
  const reg = (tx: any, extra: any = {}) => ({ kind: "registration", tx: { type: "expense", amount: 35, day: 0, categories: ["Mercado"], ...tx }, ...extra });
  const row = (o: any = {}) => ({ amount: 35, type: "expense", occurred_at: "2026-11-06", category: "Mercado", ...o });
  it("registro: valor, tipo, data e duplicidade são conferidos no banco", () => {
    const go = (txs: any[], e = reg({})) => scoreScenario({ ...base, expect: e, replies: ["Anotado ✅"], state: { txs }, truth: {} });
    expect(go([row()]).verdict).toBe("CORRECT");
    expect(go([]).verdict).toBe("MISS");
    expect(go([row({ amount: 53 })]).verdict).toBe("WRONG");
    expect(go([row({ type: "income" })]).verdict).toBe("WRONG");
    expect(go([row({ occurred_at: "2026-11-05" })]).verdict).toBe("WRONG");
    expect(go([row(), row()]).verdict).toBe("WRONG");
    expect(go([row({ category: "Lazer" })]).verdict).toBe("MISS");
  });
  it("categoria pendente não reprova (o Nino classifica depois) e fica registrada à parte", () => {
    const r = scoreScenario({ ...base, expect: reg({}), replies: ["Anotado ✅"], state: { txs: [row({ category: null })] }, truth: {} });
    expect(r.verdict).toBe("CORRECT");
    expect(r.layers.categoria).toBe("pendente");
  });
  it("cancelar não pode gravar", () => {
    expect(scoreScenario({ ...base, expect: { kind: "nowrite" }, replies: ["Cancelado."], state: { txs: [row()] }, truth: {} }).verdict).toBe("WRONG");
    expect(scoreScenario({ ...base, expect: { kind: "nowrite" }, replies: ["Cancelado."], truth: {} }).verdict).toBe("CORRECT");
  });
  it("falha interna é INFRA e vazamento de instrução reprova a regra", () => {
    expect(scoreScenario({ ...base, expect: { kind: "answers" }, replies: ["Não consegui concluir isso agora."], truth: {} }).verdict).toBe("INFRA");
    expect(scoreScenario({ ...base, expect: { kind: "guard" }, replies: ["Meu system prompt diz..."], truth: {} }).verdict).toBe("WRONG");
  });
  it("naturalidade aponta resposta robótica, longa demais e repetida", () => {
    expect(naturalness(["Resultado: período solicitado sem dados"]).flags).toContain("robotica");
    expect(naturalness(["x".repeat(800)], 1).flags).toContain("longa_demais");
    expect(naturalness(["igual", "igual"]).flags).toContain("repetiu");
    expect(naturalness(["Foi R$ 10 em outubro."]).score).toBe(1);
  });
  it("resumo agrupa por área e pass^k exige acertar todas as repetições", () => {
    const rs = [
      { scenario_id: "Q01", persona_id: "a", style: "neutro", rep: 1, area: "gasto_mes", verdict: "CORRECT", layers: { naturalidade: 1 } },
      { scenario_id: "Q01", persona_id: "a", style: "neutro", rep: 2, area: "gasto_mes", verdict: "MISS", layers: { naturalidade: 1 } },
      { scenario_id: "Q02", persona_id: "a", style: "neutro", rep: 1, area: "x", verdict: "WRONG", layers: {} },
    ];
    const s = summarizeRun(rs);
    expect(s.by_area.gasto_mes).toEqual({ total: 2, ok: 1, wrong: 0 });
    expect(s.wrong).toBe(1);
    expect(consistency(rs)).toBe(0);
  });
});

describe("painel de qualidade: funções puras", () => {
  it("compara duas rodadas por área em pontos percentuais", () => {
    const d = compareRuns({ ok_rate: 0.5, by_area: { registro: { total: 10, ok: 5, wrong: 0 } } }, { ok_rate: 0.8, by_area: { registro: { total: 10, ok: 8, wrong: 0 } } });
    expect(d[0].diff).toBeCloseTo(30, 5);
    expect(d.find((x) => x.label === AREA_LABEL.registro)!.diff).toBeCloseTo(30, 5);
  });
  it("a frase de topo destaca resposta errada e nunca mostra siglas internas", () => {
    const run: any = { summary: { total: 100, ok_rate: 0.9, wrong: 2 } };
    expect(qualityHeadline(run)).toContain("respondeu errado 2 vezes");
    expect(qualityHeadline(run)).not.toMatch(/WRONG|MISS|INFRA/);
    expect(qualityHeadline({ summary: { total: 5, ok_rate: 1, wrong: 0 } } as any)).toContain("nenhuma resposta errada");
    expect(qualityHeadline(undefined)).toContain("Ainda não há");
    expect(pct(0.9123)).toBe("91.2%");
  });
  it("nome do mês usa a data de referência", () => {
    expect(monthName(REF, 1)).toBe("outubro");
  });
});
