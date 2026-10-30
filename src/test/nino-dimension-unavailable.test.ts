import { describe, expect, it } from "vitest";
import { normalizeSemanticInterpreterV3Output } from "../../supabase/functions/_shared/agent/v3/SemanticInterpreterV3";
import { unavailableDimensionOf, unavailableDimensionReply } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";

const turn = (financial: Record<string, unknown>) => ({
  version: "nino_turn_spec.v3", act: "ask", kind: "task", canonical_request: "q", inherit_topic: false, references: [],
  direct_reply: null, clarification_question: null,
  tasks: [{ kind: "financial_query", financial: {
    metric: "expense_amount", operation: "breakdown", group_by: [], filters: [], periods: [], limit: null, comparison: null, ...financial,
  }, goal: null, advisory: null, write: null }],
});

describe("dimensão pedida que o Nino não guarda", () => {
  it("o contrato carrega a expressão dita e a conversa recusa em vez de trocar de dimensão", () => {
    const normalized = normalizeSemanticInterpreterV3Output(turn({ unavailable_dimension: " horário do dia " }));
    expect(normalized).not.toBeNull();
    expect(unavailableDimensionOf(normalized as any)).toBe("horário do dia");
    const reply = unavailableDimensionReply("horário do dia");
    expect(reply).toContain("horário do dia");
    expect(reply).toMatch(/categoria/);
    expect(reply).not.toMatch(/R\$/);
  });

  it("sem a marca, a pergunta segue normal", () => {
    const normalized = normalizeSemanticInterpreterV3Output(turn({ unavailable_dimension: null, group_by: ["category"] }));
    expect(unavailableDimensionOf(normalized as any)).toBeNull();
    const missingField = normalizeSemanticInterpreterV3Output(turn({}));
    expect(unavailableDimensionOf(missingField as any)).toBeNull();
  });

  it("não deixa o texto da pessoa quebrar a formatação da resposta", () => {
    expect(unavailableDimensionReply("*hora* `do` _dia_")).toContain('"hora do dia"');
  });
});
