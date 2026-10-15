import { describe, it, expect } from "vitest";
import { buildRecurringOverview, monthlyEquivalent } from "@/lib/engine/recurringOverview";

const rule = (id: string, name: string, amount: number, extra: any = {}) => ({ id, name, amount, kind: "expense", frequency: "monthly", status: "active", ...extra });

describe("buildRecurringOverview", () => {
  it("separa essencial de oportunidade e soma tudo", () => {
    const o = buildRecurringOverview({
      rules: [rule("1", "SEGURO CARTAO 0000", 12.94), rule("2", "Netflix", 44.9), rule("3", "Spotify", 23.9)],
      detected: [], debtInstallments: [{ id: "d", name: "Celular", amount: 100 }],
    });
    expect(o.essential).toBeCloseTo(112.94);
    expect(o.opportunity).toBeCloseTo(68.8);
    expect(o.total).toBeCloseTo(181.74);
  });
  it("regras duplicadas da mesma marca contam uma vez", () => {
    const o = buildRecurringOverview({ rules: [rule("1", "Apple (assinaturas)", 34.9), rule("2", "Apple (assinaturas)", 34.9), rule("3", "Apple (assinaturas)", 34.9)], detected: [], debtInstallments: [] });
    expect(o.opportunity).toBeCloseTo(34.9);
  });
  it("ignora pausadas e receitas; não duplica assinatura detectada já coberta por regra", () => {
    const o = buildRecurringOverview({
      rules: [rule("1", "Netflix", 44.9, { status: "paused" }), rule("2", "Salário", 5000, { kind: "income" }), rule("3", "Spotify", 23.9)],
      detected: [{ key: "k", name: "Spotify", monthly: 23.9 } as any, { key: "k2", name: "Netflix", monthly: 44.9 } as any],
      debtInstallments: [],
    });
    expect(o.opportunity).toBeCloseTo(68.8);
    expect(o.opportunities.map((i) => i.name).sort()).toEqual(["Netflix", "Spotify"]);
  });
  it("equivalente mensal", () => {
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
  });
});
