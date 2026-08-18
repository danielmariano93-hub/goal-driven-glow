import { describe, expect, it } from "vitest";
import { brandToken, derivePreferencesFromRows } from "../../supabase/functions/_shared/categorization/personalHistory.ts";
import { normalizedPattern } from "../../supabase/functions/_shared/categorization/normalize.ts";

describe("verdade pessoal por histórico", () => {
  it("herda a categoria dominante mesmo com sufixos de extrato", () => {
    const rows = [
      { description: "Turbi Fechamen 01/02", merchant_name: null, category_id: "cat-transporte" },
      { description: "TurbiSao Paulo 01/03", merchant_name: null, category_id: "cat-transporte" },
    ];
    const derived = derivePreferencesFromRows(rows, ["Turbi fechamento 05/09"]);
    expect(derived).toHaveLength(1);
    expect(derived[0].merchant_key).toBe(normalizedPattern("Turbi fechamento 05/09"));
    expect(derived[0].category_id).toBe("cat-transporte");
    expect(derived[0].evidence_count).toBe(2);
  });

  it("não herda quando o histórico é ambíguo", () => {
    const rows = [
      { description: "Turbi 01/02", merchant_name: null, category_id: "cat-a" },
      { description: "Turbi 02/02", merchant_name: null, category_id: "cat-b" },
    ];
    expect(derivePreferencesFromRows(rows, ["Turbi fechamento"])).toHaveLength(0);
  });

  it("ignora marcas diferentes e linhas sem categoria", () => {
    const rows = [
      { description: "LOVABLELOVABLE.DEVUS", merchant_name: "Lovable", category_id: "cat-software" },
      { description: "Eventim Brasil", merchant_name: null, category_id: "cat-lazer" },
      { description: "Lovable", merchant_name: null, category_id: null },
    ];
    const derived = derivePreferencesFromRows(rows, ["Lovable"]);
    expect(derived).toEqual([{ merchant_key: "lovable", category_id: "cat-software", evidence_count: 1 }]);
  });

  it("marca exige token relevante", () => {
    expect(brandToken("99")).toBe("");
    expect(brandToken("Eventim Brasil")).toBe("eventim");
  });
});
