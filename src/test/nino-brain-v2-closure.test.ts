// Fechamento do Nino Brain v2: formatters determinísticos, intenção visual
// explícita, memória conversacional, proveniência de claims e aviso de espera.
import { describe, expect, it } from "vitest";
import { hasExplicitChartIntent } from "../../supabase/functions/_shared/intelligence/chartIntent";
import {
  formatMerchantDistribution,
  formatFinancialEvolution,
} from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";
import { validateAgainstEvidence } from "../../supabase/functions/_shared/agent/core/TruthValidator";
import {
  applyMemoryToText, detectCategory, emptyMemory, isExpired, wantsTopicResume,
} from "../../supabase/functions/_shared/agent/core/ConversationMemory";
import { ackMessageFor } from "../../supabase/functions/_shared/agent/core/Acknowledgement";

describe("intenção visual explícita", () => {
  it("gráfico só quando pedido de verdade", () => {
    expect(hasExplicitChartIntent("me manda um gráfico de barras")).toBe(true);
    expect(hasExplicitChartIntent("quero ver a visualização disso")).toBe(true);
  });

  it("evolução e tendência são análise textual", () => {
    expect(hasExplicitChartIntent("qual a evolução dos meus gastos?")).toBe(false);
    expect(hasExplicitChartIntent("estou reduzindo? qual a tendência?")).toBe(false);
    expect(hasExplicitChartIntent("quanto gastei dia a dia")).toBe(false);
  });
});

describe("merchant distribution determinística", () => {
  const result = {
    period: { from: "2026-08-01", to: "2026-08-16", label: "agosto" },
    category: { id: "c1", name: "Alimentação" },
    category_total: 1000,
    resolved_total: 900,
    unresolved_total: 100,
    coverage: 0.9,
    merchants: [
      { merchant: "iFood", amount: 700, share_of_category: 0.7, transactions_count: 12 },
      { merchant: "99 Food", amount: 200, share_of_category: 0.2, transactions_count: 3 },
    ],
  };

  it("apresenta total, ranking, percentual e cobertura sem LLM", () => {
    const text = formatMerchantDistribution(result);
    expect(text).toContain("Alimentação");
    expect(text).toMatch(/R\$\s?1\.000,00/);
    expect(text).toContain("1. iFood");
    expect(text).toContain("70");
    expect(text).toContain("cobertura");
  });

  it("percentuais e total sobrevivem ao gate factual", () => {
    const text = formatMerchantDistribution(result);
    const verdict = validateAgainstEvidence(text, [
      { tool_name: "merchant_distribution", ok: true, result },
    ]);
    expect(verdict.ok).toBe(true);
  });

  it("período vazio não inventa número", () => {
    const text = formatMerchantDistribution({ ...result, category_total: 0, merchants: [] });
    expect(text).toContain("Não encontrei gastos");
  });
});

describe("proveniência de claims", () => {
  const calls = [{ tool_name: "get_financial_snapshot", ok: true, result: { total_expense: 1250.5 } }];

  it("liga cada número à ferramenta que o produziu", () => {
    const verdict = validateAgainstEvidence("Saíram R$ 1.250,50 no período.", calls);
    expect(verdict.ok).toBe(true);
    expect(verdict.provenance[0]).toMatchObject({
      kind: "money", tool_name: "get_financial_snapshot", origin: "exact",
    });
    expect(verdict.unbacked).toHaveLength(0);
  });

  it("marca número inventado como sem proveniência", () => {
    const verdict = validateAgainstEvidence("Saíram R$ 9.999,00 no período.", calls);
    expect(verdict.ok).toBe(false);
    expect(verdict.unbacked.map((c) => c.value)).toContain(9999);
  });
});

describe("memória conversacional", () => {
  it("detecta categoria citada e pedido de retomada", () => {
    expect(detectCategory("quanto gastei com ifood?")).toBe("Alimentação");
    expect(detectCategory("e no uber?")).toBe("Transporte");
    expect(wantsTopicResume("voltando para alimentação")).toBe(true);
  });

  it("herda o tópico ativo em follow-up sem assunto próprio", () => {
    const memory = { ...emptyMemory(), active_category: "Alimentação", updated_at: new Date().toISOString() };
    const applied = applyMemoryToText("e no mês passado?", memory, { followup: true });
    expect(applied.used).toBe(true);
    expect(applied.text).toContain("Alimentação");
  });

  it("não sobrescreve assunto explícito da mensagem atual", () => {
    const memory = { ...emptyMemory(), active_category: "Alimentação", updated_at: new Date().toISOString() };
    const applied = applyMemoryToText("quanto gastei com transporte?", memory, { followup: true });
    expect(applied.used).toBe(false);
  });

  it("expira memória antiga", () => {
    expect(isExpired({ ...emptyMemory(), updated_at: new Date(Date.now() - 7 * 3600_000).toISOString() })).toBe(true);
    expect(isExpired({ ...emptyMemory(), updated_at: new Date().toISOString() })).toBe(false);
  });
});

describe("aviso de espera contextual", () => {
  it("descreve o que está sendo feito", () => {
    expect(ackMessageFor("me manda o gráfico")).toContain("gráfico");
    expect(ackMessageFor("segue a fatura em pdf")).toContain("lançamentos");
    expect(ackMessageFor("quanto vou fechar o mês?")).toContain("fechamento");
    expect(ackMessageFor("quanto gastei em agosto?")).toContain("somando");
  });
});

describe("evolução financeira textual", () => {
  it("formata sem prometer gráfico", () => {
    const text = formatFinancialEvolution({
      facts: { trend: "melhorando", expense_trend_pct: -8.4, stability: "alta" },
      breakdown: [{ key: "30d", income: 5000, expense: 3800, net: 1200 }],
    });
    expect(text).not.toMatch(/gr[aá]fico/i);
    expect(text).toMatch(/R\$\s?3\.800,00/);
    expect(text).toContain("gastando menos");
  });
});
