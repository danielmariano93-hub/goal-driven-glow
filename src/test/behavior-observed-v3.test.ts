import { describe, expect, it } from "vitest";
import { buildObservedProfileV3, OBSERVED_V3_METHODOLOGY_VERSION } from "@/lib/engine/behaviorObservedV3";
import { buildObservedProfileV2, type ObservedProfileV2Input } from "@/lib/engine/behaviorObserved";
import { compareDimensions, isMethodologyBreak, type ObservedSnapshot } from "@/lib/engine/behaviorEvolution";
import { BEHAVIOR_DIMENSIONS } from "@/lib/engine/behaviorDimensions";

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

const empty: ObservedProfileV2Input = {
  financialRow: null, checkins: [], txStats: null, appActivity: null, goalCycles: [], planningStats: null, investmentStats: null,
};

const checkin = (daysAgo: number, calm: number | null, i = daysAgo) => ({ id: `c${i}`, occurred_at: iso(daysAgo), mood: 3, financial_calm_score: calm });

describe("behavior_observed.v3 — evidência antes de nota", () => {
  it("AC-04: sem dados nenhuma dimensão ganha nota, nem 0", () => {
    const p = buildObservedProfileV3(empty, NOW);
    expect(p.methodologyVersion).toBe(OBSERVED_V3_METHODOLOGY_VERSION);
    expect(p.overallScore).toBeNull();
    expect(p.coverage).toBe(0);
    for (const d of BEHAVIOR_DIMENSIONS) {
      const dim = p.dimensions[d.key];
      expect(dim.score).toBeNull();
      expect(dim.score).not.toBe(0);
      expect(["none", "partial"]).toContain(dim.state);
      expect(dim.record?.unavailable_reason).toBeTruthy();
    }
  });

  it("planejamento: 6 metas + 87 acessos + 0 recorrências NÃO vira nota 8", () => {
    const input: ObservedProfileV2Input = {
      ...empty,
      appActivity: { active_days_30: 28, planning_views_30: 87, movement_views_30: 120 },
      planningStats: { active_category_goals: 6, active_recurring_rules: 0 },
    };
    const v2 = buildObservedProfileV2(input);
    const v3 = buildObservedProfileV3(input, NOW);
    expect(v2.dimensions.planning.score).not.toBeNull(); // o problema que o PDF aponta
    expect(v3.dimensions.planning.score).toBeNull();
    expect(v3.dimensions.planning.state).toBe("partial");
    expect(v3.dimensions.planning.record?.observed.join(" ")).toContain("6 metas");
    expect(v3.dimensions.planning.record?.unknown.join(" ")).toMatch(/ciclo fechado/);
    expect(JSON.stringify(v3.dimensions.planning)).not.toMatch(/87/);
  });

  it("consciência e consistência não nascem de volume de acesso", () => {
    const input: ObservedProfileV2Input = { ...empty, appActivity: { active_days_30: 30, movement_views_30: 400, total_views_30: 900 } };
    const v3 = buildObservedProfileV3(input, NOW);
    expect(v3.dimensions.awareness.score).toBeNull();
    expect(v3.dimensions.awareness.state).toBe("none");
    expect(v3.dimensions.consistency.score).toBeNull();
  });

  it("consciência com check-ins suficientes tem nota, mas nunca confiança alta (fonte única)", () => {
    const checkins = Array.from({ length: 9 }, (_, i) => checkin(i * 3, 5));
    const p = buildObservedProfileV3({ ...empty, checkins }, NOW);
    expect(p.dimensions.awareness.state).toBe("sufficient");
    expect(p.dimensions.awareness.score).not.toBeNull();
    expect(p.dimensions.awareness.confidence).not.toBe("high");
  });

  it("consciência: só check-ins não passam de 7,0; reconhecer padrões (respostas) libera o teto", () => {
    const checkins = Array.from({ length: 12 }, (_, i) => checkin(i * 2, 5, 100 + i));
    const only = buildObservedProfileV3({ ...empty, checkins }, NOW);
    expect(only.dimensions.awareness.score).toBeLessThanOrEqual(7);
    expect(only.dimensions.awareness.record?.observed.join(" ")).toMatch(/não passa de 7,0/);
    expect(only.dimensions.awareness.record?.unknown.join(" ")).toMatch(/responder as perguntas/);
    const declared = buildObservedProfileV3({ ...empty, checkins }, NOW, { declaredContextAnswers: 2 });
    expect(declared.dimensions.awareness.score).toBeGreaterThan(only.dimensions.awareness.score as number);
    expect(declared.dimensions.awareness.score).toBeLessThanOrEqual(10);
    expect(declared.dimensions.awareness.confidence).toBe("medium");
  });

  it("dívidas: nenhuma dívida registrada ≠ relação saudável (nem 0): fica sem nota", () => {
    const p = buildObservedProfileV3({ ...empty, financialRow: { payload: { snapshot: { netWorth: { assets: 5000, owed: 0 } } } } }, NOW);
    expect(p.dimensions.debt.score).toBeNull();
    expect(p.dimensions.debt.state).toBe("partial");
    expect(p.dimensions.debt.record?.unknown.join(" ")).toMatch(/fora do Nino/);
  });

  it("dívidas com saldo, ativos e histórico geram nota explicável", () => {
    const p = buildObservedProfileV3({
      ...empty,
      txStats: { count: 200, first_at: iso(90) },
      financialRow: { payload: { snapshot: { netWorth: { assets: 5000, owed: 20000 }, netWorthBridge: { openingDebts: 22000, closingDebts: 20000 } } } },
    }, NOW);
    expect(p.dimensions.debt.state).toBe("sufficient");
    expect(p.dimensions.debt.score).toBeGreaterThan(0);
    expect(p.dimensions.debt.record?.observed.join(" ")).toMatch(/R\$ 20\.000/);
  });

  it("segurança sem projeção de compromissos não inventa folga", () => {
    const p = buildObservedProfileV3({
      ...empty, txStats: { count: 100, first_at: iso(90) },
      financialRow: { payload: { snapshot: { monthlyTotals: { expense: 4000 }, availableToday: 1000 } } },
    }, NOW);
    expect(p.dimensions.security.score).toBeNull();
    expect(p.dimensions.security.state).toBe("partial");
  });

  it("tranquilidade: estimativas antigas não viram nota; 3 medições diretas viram", () => {
    const legacy = [checkin(3, null, 1), checkin(6, null, 2), checkin(9, null, 3)].map((c) => ({ ...c, mood: 4 }));
    const a = buildObservedProfileV3({ ...empty, checkins: legacy }, NOW);
    expect(a.dimensions.calm.score).toBeNull();
    expect(a.dimensions.calm.state).toBe("partial");
    const direct = [checkin(1, 4, 11), checkin(4, 6, 12), checkin(8, 5, 13)];
    const b = buildObservedProfileV3({ ...empty, checkins: direct }, NOW);
    expect(b.dimensions.calm.state).toBe("sufficient");
    expect(b.dimensions.calm.score).toBe(5);
  });

  it("patrimônio: um único aporte é sinal parcial, não recorrência", () => {
    const p = buildObservedProfileV3({ ...empty, investmentStats: { contributions_90d: 8000, contribution_days_90d: 1 } }, NOW);
    expect(p.dimensions.wealth.score).toBeNull();
    expect(p.dimensions.wealth.state).toBe("partial");
  });

  it("controle e planejamento ganham nota com ciclos de meta fechados (execução verificada)", () => {
    const goalCycles = [
      { target_snapshot: 500, actual_spend: 450, final_status: "achieved", closed_at: iso(40) },
      { target_snapshot: 500, actual_spend: 620, final_status: "exceeded", closed_at: iso(10) },
    ];
    const p = buildObservedProfileV3({ ...empty, goalCycles, planningStats: { active_category_goals: 3, active_recurring_rules: 2 } }, NOW);
    expect(p.dimensions.control.state).toBe("sufficient");
    expect(p.dimensions.planning.state).toBe("sufficient");
    expect(p.dimensions.control.record?.observed[0]).toMatch(/1 de 2 ciclos/);
  });

  it("toda dimensão carrega proveniência: fontes, janela, cobertura, versão e o que não prova", () => {
    const p = buildObservedProfileV3(empty, NOW);
    for (const d of BEHAVIOR_DIMENSIONS) {
      const r = p.dimensions[d.key].record!;
      expect(r.origin.length).toBeGreaterThan(0);
      expect(r.window).toBeTruthy();
      expect(r.coverage).toBeTruthy();
      expect(r.methodology_version).toBe(OBSERVED_V3_METHODOLOGY_VERSION);
      expect(r.limit.length).toBeGreaterThan(20);
    }
    // o limite de planejamento nomeia o proxy que não conta
    expect(p.dimensions.planning.record!.limit).toMatch(/telas de planejamento/);
  });
});

