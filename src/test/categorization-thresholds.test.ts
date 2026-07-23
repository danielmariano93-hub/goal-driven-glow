import { describe, it, expect } from "vitest";
import { parseThresholds, shouldAutoApply } from "../../supabase/functions/_shared/categorization/pipeline";

describe("categorization thresholds calibration", () => {
  it("parseThresholds aceita valores válidos e ignora inválidos", () => {
    const t = parseThresholds({ AUTO: 0.9, SUGGEST: 0.5, per_source: { history: 0.8, alias: 1.5 } });
    expect(t.AUTO).toBe(0.9);
    expect(t.SUGGEST).toBe(0.5);
    expect(t.per_source.history).toBe(0.8);
    // alias 1.5 é inválido, mantém default 0.98
    expect(t.per_source.alias).toBe(0.98);
  });

  it("parseThresholds cai no default quando payload é inválido", () => {
    const t = parseThresholds("{{lixo");
    expect(t.AUTO).toBe(0.85);
    expect(t.SUGGEST).toBe(0.6);
  });

  it("shouldAutoApply respeita threshold por fonte", () => {
    const T = parseThresholds({ AUTO: 0.85, per_source: { rule: 0.9 } });
    // rule com 0.85 já não passa (sobe para 0.9)
    expect(shouldAutoApply({ category_id: "x", category_source: "rule", category_confidence: 0.86, category_reason: "" }, T)).toBe(false);
    // alias com 0.98 default ainda passa
    expect(shouldAutoApply({ category_id: "x", category_source: "alias", category_confidence: 0.98, category_reason: "" }, T)).toBe(true);
  });

  it("shouldAutoApply é seguro sem thresholds explícitos", () => {
    expect(shouldAutoApply(null)).toBe(false);
    expect(shouldAutoApply({ category_id: "x", category_source: "history", category_confidence: 0.9, category_reason: "" })).toBe(true);
  });
});
