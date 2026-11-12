import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryGoalImpact } from "@/components/planning/CategoryGoalImpact";
import { goalImpactView, percentText } from "@/lib/nino/categoryGoalImpact";

const base = { categoryName: "Transporte", limit: 2000, spent: 1790.63 };

describe("impacto da compra na meta da categoria", () => {
  it("cabe: usa uma fração pequena do que ainda cabia", () => {
    const v = goalImpactView({ ...base, remainingBefore: 209.37, remainingAfter: 197.37 });
    expect(v.status).toBe("fits");
    expect(v.applied).toBe(12);
    expect(v.usedOfRemaining).toBeCloseTo(12 / 209.37, 5);
    expect(percentText(v.usedOfRemaining!)).toBe("6%");
    expect(percentText(0.004)).toBe("menos de 1%");
  });
  it("estoura: sobra negativa depois da compra", () => {
    expect(goalImpactView({ ...base, remainingBefore: 5, remainingAfter: -7 }).status).toBe("exceeds");
  });
  it("já estava estourada: a compra só aumenta o estouro", () => {
    expect(goalImpactView({ ...base, remainingBefore: -30, remainingAfter: -42 }).status).toBe("was_over");
  });
  it("cai fora do período da meta: não muda nada", () => {
    const v = goalImpactView({ ...base, remainingBefore: 209.37, remainingAfter: 209.37 });
    expect(v).toMatchObject({ status: "outside", applied: 0, purchaseFrac: 0 });
  });
});

describe("bloco de impacto na meta (tela)", () => {
  it("à vista que cabe: título, frase, valores", () => {
    render(<CategoryGoalImpact impact={{ ...base, remainingBefore: 209.37, remainingAfter: 197.37 }} installments={1} plan={null} />);
    expect(screen.getByText("Impacto na meta de Transporte")).toBeTruthy();
    expect(screen.getByText("Cabe na meta")).toBeTruthy();
    expect(screen.getByText(/A compra usa 6% do que ainda cabia/)).toBeTruthy();
    expect(screen.getByText("Com a compra")).toBeTruthy();
  });
  it("estourando: avisa em quanto passa", () => {
    render(<CategoryGoalImpact impact={{ ...base, spent: 1995, remainingBefore: 5, remainingAfter: -7 }} installments={1} plan={null} />);
    expect(screen.getByText("Estoura a meta")).toBeTruthy();
    expect(screen.getByText(/A compra passa R\$\s7,00 do limite/)).toBeTruthy();
  });
  it("fora do período: não muda nada", () => {
    render(<CategoryGoalImpact impact={{ ...base, remainingBefore: 209.37, remainingAfter: 209.37 }} installments={1} plan={null} />);
    expect(screen.getByText("Não muda nada na meta")).toBeTruthy();
    expect(screen.getByText("Sobra")).toBeTruthy();
  });
  it("parcelado: lista a meta mês a mês", () => {
    const plan = { months: [
      { label: "Novembro", category: { limit: 2000, after: 1802.63, exceeds_limit: false } },
      { label: "Dezembro", category: { limit: 2000, after: 2050, exceeds_limit: true } },
      { label: "Janeiro", category: { limit: null, after: 100, exceeds_limit: false } },
    ] } as never;
    render(<CategoryGoalImpact impact={{ ...base, remainingBefore: 209.37, remainingAfter: 197.37 }} installments={3} plan={plan} />);
    expect(screen.getByText("Parcelas e a meta")).toBeTruthy();
    expect(screen.getByText("Novembro")).toBeTruthy();
    expect(screen.getByText("dentro")).toBeTruthy();
    expect(screen.getByText("estoura")).toBeTruthy();
    expect(screen.queryByText("Janeiro")).toBeNull();
  });
});
