import { describe, expect, it } from "vitest";
import {
  askForCategory, mentionsAnaphoricCategory, mentionsGoalAnchor,
} from "../../supabase/functions/_shared/agent/core/MerchantScope.ts";
import { distributionHeadline } from "../../supabase/functions/_shared/agent/engineTools.ts";
import { formatMerchantDistribution } from "../../supabase/functions/_shared/agent/core/DeterministicAnswers.ts";

describe("escopo de distribuição por estabelecimento", () => {
  it("reconhece referência anafórica de categoria", () => {
    expect(mentionsAnaphoricCategory("quais locais gastei naquela categoria")).toBe(true);
    expect(mentionsAnaphoricCategory("quanto gastei em alimentação")).toBe(false);
  });

  it("reconhece âncora de meta", () => {
    expect(mentionsGoalAnchor("vi que uma das minhas metas foi ultrapassada")).toBe(true);
  });

  it("pede a categoria em vez de responder global", () => {
    expect(askForCategory()).toMatch(/qual categoria/i);
  });

  it("headline declara escopo global quando não há categoria", () => {
    const headline = distributionHeadline({
      category: { name: null },
      category_total: 10715.54,
      resolved_total: 10715.54,
      coverage: 1,
      merchants: [{ merchant: "Uber", amount: 300, share_of_category: 0.03 }],
      period: { from: "2026-08-01", to: "2026-08-18" },
      scope: "all_categories",
    });
    expect(headline).toContain("considerando todas as categorias");
  });

  it("layout preserva linhas e destaca escopo da categoria", () => {
    const reply = formatMerchantDistribution({
      category: { name: "Alimentação" },
      category_total: 500,
      resolved_total: 500,
      coverage: 1,
      period: { from: "2026-08-01", to: "2026-08-18" },
      merchants: [
        { merchant: "99 Food", amount: 190.05, share_of_category: 0.38, transactions_count: 4 },
        { merchant: "iFood", amount: 120, share_of_category: 0.24, transactions_count: 2 },
      ],
    });
    expect(reply.split("\n").length).toBeGreaterThan(3);
    expect(reply).toContain("*Alimentação*");
    expect(reply).toContain("*99 Food*");
  });
});