describe("AC-05: mudança de metodologia não vira melhora/piora", () => {
  const baseline = (v: string): ObservedSnapshot => ({
    week_start: "2026-09-07", overall_score: 6, coverage: 8, confidence: "medium", methodology_version: v,
    dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, { score: 3, confidence: "high" as const, factors: [] }])),
  });
  const input: ObservedProfileV2Input = {
    ...empty, txStats: { count: 200, first_at: iso(90) },
    financialRow: { payload: { snapshot: { netWorth: { assets: 5000, owed: 20000 }, netWorthBridge: { openingDebts: 22000, closingDebts: 20000 } } } },
  };

  it("v2 → v3: tudo não comparável, sem delta e com a explicação de ruptura", () => {
    const v3 = buildObservedProfileV3(input, NOW);
    const changes = compareDimensions(v3, baseline("behavior_observed.v2"));
    const debt = changes.find((c) => c.key === "debt")!;
    expect(debt.score).not.toBeNull();
    expect(debt.notComparable).toBe(true);
    expect(debt.delta).toBeNull();
    expect(debt.direction).toBe("new");
    expect(debt.why).toMatch(/comparação começa/);
  });

  it("v3 → v3 continua comparável", () => {
    const v3 = buildObservedProfileV3(input, NOW);
    const debt = compareDimensions(v3, baseline(OBSERVED_V3_METHODOLOGY_VERSION)).find((c) => c.key === "debt")!;
    expect(debt.notComparable).toBe(false);
  });

  it("v2 ↔ v2_backfill mantém o tratamento antigo (não é ruptura de v3)", () => {
    expect(isMethodologyBreak("behavior_observed.v2", "behavior_observed.v2_backfill")).toBe(false);
    expect(isMethodologyBreak("behavior_observed.v3", "behavior_observed.v2")).toBe(true);
  });
});
