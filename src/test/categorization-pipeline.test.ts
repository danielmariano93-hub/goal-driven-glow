import { describe, it, expect } from "vitest";
import {
  decideCategoryDeterministic, decideByHistory, decideByRule, shouldAutoApply, THRESHOLDS,
} from "../../supabase/functions/_shared/categorization/pipeline";
import { normalizedPattern, normalizeDescription } from "../../supabase/functions/_shared/categorization/normalize";

const CATS = [
  { id: "cat-lazer", name: "Lazer" },
  { id: "cat-transporte", name: "Transporte" },
  { id: "cat-saude", name: "Saúde" },
  { id: "cat-mercado", name: "Mercado" },
];

describe("normalize", () => {
  it("remove ruído bancário e adquirentes", () => {
    expect(normalizeDescription("COMPRA CARTAO REDECARD BAR DO ZE 12/07")).toContain("bar");
    expect(normalizeDescription("COMPRA CARTAO REDECARD BAR DO ZE 12/07")).not.toContain("redecard");
    expect(normalizedPattern("Uber *Trip 4321")).toBe("uber trip");
  });
});

describe("pipeline determinístico", () => {
  it("regra de Uber cai em Transporte", () => {
    const d = decideByRule("Uber Trip", CATS);
    expect(d?.category_id).toBe("cat-transporte");
    expect(d?.category_source).toBe("rule");
  });

  it("histórico com 3+ ocorrências e >=80% concordância vence regra", () => {
    const history = [
      { pattern: "bar ze", category_id: "cat-lazer", count: 4 },
      { pattern: "bar ze", category_id: "cat-mercado", count: 1 },
    ];
    const d = decideCategoryDeterministic({
      description: "BAR DO ZE 15/07", candidates: CATS, aliases: [], history,
    });
    expect(d?.category_id).toBe("cat-lazer");
    expect(d?.category_source).toBe("history");
    expect(d!.category_confidence).toBeGreaterThanOrEqual(0.85);
    expect(shouldAutoApply(d)).toBe(true);
  });

  it("histórico dividido não decide", () => {
    const history = [
      { pattern: "loja x", category_id: "cat-lazer", count: 3 },
      { pattern: "loja x", category_id: "cat-mercado", count: 3 },
    ];
    const d = decideByHistory("loja x", history);
    expect(d).toBeNull();
  });

  it("categoria explícita sempre vence com conf 1.0", () => {
    const d = decideCategoryDeterministic({
      explicit: "Saúde", description: "farmacia drogasil", candidates: CATS,
      aliases: [], history: [],
    });
    expect(d?.category_source).toBe("user");
    expect(d?.category_confidence).toBe(1.0);
    expect(d?.category_id).toBe("cat-saude");
  });

  it("alias confirmado vence histórico e regra", () => {
    const d = decideCategoryDeterministic({
      description: "farmacia drogasil sao paulo", candidates: CATS,
      aliases: [{ pattern: "farmacia drogasil sao", category_id: "cat-lazer", confidence: 0.95 }],
      history: [],
    });
    expect(d?.category_source).toBe("alias");
    expect(d?.category_id).toBe("cat-lazer");
  });

  it("thresholds seguros: 0.85 auto, 0.6 sugerir", () => {
    expect(THRESHOLDS.AUTO).toBe(0.85);
    expect(THRESHOLDS.SUGGEST).toBe(0.6);
  });
});
