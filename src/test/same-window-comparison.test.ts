import { describe, expect, it } from "vitest";
import { comparisonHeader } from "../../supabase/functions/_shared/agent/core/ComparisonPresentation";

const nov = { from: "2026-11-01", to: "2026-11-18" }; // novembro até o dia 18
const outFull = { from: "2026-10-01", to: "2026-10-31" }; // outubro inteiro

describe("a resposta diz a suposição", () => {
  const r = (a: any, b: any) => ({ period_a: a, period_b: b, total_a: 100, total_b: 90, requested_group_by: "none" });
  it("avisa que comparou os mesmos dias", () => {
    const h = comparisonHeader(r({ from: "2026-10-01", to: "2026-10-18" }, nov)) ?? "";
    expect(h).toContain("Comparei os mesmos 18 dias");
  });
  it("meses inteiros não levam o aviso", () => {
    const h = comparisonHeader(r({ from: "2026-09-01", to: "2026-09-30" }, outFull)) ?? "";
    expect(h).not.toContain("Comparei os mesmos");
  });
});

describe("aviso quando os períodos comparados têm tamanhos muito diferentes", () => {
  const result = (a: any, b: any) => ({ period_a: a, period_b: b, total_a: 14518.05, total_b: 1931.62, requested_group_by: "none" });
  it("18 dias contra 31 dias avisa que a diferença pode estar exagerada", () => {
    const h = comparisonHeader(result(outFull, nov)) ?? "";
    expect(h).toContain("Os períodos não têm o mesmo tamanho");
    expect(h).toContain("18 dias");
    expect(h).toContain("31");
  });
  it("mesmo tamanho não avisa", () => {
    const h = comparisonHeader(result({ from: "2026-10-01", to: "2026-10-18" }, nov)) ?? "";
    expect(h).not.toContain("não têm o mesmo tamanho");
  });
  it("meses completos de 30 e 31 dias não disparam o aviso", () => {
    const h = comparisonHeader(result({ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" })) ?? "";
    expect(h).not.toContain("não têm o mesmo tamanho");
  });
});
