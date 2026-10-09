import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildObservedProfileV2 } from "@/lib/engine/behaviorObserved";
import {
  buildHabitDiscovery,
  compareDimensions,
  DIMENSION_SCOPE,
  isComparableDimension,
  type ObservedSnapshot,
} from "@/lib/engine/behaviorEvolution";
import { BEHAVIOR_DIMENSIONS, type ObservedBehaviorProfile } from "@/lib/engine/behaviorDimensions";
import { nextStepCopy } from "@/lib/behavioral/nextStep";

const FIRST = new Date(Date.now() - 90 * 86_400_000).toISOString();

function profileWithDebt(opening: number, closing: number, assets: number) {
  return buildObservedProfileV2({
    financialRow: { payload: { snapshot: { netWorth: { assets, owed: closing }, netWorthBridge: { openingDebts: opening, closingDebts: closing } } } },
    checkins: [], txStats: { count: 100, categorized: 90, active_days: 40, first_at: FIRST }, appActivity: null,
    goalCycles: [], planningStats: null, investmentStats: null,
  });
}

describe("dívidas: a nota reage ao esforço em vez de colar em zero", () => {
  it("dívida muito maior que os ativos, mas caindo: nota baixa porém acima de zero", () => {
    // caso real: R$ 65,5 mil de dívida, R$ 5,1 mil em ativos, saldo devedor caiu de R$ 71,4 mil
    const debt = profileWithDebt(71395.85, 65471.89, 5137.08).dimensions.debt;
    expect(debt.score).toBeGreaterThan(2);
    expect(debt.score).toBeLessThan(5);
    expect(debt.factors?.map((f) => f.key)).toEqual(["principal_trend", "debt_load"]);
    expect(debt.evidence).toMatch(/R\$ 65\.472 frente a R\$ 5\.137 em ativos; o saldo devedor caiu 8%/);
  });

  it("pagar mais dívida melhora a nota (antes saturava em 0 e escondia o progresso)", () => {
    const slow = profileWithDebt(71395.85, 70000, 5137.08).dimensions.debt.score!;
    const fast = profileWithDebt(71395.85, 60000, 5137.08).dimensions.debt.score!;
    expect(fast).toBeGreaterThan(slow);
  });

  it("sem dívida: nota alta; com dívida controlada frente aos ativos: nota média/alta", () => {
    expect(profileWithDebt(1000, 0, 5000).dimensions.debt.score).toBe(9.5);
    expect(profileWithDebt(2000, 1000, 20000).dimensions.debt.score!).toBeGreaterThan(7);
  });
});

describe("comparação só entre leituras que medem a mesma coisa", () => {
  const observed = profileWithDebt(71395.85, 65471.89, 5137.08);
  const snapshot = (factors: Array<{ key: string; label: string; value: number | null; weight: number | null }>, score = 5.7): ObservedSnapshot => ({
    week_start: "2026-09-14", overall_score: null, coverage: 1, confidence: "low", methodology_version: "behavior_observed.v2_backfill",
    dimensions: { debt: { score, confidence: "medium", factors } },
  });

  it("base reconstruída com outros componentes não vira 'piorou'", () => {
    const base = snapshot([{ key: "reduction", label: "Redução do saldo devedor", value: 5.7, weight: null }]);
    expect(isComparableDimension(observed.dimensions.debt, base.dimensions.debt)).toBe(false);
    const debt = compareDimensions(observed, base).find((c) => c.key === "debt")!;
    expect(debt.notComparable).toBe(true);
    expect(debt.direction).toBe("new");
    expect(debt.previous).toBeNull();
    expect(debt.delta).toBeNull();
    expect(debt.why).toMatch(/outros componentes.*não é melhora nem piora/);
  });

  it("mesmos componentes: compara normalmente", () => {
    const factors = observed.dimensions.debt.factors!.map((f) => ({ ...f, value: (f.value ?? 0) - 2 }));
    const debt = compareDimensions(observed, snapshot(factors, observed.dimensions.debt.score! - 2)).find((c) => c.key === "debt")!;
    expect(debt.notComparable).toBe(false);
    expect(debt.direction).toBe("better");
  });

  it("snapshot legado sem lista de componentes continua comparável", () => {
    expect(isComparableDimension(observed.dimensions.debt, { score: 5, confidence: "medium" })).toBe(true);
  });

  it("cada dimensão diz o que mede e o que ainda falta saber", () => {
    for (const dim of BEHAVIOR_DIMENSIONS) expect(DIMENSION_SCOPE[dim.key].length).toBeGreaterThan(40);
    const changes = compareDimensions(observed, null);
    const awareness = changes.find((c) => c.key === "awareness")!;
    expect(awareness.scope).toMatch(/Não mede o quanto você entende/);
    expect(awareness.missing.length).toBeGreaterThan(0);
  });
});

