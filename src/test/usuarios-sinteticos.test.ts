import { describe, expect, it } from "vitest";
import { PERSONAS, buildSpec, buildTruth, knownValues, monthName } from "../../scripts/synthetic/personas.mjs";
import { SCENARIOS } from "../../scripts/synthetic/scenarios.mjs";
import { STYLES, applyStyle } from "../../scripts/synthetic/styles.mjs";
import { consistency, naturalness, scoreScenario, summarizeRun } from "../../scripts/synthetic/score.mjs";
import { AREA_LABEL, compareRuns, groupFailures, pct, qualityHeadline, summarizeReal } from "@/lib/admin/qualidade";

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

describe("usuários sintéticos: conjunto de perguntas novas (held-out)", () => {
  const ctxFor = (p: any) => ({ p, t: buildTruth(buildSpec(p, REF), REF), ref: REF });
  const held = SCENARIOS.filter((s: any) => s.heldout);
  it("existe, tem ids H e cobre vários passos, seguimento, registro e conta sem dados", () => {
    expect(held.length).toBeGreaterThanOrEqual(20);
    for (const s of held) expect(s.id, s.id).toMatch(/^H\d{2}$/);
    const areas = new Set(held.map((s: any) => s.area));
    for (const a of ["multi_passo", "seguimento", "registro", "sem_dados", "conversa"]) expect(areas.has(a), a).toBe(true);
  });
  it("nenhuma frase é igual a uma frase dos cenários usados para criar regras", () => {
    for (const p of PERSONAS) {
      const c = ctxFor(p);
      const seen = new Set<string>();
      for (const s of SCENARIOS) if (!s.heldout && (!s.only || s.only.includes(p.id)) && s.applies(c)) for (const t of s.turns(c)) seen.add(String(typeof t === "string" ? t : t.text).toLowerCase());
      for (const s of held) if ((!s.only || s.only.includes(p.id)) && s.applies(c)) {
        // A abertura de uma conversa pode repetir uma pergunta comum; a frase que é medida (a última pergunta) tem de ser nova.
        const turns = s.turns(c).map((t: any) => String(typeof t === "string" ? t : t.text).toLowerCase()).filter((t: string) => t !== "sim");
        const text = turns.at(-1)!;
        expect(seen.has(text), `${s.id}/${p.id}: ${text}`).toBe(false);
      }
    }
  });
  it("gabaritos derivados batem com a soma dos meses semeados", () => {
    const t = ctxFor(PERSONAS.find((x: any) => x.id === "clt_estavel")).t as Record<string, number>;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(t["sum3:exp"]).toBe(r2(t["exp:M1"] + t["exp:M2"] + t["exp:M3"]));
    expect(t["avg3:exp"]).toBe(r2(t["sum3:exp"] / 3));
    expect(t["sum3:net"]).toBe(r2(t["sum3:inc"] - t["sum3:exp"]));
    expect(t["diff12:exp"]).toBe(r2(Math.abs(t["exp:M1"] - t["exp:M2"])));
    expect(t["catsum12:Mercado"]).toBe(r2(t["cat:M1:Mercado"] + t["cat:M2:Mercado"]));
  });
});

