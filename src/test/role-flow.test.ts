import { describe, expect, it } from "vitest";
import { computeRoleFlow, sourcesBalance, splitCents, type FlowReceivable, type FlowSource } from "@/lib/split/roleFlow";

// Caso real: Réveillon RJ — R$ 7.250 = dívida da tia 6.264 (4x) + cartão próprio 986 (6x);
// 7 amigos pagam R$ 906,25 cada em 6 parcelas mensais.
const friends = (): FlowReceivable[] => {
  const parts = splitCents(906.25, 6);
  const rows: FlowReceivable[] = [];
  for (let f = 0; f < 7; f += 1) parts.forEach((amount, i) => rows.push({ due_date: `2026-${String(11 + i > 12 ? 11 + i - 12 : 11 + i).padStart(2, "0")}-07`.replace(/^2026-(0[1-4])/, "2027-$1"), amount }));
  return rows;
};
const sources: FlowSource[] = [
  { kind: "debt", amount: 6264, debt: { installments_total: 4, first_due_date: "2026-11-01" } },
  { kind: "credit_card", amount: 986, installments: 6, first_due: "2026-11-10" },
];

describe("fluxo do rolê", () => {
  it("fecha exatamente na parte do dono (−906,25) e acha o pico de adiantamento", () => {
    const flow = computeRoleFlow(sources, friends(), "2026-10-27");
    expect(flow.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
    expect(flow.endBalance).toBe(-906.25);
    expect(flow.peakMonth).toBe("2027-02");
    expect(flow.peakExposure).toBeCloseTo(2692.17, 1);
    // meses 1–4: entra menos do que sai; meses 5–6: sobra
    expect(flow.months[0]!.net).toBeLessThan(-600);
    expect(flow.months[4]!.net).toBeGreaterThan(800);
  });

  it("parcelas em centavos exatos (o resto vai para as primeiras)", () => {
    expect(splitCents(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(splitCents(6264, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(6264, 2);
  });

  it("origem em conta sai de uma vez, no mês do gasto", () => {
    const flow = computeRoleFlow([{ kind: "account", amount: 300 }], [{ due_date: "2026-12-05", amount: 100 }], "2026-11-20");
    expect(flow.months[0]).toMatchObject({ month: "2026-11", outflow: 300 });
    expect(flow.endBalance).toBe(-200);
  });

  it("sem dados não inventa fluxo", () => {
    expect(computeRoleFlow([], [], "2026-10-27")).toEqual({ months: [], peakExposure: 0, peakMonth: null, endBalance: 0 });
  });

  it("a soma das origens precisa fechar com o total", () => {
    expect(sourcesBalance(7250, [6264, 986])).toEqual({ sum: 7250, remaining: 0, ok: true });
    expect(sourcesBalance(7250, [6264]).ok).toBe(false);
    expect(sourcesBalance(7250, [6264]).remaining).toBe(986);
  });
});