function profileOf(scores: Partial<Record<(typeof BEHAVIOR_DIMENSIONS)[number]["key"], [number | null, "low" | "medium" | "high"]>>): ObservedBehaviorProfile {
  return {
    overallScore: 5, coverage: 8, asOf: null,
    dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => {
      const [score, confidence] = scores[d.key] ?? [null, "low"];
      return [d.key, { score, confidence, evidence: `Evidência de ${d.label}.`, source: "test" }];
    })),
  } as ObservedBehaviorProfile;
}

describe("descoberta: a página começa por uma observação, não por um veredito", () => {
  it("percepção x registros: a maior distância com evidência suficiente, com pergunta e sem julgamento", () => {
    const profile = profileOf({ planning: [8, "medium"], awareness: [6, "medium"], debt: [1, "low"] });
    const d = buildHabitDiscovery({ profile, perception: { planning: 3, awareness: 5, debt: 9 }, changes: compareDimensions(profile, null) });
    expect(d.kind).toBe("perception_gap");
    expect(d.dimension).toBe("planning");
    expect(d.self).toBe(3);
    expect(d.observed).toBe(8);
    expect(d.title).toMatch(/Em Planejamento, você se vê abaixo do que seus registros mostram/);
    expect(d.body).toMatch(/duas leituras diferentes, não uma certa e outra errada/);
    expect(d.body).toMatch(/planejar ou em conseguir seguir/);
    expect(d.action?.to).toBe("#dimensao-planning");
  });

  it("evidência de baixa confiança não vira descoberta (a dívida com confiança baixa fica de fora)", () => {
    const profile = profileOf({ debt: [0, "low"], awareness: [6, "medium"] });
    const d = buildHabitDiscovery({ profile, perception: { debt: 9, awareness: 6 }, changes: compareDimensions(profile, null) });
    expect(d.kind).not.toBe("perception_gap");
  });

  it("sem distância relevante: mostra a dimensão com mais espaço, ligada a uma ação", () => {
    const profile = profileOf({ planning: [6, "medium"], security: [3.2, "medium"] });
    const d = buildHabitDiscovery({ profile, perception: { planning: 6, security: 3 }, changes: compareDimensions(profile, null) });
    expect(d.kind).toBe("room_to_grow");
    expect(d.dimension).toBe("security");
    expect(d.action?.to).toBe("/app/investimentos");
  });

  it("sem dados suficientes: diz que está começando, não que avaliou", () => {
    const d = buildHabitDiscovery({ profile: profileOf({}), perception: null, changes: compareDimensions(profileOf({}), null) });
    expect(d.kind).toBe("getting_started");
    expect(d.title).toMatch(/ainda está te conhecendo/);
    expect(d.action?.to).toBe("#checkin");
  });
});

describe("uma mudança possível, ligada ao combinado do fim de semana", () => {
  const base = { friday: "2026-10-09", category: "Lazer", target_amount: 160, projected_if_met: 1706, anchor_kind: "goal" as const, anchor_amount: 1060 };

  it("combinado aceito: mostra o limite e o fechamento de segunda", () => {
    const copy = nextStepCopy({ ...base, status: "accepted" }, null)!;
    expect(copy.title).toBe("Seu combinado deste fim de semana");
    expect(copy.body).toMatch(/Lazer: ficar em até R\$ 160/);
    expect(copy.body).toMatch(/o mês fecha em R\$ 1\.706/);
    expect(copy.body).toMatch(/Na segunda o Nino conta como foi/);
  });

  it("limite proposto e ainda não aceito: explica como combinar", () => {
    const copy = nextStepCopy({ ...base, status: "offered" }, null)!;
    expect(copy.body).toMatch(/responda “topo”/);
  });

  it("sem combinado: usa o ponto com mais espaço; sem nada, não mostra o bloco", () => {
    expect(nextStepCopy(null, { label: "Ver minhas dívidas", to: "/app/dividas", reason: "Dívidas é onde há mais espaço." })?.action?.to).toBe("/app/dividas");
    expect(nextStepCopy(null, null)).toBeNull();
  });
});