describe("usuários sintéticos: conta de vários meses e estilo telegráfico", () => {
  const truth = { "sum3:exp": 6511.69, "exp:M1": 2101.07, "exp:M2": 2074.15, "exp:M3": 2336.47 };
  const base = { state: { txs: [] }, truth, level: 2, today: "2026-11-09", known: [6511.69, 2101.07, 2074.15, 2336.47] };
  const expectSum = { numbers: ["sum3:exp"] };
  it("citar só os valores reais de cada mês, sem o total, é MISS; o total certo é CORRECT; valor inventado é WRONG", () => {
    expect(scoreScenario({ ...base, expect: expectSum, replies: ["Você gastou R$ 2.336,47 em agosto, R$ 2.074,15 em setembro e R$ 2.101,07 em outubro."] }).verdict).toBe("MISS");
    expect(scoreScenario({ ...base, expect: expectSum, replies: ["Nos três meses você gastou R$ 6.511,69."] }).verdict).toBe("CORRECT");
    expect(scoreScenario({ ...base, expect: expectSum, replies: ["Nos três meses você gastou R$ 7.000,00."] }).verdict).toBe("WRONG");
  });
  it("valor real de um mês só afrouxa a nota nas contas derivadas, não numa pergunta simples", () => {
    const simple = { numbers: ["exp:M1"] };
    expect(scoreScenario({ ...base, expect: simple, replies: ["Você gastou R$ 2.074,15."] }).verdict).toBe("WRONG");
  });
  it("o telegráfico tira 'quanto' só da abertura e não quebra frases como 'fechei com quanto no bolso'", () => {
    const out = applyStyle("fechei outubro com quanto no bolso?", "telegrafico", "x");
    expect(out).toContain("quanto");
    expect(applyStyle("quanto gastei em outubro?", "telegrafico", "x")).not.toMatch(/^quanto/);
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
  it("palpite de contexto com valor real é MISS; valor que não existe nos dados é WRONG", () => {
    const truth = { "exp:M0": 637.91 };
    expect(scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["R$ 637,91 foi o total do mês."], truth }).verdict).toBe("MISS");
    expect(scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["R$ 999,00 foi o total do mês."], truth }).verdict).toBe("WRONG");
    expect(scoreScenario({ ...base, expect: { kind: "chat" }, replies: ["R$ 637,91 nos últimos dias."], truth }).verdict).toBe("MISS");
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

import { createGovernor, isDegraded } from "../../scripts/synthetic/governor.mjs";

describe("usuários sintéticos: regulador de vazão (limite de tokens por minuto)", () => {
  const fake = () => {
    let now = 0;
    return { clock: () => now, sleep: async (ms: number) => { now += ms; }, advance: (ms: number) => { now += ms; } };
  };
  it("segura novas chamadas quando o orçamento de tokens do minuto acaba e libera depois", async () => {
    const f = fake();
    const g = createGovernor({ tokensPerMin: 20_000, startLimit: 3, assumedTokensPerTurn: 1_000, clock: f.clock, sleep: f.sleep });
    await g.acquire(); g.release({ tokens: 25_000 });
    const before = f.clock();
    await g.acquire(); // precisa esperar a janela de 60 s esvaziar
    expect(f.clock() - before).toBeGreaterThanOrEqual(59_000);
    expect(g.snapshot().peak_tokens_per_min).toBe(25_000);
  });
  it("degradação corta a concorrência pela metade e impõe pausa; turnos limpos fazem subir de novo", async () => {
    const f = fake();
    const g = createGovernor({ startLimit: 4, cooldownMs: 10_000, growAfter: 2, clock: f.clock, sleep: f.sleep });
    await g.acquire(); g.release({ tokens: 100, degraded: true });
    expect(g.limit).toBe(2);
    const t0 = f.clock();
    await g.acquire(); g.release({ tokens: 100 });
    expect(f.clock() - t0).toBeGreaterThanOrEqual(10_000 - 1);
    await g.acquire(); g.release({ tokens: 100 });
    expect(g.limit).toBe(3);
    expect(g.snapshot().degraded).toBe(1);
  });
  it("nunca passa do limite de concorrência", async () => {
    const f = fake();
    const g = createGovernor({ startLimit: 2, clock: f.clock, sleep: async (ms) => { f.advance(ms); if (g.active >= 2) g.release({ tokens: 10 }); } });
    await g.acquire(); await g.acquire();
    expect(g.active).toBe(2);
    await g.acquire(); // só entra depois que uma saiu
    expect(g.active).toBeLessThanOrEqual(2);
  });
  it("reconhece degradação: caminho de contingência, falha do provedor e resposta técnica", () => {
    expect(isDegraded({ run: { model: "v3-fallback:qwen->x" }, reply: "ok" })).toBe(true);
    expect(isDegraded({ run: { model: "deterministic:provider_recover" } })).toBe(true);
    expect(isDegraded({ status: 429 })).toBe(true);
    expect(isDegraded({ reply: "Não consegui processar isso com segurança agora." })).toBe(true);
    expect(isDegraded({ run: { model: "v3-primary:qwen" }, reply: "Você gastou R$ 10." })).toBe(false);
  });
});

describe("valores conhecidos da persona e agrupamento das falhas", () => {
  it("meta, soma diária e valor de lançamento contam como reais; valor aleatório não", () => {
    const p = PERSONAS.find((x: any) => x.id === "clt_estavel")!;
    const spec = buildSpec(p, REF);
    const known = knownValues(spec, REF);
    expect(known).toContain(15000); // meta da reserva de emergência
    expect(known).toContain(Math.abs(spec.transactions[0].amount));
    expect(known).not.toContain(123456.78);
  });
  it("palpite com meta ou soma diária da própria persona é MISS, não WRONG", () => {
    const base = { state: { txs: [] }, level: 1, today: "2026-11-06", truth: {} };
    const r = scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["Faltam R$ 15.000,00 para a meta."], known: [15000] });
    expect(r.verdict).toBe("MISS");
    expect(scoreScenario({ ...base, expect: { kind: "vague" }, replies: ["Foram R$ 777,00."], known: [15000] }).verdict).toBe("WRONG");
  });
  const f = (scenario_id: string, verdict: string, persona_id = "a") => ({ scenario_id, verdict, persona_id, style: "neutro", rep: 1, area: "gasto_mes", why: "x", layers: {}, turns: ["q"], replies: ["r"], latency_ms: 1 });
  it("agrupa por cenário, ordena erro antes de não-resposta e limita os exemplos", () => {
    const g = groupFailures([f("Q10", "MISS"), f("Q01", "WRONG", "a"), f("Q01", "WRONG", "b"), f("Q01", "WRONG", "c"), f("Q01", "WRONG", "d"), f("Q02", "CORRECT")] as any);
    expect(g.map((x) => x.key)).toEqual(["WRONG|Q01", "MISS|Q10"]);
    expect(g[0].count).toBe(4);
    expect(g[0].examples).toHaveLength(3);
    expect(g[0].personas).toEqual(["a", "b", "c", "d"]);
  });
  it("resumo de clientes reais soma a janela fixa", () => {
    expect(summarizeReal([{ semana: "2026-10-26", respostas: 10, falhas: 1, recusas: 2, esclarecimentos: 0 }, { semana: "2026-11-02", respostas: 30, falhas: 0, recusas: 1, esclarecimentos: 1 }])).toEqual({ respostas: 40, falhas: 1, recusas: 3, esclarecimentos: 1 });
  });
});

