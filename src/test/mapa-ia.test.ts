import { describe, expect, it } from "vitest";
import { validateMapaReading } from "@/lib/engine/mapaContracts";
import { buildMapaEvidencePack, MAPA_PROMPT_VERSION, type MapaEvidencePack } from "@/lib/engine/mapaEvidencePack";
import { guardMapaText } from "../../supabase/functions/_shared/mapa/narrativeGuard";
import { buildMapaPrompt, composeMapaNarrative, parseMapaNarrativeJson, runMapaNarrativeEval, type CompleteFn } from "../../supabase/functions/_shared/mapa/narrative";
import { evalScenarios } from "./fixtures/mapaEvalScenarios";

const scenarios = evalScenarios();
const packs = scenarios.map((s) => ({ name: s.name, reading: s.reading, pack: buildMapaEvidencePack(s.reading) }));
const fullText = (p: MapaEvidencePack) => `${p.deterministic.title}. ${p.deterministic.body}${p.deterministic.question ? ` ${p.deterministic.question}` : ""}`;

describe("conjunto de avaliação do Mapa", () => {
  it("tem pelo menos 60 cenários, todos válidos pelo contrato", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(60);
    for (const s of scenarios) expect(validateMapaReading(s.reading), s.name).toEqual([]);
  });

  it("cobre os quatro modos e as duas naturezas de recomendação", () => {
    const modes = new Set(packs.map((p) => p.pack.mode));
    expect(modes).toEqual(new Set(["recomendacao_estrutural", "recomendacao", "em_dia", "pouco_dado"]));
    const actions = new Set(packs.map((p) => p.pack.recommendation?.action).filter(Boolean));
    expect(actions.size).toBeGreaterThanOrEqual(5);
  });
});

describe("texto determinístico (reserva): sempre pode ser enviado", () => {
  it("passa na guarda em 100% dos cenários", () => {
    for (const { name, pack } of packs) {
      const g = guardMapaText({ title: pack.deterministic.title, body: pack.deterministic.body, question: pack.deterministic.question, pack });
      expect(g.violations, `${name}: ${fullText(pack)}`).toEqual([]);
    }
  });

  it("estrutural nunca vira dica de comportamento nem manda gastar menos", () => {
    for (const { name, reading, pack } of packs) {
      if (reading.structural.structural === true) {
        expect(["estrutural", undefined], name).toContain(reading.recommendation?.kind);
        expect(fullText(pack), name).not.toMatch(/\b(gaste|gastar|corte|cortar|reduza|reduzir) (menos|gastos)/i);
      }
    }
  });

  it("não fala em nota, score nem inventa número: cada número do texto está nos fatos", () => {
    for (const { name, pack } of packs) {
      expect(fullText(pack), name).not.toMatch(/\bnota\b|\bscore\b|\/10/i);
      expect(pack.facts.length, name).toBeLessThanOrEqual(5);
    }
  });

  it("o hash muda com o fato e é estável sem mudança", () => {
    const a = packs.find((p) => p.name === "G1 caixa baixo")!.pack;
    const again = buildMapaEvidencePack(packs.find((p) => p.name === "G1 caixa baixo")!.reading);
    expect(again.hash).toBe(a.hash);
    expect(packs.find((p) => p.name === "G8 estrutural essenciais")!.pack.hash).not.toBe(a.hash);
  });
});

describe("guarda: rejeita 100% das saídas ruins, em todos os cenários", () => {
  const bad: Array<[string, (p: MapaEvidencePack) => string, string]> = [
    ["número inventado", (p) => `${p.deterministic.body} Você tem R$ 98.765,43 parados.`, "number_not_in_evidence"],
    ["percentual inventado", (p) => `${p.deterministic.body} Isso é 87,3% da sua vida.`, "number_not_in_evidence"],
    ["meses inventados", (p) => `${p.deterministic.body} Isso dura 14 meses.`, "unit_number_not_in_evidence"],
    ["emoção", (p) => `${p.deterministic.body} Você está ansioso com dinheiro.`, "emotion_or_diagnosis"],
    ["diagnóstico", (p) => `${p.deterministic.body} Isso parece compulsão.`, "emotion_or_diagnosis"],
    ["causa", (p) => `${p.deterministic.body} Isso acontece porque você gasta sem pensar.`, "cause_claim"],
    ["juízo moral", (p) => `${p.deterministic.body} Você gastou demais.`, "moral_judgement"],
    ["promessa", (p) => `${p.deterministic.body} Você vai conseguir juntar tudo.`, "promise"],
    ["nota", (p) => `${p.deterministic.body} Sua nota é 7/10.`, "score_or_grade"],
    ["código interno", (p) => `${p.deterministic.body} Veja seguranca.meses_cobertos.`, "internal_reference"],
    ["provedor", (p) => `${p.deterministic.body} Segundo o modelo GPT.`, "provider_mentioned"],
    ["palavra proibida", (p) => `${p.deterministic.body} Seu mês fechou negativo.`, "banned_word"],
  ];
  for (const [label, mutate, violation] of bad) {
    it(`${label} → ${violation}`, () => {
      for (const { name, pack } of packs) {
        const g = guardMapaText({ title: pack.deterministic.title, body: mutate(pack), question: null, pack });
        expect(g.ok, `${name}: ${label}`).toBe(false);
        expect(g.violations, name).toContain(violation);
      }
    });
  }

  it("estrutural: 'gaste menos' é reprovado; fora do estrutural a mesma frase não dispara essa regra", () => {
    const s = packs.filter((p) => p.pack.mode === "recomendacao_estrutural");
    const n = packs.filter((p) => p.pack.mode === "recomendacao");
    expect(s.length).toBeGreaterThan(0);
    for (const { name, pack } of s) expect(guardMapaText({ body: `${pack.deterministic.body} Gaste menos com lazer.`, pack }).violations, name).toContain("spend_less_on_structural");
    for (const { name, pack } of n) expect(guardMapaText({ body: `${pack.deterministic.body} Gaste menos com lazer.`, pack }).violations, name).not.toContain("spend_less_on_structural");
  });

  it("não reprova uma reescrita legítima (prefixo simples sobre o texto determinístico)", () => {
    for (const { name, pack } of packs) {
      const g = guardMapaText({ title: pack.deterministic.title, body: pack.deterministic.body, question: pack.deterministic.question, pack });
      expect(g.ok, name).toBe(true);
    }
  });
});

