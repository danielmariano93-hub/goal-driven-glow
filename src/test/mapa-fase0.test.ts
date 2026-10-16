import { describe, it, expect } from "vitest";
import { buildObservedProfileV3 } from "@/lib/engine/behaviorObservedV3";
import { buildObservedProfileV2, monthlySpendingBase, monthNearlyClosed } from "@/lib/engine/behaviorObserved";

// Fase 0 do Mapa Financeiro: números que usavam o mês em andamento como se fosse o mês inteiro.
const NOW = new Date("2026-10-16T12:00:00Z").getTime();
const base = {
  checkins: [], txStats: { count: 400, first_at: "2026-02-01T00:00:00Z" }, appActivity: {}, goalCycles: [],
  planningStats: {}, investmentStats: { contributions_90d: 8000, contribution_days_90d: 2 },
} as never;
const snap = (over: Record<string, unknown> = {}) => ({
  financialRow: { payload: { snapshot: {
    availableToday: 1437.69,
    monthlyTotals: { income: 208.67, expense: 1584.57 },
    periodPerformance: { savingsRate: -6.43 },
    projection: { projectedTotalSpending: 10956.03, confidence: "high", daysRemaining: 14, freeAfterKnownCommitments: 4095.44, estimatedFixedInflows: 7800 },
    ...over,
  } } },
}) as never;
const text = (p: any, k: string) => (p.dimensions[k].record?.observed ?? []).join(" ");

describe("Segurança usa o gasto previsto do mês inteiro (G1)", () => {
  it("R$ 1.437 de caixa contra R$ 10.956 previstos ≈ 0,1 mês, não 0,9", () => {
    const p = buildObservedProfileV3({ ...(base as object), ...(snap() as object) } as never, NOW);
    const t = text(p, "security");
    expect(t).toMatch(/cerca de 0,1 mês do que você deve gastar neste mês/);
    expect(t).not.toMatch(/0,9/);
  });

  it("sem previsão confiável não inventa cobertura", () => {
    const p = buildObservedProfileV3({ ...(base as object), ...(snap({ projection: { confidence: "low" } }) as object) } as never, NOW);
    expect(text(p, "security")).not.toMatch(/cobre cerca de/);
    expect(p.dimensions.security.score).toBeNull();
  });

  it("o motor v2 usa a mesma base", () => {
    expect(monthlySpendingBase({ projection: { projectedTotalSpending: 10956.03, confidence: "high" } }).value).toBe(10956.03);
    expect(monthlySpendingBase({ monthlyTotals: { expense: 1584 } }).value).toBeNull();
    const v2 = buildObservedProfileV2({ ...(base as object), ...(snap() as object) } as never);
    expect(v2.dimensions.security.score).not.toBeNull();
  });
});

describe("Poupança e renda do mês só entram com o mês quase fechado (G2)", () => {
  it("dia 16: renda parcial não vira 'guardou -643%'", () => {
    const p = buildObservedProfileV3({ ...(base as object), ...(snap() as object) } as never, NOW);
    expect(text(p, "wealth")).not.toMatch(/guardou/);
    expect(text(p, "wealth")).not.toMatch(/643/);
  });

  it("mês quase fechado: poupança do mês entra", () => {
    const closing = snap({ projection: { projectedTotalSpending: 10956.03, confidence: "high", daysRemaining: 2 }, periodPerformance: { savingsRate: 0.12 } });
    const p = buildObservedProfileV3({ ...(base as object), ...(closing as object) } as never, NOW);
    expect(text(p, "wealth")).toMatch(/guardou 12% da renda/);
    expect(monthNearlyClosed({ projection: { daysRemaining: 2 } })).toBe(true);
    expect(monthNearlyClosed({ projection: { daysRemaining: 14 } })).toBe(false);
    expect(monthNearlyClosed({})).toBe(false);
  });
});

describe("rótulos honestos de Acompanhamento e Consistência", () => {
  it("o limite exibido diz que mede frequência, não o conceito", () => {
    const p = buildObservedProfileV3({ ...(base as object), ...(snap() as object) } as never, NOW);
    expect((p.dimensions.awareness.record as any)?.limit ?? "").toMatch(/com que frequência você faz check-ins/);
    expect((p.dimensions.consistency.record as any)?.limit ?? "").toMatch(/regularidade dos seus registros/);
  });
});
