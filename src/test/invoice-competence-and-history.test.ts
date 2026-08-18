import { describe, expect, it } from "vitest";
import { derivePreferencesFromRows } from "../../supabase/functions/_shared/categorization/personalHistory.ts";
import { normalizedPattern } from "../../supabase/functions/_shared/categorization/normalize.ts";

describe("verdade pessoal por histórico", () => {
  it("herda a categoria dominante de lançamentos confirmados", () => {
    const wanted = new Set([normalizedPattern("Turbi fechamento")]);
    const rows = [
      { description: "Turbi Fechamen 01/02", merchant_name: null, category_id: "cat-transporte" },
      { description: "TurbiSao Paulo 01/03", merchant_name: null, category_id: "cat-transporte" },
    ];
    const derived = derivePreferencesFromRows(rows, wanted);
    expect(derived).toHaveLength(1);
    expect(derived[0].category_id).toBe("cat-transporte");
    expect(derived[0].evidence_count).toBe(2);
  });

  it("não herda quando o histórico é ambíguo", () => {
    const wanted = new Set([normalizedPattern("Turbi fechamento")]);
    const rows = [
      { description: "Turbi 01/02", merchant_name: null, category_id: "cat-a" },
      { description: "Turbi 02/02", merchant_name: null, category_id: "cat-b" },
    ];
    expect(derivePreferencesFromRows(rows, wanted)).toHaveLength(0);
  });

  it("ignora merchants fora do documento e linhas sem categoria", () => {
    const wanted = new Set([normalizedPattern("Lovable")]);
    const rows = [
      { description: "LOVABLELOVABLE.DEVUS", merchant_name: "Lovable", category_id: "cat-software" },
      { description: "Eventim", merchant_name: null, category_id: "cat-lazer" },
      { description: "Lovable", merchant_name: null, category_id: null },
    ];
    const derived = derivePreferencesFromRows(rows, wanted);
    expect(derived).toEqual([{ merchant_key: "lovable", category_id: "cat-software", evidence_count: 1 }]);
  });
});