describe("composição: saída fora do esquema ou reprovada cai no texto determinístico", () => {
  const pack = packs.find((p) => p.name === "G8 estrutural essenciais")!.pack;
  const answer = (text: string): CompleteFn => async () => ({ text, model: "m", latency_ms: 5 });

  it("JSON válido e dentro das regras vira texto do modelo", async () => {
    const good = JSON.stringify({ title: pack.deterministic.title, body: pack.deterministic.body, question: pack.deterministic.question ?? "" });
    const r = await composeMapaNarrative(pack, answer(good));
    expect(r.narrative.source).toBe("llm");
    expect(r.guard?.ok).toBe(true);
  });

  it("aceita JSON em cerca de código", async () => {
    const good = "```json\n" + JSON.stringify({ title: "Título", body: pack.deterministic.body, question: "" }) + "\n```";
    expect((await composeMapaNarrative(pack, answer(good))).narrative.source).toBe("llm");
  });

  it("fora do esquema, texto reprovado e erro de rede: sempre o determinístico, com o motivo", async () => {
    const schema = await composeMapaNarrative(pack, answer("isto não é json"));
    expect(schema.narrative).toMatchObject({ source: "template", fallback_reason: "schema", body: pack.deterministic.body });
    const bad = await composeMapaNarrative(pack, answer(JSON.stringify({ title: "Oi", body: "Gaste menos com lazer, vai dar certo, garanto.", question: "" })));
    expect(bad.narrative.source).toBe("template");
    expect(bad.narrative.fallback_reason).toMatch(/^guard:/);
    const net = await composeMapaNarrative(pack, async () => { throw new Error("timeout"); });
    expect(net.narrative).toMatchObject({ source: "template" });
    expect(net.narrative.fallback_reason).toMatch(/gateway_error/);
  });

  it("parse rejeita título/corpo vazios ou longos demais", () => {
    expect(parseMapaNarrativeJson(JSON.stringify({ title: "", body: "x", question: "" }))).toBeNull();
    expect(parseMapaNarrativeJson(JSON.stringify({ title: "ok", body: "x".repeat(501), question: "" }))).toBeNull();
    expect(parseMapaNarrativeJson("[]")).toBeNull();
  });

  it("o prompt carrega modo, fatos e regras, e nunca texto de transação", () => {
    const { system, user } = buildMapaPrompt(pack);
    expect(system).toContain("NÃO diga para gastar ou cortar menos");
    expect(user).toContain("MODO: recomendacao_estrutural");
    expect(user).toContain("NÚMEROS PERMITIDOS");
    expect(MAPA_PROMPT_VERSION).toBe("mapa_prompt.v1");
  });

  it("o harness de avaliação mede fallback e violações (rodado aqui com um modelo SIMULADO, não com o real)", async () => {
    const flaky: CompleteFn = async ({ user }) => {
      const hasStruct = user.includes("recomendacao_estrutural");
      // simula um modelo que às vezes erra: no estrutural manda gastar menos
      return { text: JSON.stringify({ title: "Leitura", body: hasStruct ? "Gaste menos com lazer." : "Tudo bem por aqui.", question: "" }) };
    };
    const report = await runMapaNarrativeEval(packs.map((p) => p.pack), flaky);
    expect(report.n).toBe(packs.length);
    expect(report.fallback).toBeGreaterThan(0);
    expect(report.violations.spend_less_on_structural).toBeGreaterThan(0);
  });
});

describe("texto da recomendação 'fechar a conta' (comportamento)", () => {
  it("diz quanto saiu a mais, só com números dos fatos, e passa na guarda", () => {
    const hit = packs.find((p) => p.pack.recommendation?.action === "fechar_a_conta" && p.pack.recommendation.kind === "comportamento");
    expect(hit, "nenhum cenário de avaliação cobre fechar_a_conta de comportamento").toBeDefined();
    const { pack } = hit!;
    expect(pack.deterministic.title).toBe("Está saindo mais do que entra");
    expect(pack.deterministic.body).toMatch(/a mais do que entraram/);
    expect(guardMapaText({ title: pack.deterministic.title, body: pack.deterministic.body, question: pack.deterministic.question, pack }).violations).toEqual([]);
  });
});
