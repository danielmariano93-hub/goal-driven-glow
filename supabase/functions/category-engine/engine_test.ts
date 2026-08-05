import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyWithContext, isCategorizationEligible } from "../_shared/categorization/engine.ts";

const context = {
  candidates: [
    { id: "transport", name: "Transporte" },
    { id: "food", name: "Alimentação" },
  ],
  aliases: [{ pattern: "uber", category_id: "transport", confidence: 0.98 }],
  history: [],
  thresholds: { AUTO: 0.85, SUGGEST: 0.6, per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 0.75 } },
};

Deno.test("protege movimentos contábeis", () => {
  assertEquals(isCategorizationEligible({ type: "expense", description: "Fatura", settles_card_id: "card" }), false);
  const result = classifyWithContext({ type: "expense", description: "Fatura", settles_card_id: "card" }, context);
  assertEquals(result.action, "exclude");
});

Deno.test("autoaplica alias pessoal confirmado", () => {
  const result = classifyWithContext({ type: "expense", description: "PIX UBER *VIAGEM 123456" }, context);
  assertEquals(result.category_id, "transport");
  assertEquals(result.action, "auto_apply");
  assertEquals(result.category_source, "alias");
});

Deno.test("mantém ambiguidade para revisão", () => {
  const result = classifyWithContext({ type: "expense", description: "Loja desconhecida" }, context);
  assertEquals(result.category_id, null);
  assertEquals(result.action, "leave_unresolved");
});