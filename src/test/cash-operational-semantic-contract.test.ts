import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatFinancialEvolution,
  formatSpendingAnalysis,
} from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";

describe("contrato semântico — caixa versus operação", () => {
  it("não chama receita operacional de dinheiro que entrou na análise por período", () => {
    const reply = formatSpendingAnalysis({
      metric: "income",
      total_metric: 500,
      totals: { income: 500 },
      period: { from: "2026-09-01", to: "2026-09-20" },
      transactions_count: 2,
      view: "total",
    });

    expect(reply).toContain("as receitas da rotina somaram *R$ 500,00*");
    expect(reply).not.toContain("entraram");
  });

  it("não chama evolução de renda/consumo de fluxo de caixa", () => {
    const reply = formatFinancialEvolution({
      facts: { trend: "estavel", stability: "media" },
      breakdown: [{
        key: "30d", income: 1000, expense: 600, net: 400,
        expense_monthly_avg: 600,
      }],
    });

    expect(reply).toContain("receitas da rotina somaram *R$ 1.000,00*");
    expect(reply).toContain("gastos da rotina *R$ 600,00*");
    expect(reply).toContain("resultado operacional");
    expect(reply).not.toContain("entraram");
    expect(reply).not.toContain("saíram");
  });

  it("mantém o headline do motor e a revisão do assessor semanticamente explícitos", () => {
    const engineTools = readFileSync("supabase/functions/_shared/agent/engineTools.ts", "utf8");
    const advisor = readFileSync("supabase/functions/_shared/agent/core/AdvisorReviewServiceV2.ts", "utf8");

    expect(engineTools).toContain("as receitas da rotina somaram");
    expect(engineTools).toContain("gastos da rotina somaram");
    expect(advisor).toContain("As receitas da rotina somaram");
    expect(advisor).toContain("não o fluxo de caixa nem o saldo atual");
    expect(advisor).toContain("confirme o caixa disponível antes de efetivar o aporte");
    expect(advisor).not.toContain("explanation: `Entraram");
    expect(advisor).not.toContain("saldo registrado comporta");
  });
});
