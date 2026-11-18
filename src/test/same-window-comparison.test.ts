import { describe, expect, it } from "vitest";
import { sameWindowComparison } from "../../supabase/functions/_shared/agent/core/SameWindowGuard";
import { comparisonHeader } from "../../supabase/functions/_shared/agent/core/ComparisonPresentation";

const nov = { from: "2026-11-01", to: "2026-11-18" }; // novembro até o dia 18
const outFull = { from: "2026-10-01", to: "2026-10-31" }; // outubro inteiro

describe("'mesmo período' compara os mesmos dias, não o mês anterior inteiro", () => {
  it("a pergunta do usuário: esse mês contra o mesmo período do mês anterior → 01/10 a 18/10", () => {
    const text = "Nino, como estou esse mês comparado com o mesmo período do mês anterior ?";
    expect(sameWindowComparison(text, nov, outFull)).toEqual({ from: "2026-10-01", to: "2026-10-18" });
  });
  it("a pergunta de seguimento 'o que teve em outubro nesse período' também recorta os mesmos dias", () => {
    const text = "Diminuíram onde? O que teve em outubro nesse período que não teve esse mês?";
    expect(sameWindowComparison(text, nov, outFull)).toEqual({ from: "2026-10-01", to: "2026-10-18" });
  });
  it("se o resolvedor devolveu a janela anterior de mesmo tamanho (14/10 a 31/10), ainda corrige quando o texto diz 'mês anterior'", () => {
    expect(sameWindowComparison("e no mesmo período do mês passado?", nov, { from: "2026-10-14", to: "2026-10-31" })).toEqual({ from: "2026-10-01", to: "2026-10-18" });
  });
  it("sem pedir o mesmo período, a comparação segue como foi resolvida (outubro inteiro é um pedido válido)", () => {
    expect(sameWindowComparison("compare outubro com novembro", nov, outFull)).toBeNull();
    expect(sameWindowComparison("quanto gastei em outubro inteiro contra novembro?", nov, outFull)).toBeNull();
  });
  it("período atual já é um mês completo: não há recorte parcial a alinhar", () => {
    expect(sameWindowComparison("compare com o mesmo período do mês anterior", outFull, { from: "2026-09-01", to: "2026-09-30" })).toBeNull();
  });
  it("já alinhado: não mexe", () => {
    expect(sameWindowComparison("contra o mesmo período do mês anterior", nov, { from: "2026-10-01", to: "2026-10-18" })).toBeNull();
  });
  it("outro mês que não o anterior: respeita o pedido", () => {
    expect(sameWindowComparison("e nesse período em setembro?", nov, { from: "2026-09-01", to: "2026-09-30" })).toBeNull();
  });
  it("recorte parcial que não começa no dia 1 e fim de mês curto (fevereiro)", () => {
    expect(sameWindowComparison("contra o mesmo período do mês anterior", { from: "2026-03-10", to: "2026-03-30" }, { from: "2026-02-01", to: "2026-02-28" }))
      .toEqual({ from: "2026-02-10", to: "2026-02-28" });
  });
  it("sem datas, não faz nada", () => {
    expect(sameWindowComparison("mesmo período do mês anterior", null, outFull)).toBeNull();
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