describe("usuários sintéticos: valor repetido da própria pergunta", () => {
  it("repetir o 'R$ 500' que a pessoa digitou não é valor inventado; valor novo continua sendo", () => {
    const base = { state: { txs: [] }, truth: { "exp:M1": 100 }, level: 2, today: "2026-11-09", known: [100] };
    const ok = scoreScenario({ ...base, expect: { kind: "chat" }, asked: ["me empresta 500 reais?"], replies: ["Não faço empréstimo, mas posso te ajudar a montar um plano para guardar R$ 500."] });
    expect(ok.verdict).toBe("CORRECT");
    const bad = scoreScenario({ ...base, expect: { kind: "chat" }, asked: ["me empresta 500 reais?"], replies: ["Você tem R$ 9.999,00 de saldo."] });
    expect(bad.verdict).toBe("WRONG");
  });
});

describe("usuários sintéticos: estilos preservam o valor decimal", () => {
  it("'27,50' e '1.234,56' nunca viram '2750' ou '123456' em nenhum estilo", () => {
    for (const st of STYLES) {
      const out = applyStyle("comprei um remédio por 27,50 hoje", st, "x");
      expect(out, st).toContain("27,50");
    }
    expect(applyStyle("paguei 1.234,56 de aluguel", "informal", "x")).toContain("1.234,56");
    expect(applyStyle("quanto gastei?", "informal", "x")).not.toMatch(/\?/);
  });
});
