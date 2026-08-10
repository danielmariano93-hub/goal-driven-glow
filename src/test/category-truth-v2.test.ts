import { describe, expect, it } from "vitest";
import { storageMerchantKey, normalizedPattern } from "../../supabase/functions/_shared/categorization/normalize";
import { classifyWithContext, isCategorizationEligible, resultFromLlm } from "../../supabase/functions/_shared/categorization/engine";

const CATS = [
  { id: "food", name: "Alimentação", slug: "alimentacao", user_id: null },
  { id: "market", name: "Mercado", slug: "mercado", user_id: null },
  { id: "transport", name: "Transporte", slug: "transporte", user_id: null },
  { id: "salary", name: "Salário", slug: "salario", user_id: null },
];
const thresholds = { AUTO: 0.85, SUGGEST: 0.6, per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 1, personal: 0.95, global: 0.95 } };
function ctx(extra: Record<string, unknown> = {}) {
  return { candidates: CATS, aliases: [], history: [], preferences: [], globalKnowledge: [], thresholds, ...extra } as any;
}

describe("Category Truth V2", () => {
  it("preserva dígitos e remove ruído bancário na identidade do merchant", () => {
    expect(storageMerchantKey("Souk4u")).toBe("souk4u");
    expect(normalizedPattern("PAY Souk4u 123456")).toBe("souk4u");
    expect(normalizedPattern("Autopass s.a*atm Tmob")).toBe("autopass");
    expect(normalizedPattern("BAR DO ZE 15/07")).toBe("bar ze");
    expect(normalizedPattern("99 APP 123456")).toBe("99 app");
  });

  it("preferência pessoal vence conhecimento global", () => {
    const r = classifyWithContext({ type: "expense", description: "Souk4u" }, ctx({
      preferences: [{ merchant_key: "souk4u", category_id: "food", evidence_count: 4 }],
      globalKnowledge: [{ merchant_key: "market4you", semantic_category_slug: "mercado", patterns: ["souk4u"], confidence: .99, status: "curated" }],
    }));
    expect(r.category_id).toBe("food");
    expect(r.category_source).toBe("personal");
    expect(r.action).toBe("auto_apply");
  });

  it("usuário novo herda merchant global curado", () => {
    const r = classifyWithContext({ type: "expense", description: "Souk4u" }, ctx());
    expect(r.category_id).toBe("market");
    expect(r.category_source).toBe("global");
    expect(r.action).toBe("auto_apply");
  });

  it("Autopass com ruído bancário resolve Transporte", () => {
    const r = classifyWithContext({ type: "expense", description: "Autopass s.a*atm Tmob" }, ctx());
    expect(r.category_id).toBe("transport");
    expect(r.action).toBe("auto_apply");
  });

  it("Uber Eats não é confundido com corrida Uber", () => {
    const r = classifyWithContext({ type: "expense", description: "UBER * EATS" }, ctx());
    expect(r.category_id).toBe("food");
    expect(r.category_source).toBe("global");
    expect(r.action).toBe("auto_apply");
  });

  it("LLM sozinho nunca autoaplica e respeita conjunto do tipo", () => {
    const ok = resultFromLlm({ category_id: "transport", confidence: .99 }, new Set(["transport","food","market"]));
    expect(ok?.action).toBe("suggest_review");
    expect(ok?.category_confidence).toBeLessThanOrEqual(.9);
    expect(resultFromLlm({ category_id: "salary", confidence: .99 }, new Set(["transport","food","market"]))).toBeNull();
  });

  it("movimentos não-consumo e split ficam fora", () => {
    expect(isCategorizationEligible({ type: "expense", description: "Fatura", settles_card_id: "card" })).toBe(false);
    expect(isCategorizationEligible({ type: "expense", description: "Rolê", shared_expense_id: "split" })).toBe(false);
  });
});