describe("a página e o impacto no dinheiro", () => {
  const parts = readFileSync("src/components/behavioral/EvolutionParts.tsx", "utf8");
  const page = readFileSync("src/pages/Emocoes.tsx", "utf8");
  const mood = readFileSync("src/components/behavioral/MoneyMoodTimeline.tsx", "utf8");

  it("não apresenta um total em reais como se fosse dinheiro perdido por emoção", () => {
    expect(parts).not.toMatch(/no total\./);
    expect(parts).not.toMatch(/extraTotal/);
    expect(parts).toMatch(/Um sinal para investigar, não uma conta do que se perdeu/);
    expect(parts).toMatch(/dia da semana, de compras necessárias, de gastos atípicos/);
  });

  it("a ordem é: descoberta → roda → mudança possível → o que mudou; semana a semana e experimentos ficam recolhidos", () => {
    const order = ["<HabitDiscoveryCard", "<BehaviorWheel", "<NextStepCard", "<VerdictStrip", "<WhatChanged", "<BehavioralInsightsCard", "<MoneyImpactCard"].map((t) => page.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page).toMatch(/<details className="space-y-3">[\s\S]*Ver a evolução semana a semana[\s\S]*<HabitTrend/);
    expect(page).toMatch(/Experimentos opcionais de 30 dias/);
    // com experimento ativo, o quadro aparece normalmente antes do check-in (não interrompe quem já começou)
    expect(page.indexOf("activeExperiments.length > 0")).toBeLessThan(page.indexOf('id="checkin"'));
    expect(page).toMatch(/activeExperiments\.length === 0 \? \(\s*<details id="experimentos"/);
  });

  it("Money Mood diferencia medição direta de estimativa no próprio gráfico", () => {
    expect(mood).toMatch(/Medição direta \(você informou\)/);
    expect(mood).toMatch(/Estimativa do check-in antigo/);
    expect(mood).toMatch(/payload\?\.direct/);
  });
});

describe("renderização dos blocos novos", () => {
  it("descoberta, mudança possível e impacto renderizam sem quebrar e com o texto esperado", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { MemoryRouter } = await import("react-router-dom");
    const { HabitDiscoveryCard, MoneyImpactCard, VerdictStrip } = await import("@/components/behavioral/EvolutionParts");
    const { NextStepCard } = await import("@/components/behavioral/NextStepCard");
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(HabitDiscoveryCard, { discovery: { kind: "perception_gap", title: "Em Planejamento, você se vê abaixo do que seus registros mostram", body: "Você se deu 3,0 e os sinais do Nino indicam 8,0.", dimension: "planning", self: 3, observed: 8, action: { label: "Ver como o Nino chegou nessa nota", to: "#dimensao-planning" } } }),
      createElement(VerdictStrip, { verdict: { kind: "insufficient", headline: "Ainda não dá para dizer se você melhorou", summary: "Poucas dimensões têm dados confiáveis.", improved: 0, worsened: 0, stable: 0, baselineDate: null, overallDelta: null } }),
      createElement(NextStepCard, { commitment: { friday: "2026-10-09", category: "Lazer", status: "accepted", target_amount: 160, projected_if_met: 1706, anchor_kind: "goal", anchor_amount: 1060 }, fallback: null }),
      createElement(MoneyImpactCard, { impact: { sufficient: true, pairedDays: 41, sensitiveAvg: 244.11, calmAvg: 85.29, extraPerDay: 158.82, sensitiveDays: 20, extraTotal: 3176.4, upliftPct: 186 } }),
    ));
    expect(html).toContain("Como você se vê");
    expect(html).toContain("Sinais do Nino");
    expect(html).toContain("href=\"#dimensao-planning\"");
    expect(html).toContain("Seu combinado deste fim de semana");
    expect(html).toContain("Um sinal para investigar");
    expect(html).not.toContain("3.176");
    expect(html).not.toContain("3176");
  });
});
