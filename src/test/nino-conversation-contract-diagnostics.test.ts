import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conversationContractRepairHint,
  diagnoseConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnDiagnostics.ts";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract.ts";

function validRead(overrides: Record<string, unknown> = {}) {
  return {
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Quanto gastei com Alimentação em agosto?",
    inherit_focus: false,
    focus: {
      category: "Alimentação",
      merchant: null,
      goal: null,
      period_expression: "agosto",
      period_expressions: ["agosto"],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "resolved",
      entity: "resolved",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [{ field: "category", value: "Alimentação" }],
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    },
    advisory_kind: null,
    ...overrides,
  };
}

describe("ConversationTurnContract diagnostics", () => {
  it("returns no reasons for a canonical contract", () => {
    expect(diagnoseConversationTurnContract(validRead())).toEqual({ valid: true, reasons: [] });
  });

  it("makes read + conversation structurally impossible (metas/compiler_failed regression)", () => {
    const candidate = validRead({
      domain: "conversation",
      financial_read: null,
    });

    expect(normalizeConversationTurnContract(candidate)).toBeNull();
    const diagnosis = diagnoseConversationTurnContract(candidate);
    expect(diagnosis.valid).toBe(false);
    expect(diagnosis.reasons).toContain("read_domain_mismatch");
    expect(conversationContractRepairHint(candidate)).toContain("INVALID_REASONS: read_domain_mismatch");
  });

  it("identifies missing financial semantics on an explicit financial_read", () => {
    const diagnosis = diagnoseConversationTurnContract(validRead({ financial_read: null }));
    expect(diagnosis.reasons).toContain("financial_read_missing_or_invalid");
    expect(conversationContractRepairHint(validRead({ financial_read: null })))
      .toContain("INVALID_REASONS: financial_read_missing_or_invalid");
  });

  it("identifies unresolved time/entity instead of returning opaque invalid", () => {
    const candidate = validRead({
      resolution: {
        intent: "resolved",
        reference: "not_applicable",
        time: "ambiguous",
        entity: "missing",
        action: "not_applicable",
      },
    });
    const diagnosis = diagnoseConversationTurnContract(candidate);
    expect(diagnosis.reasons).toEqual(expect.arrayContaining([
      "read_time_unresolved",
      "read_entity_unresolved",
    ]));
  });

  it("identifies broken continuation inheritance", () => {
    const diagnosis = diagnoseConversationTurnContract(validRead({
      act: "follow_up",
      inherit_focus: false,
    }));
    expect(diagnosis.reasons).toContain("continuation_without_focus_inheritance");
  });

  it("wires deterministic reason codes into ConversationBrain repair and telemetry", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/ConversationBrain.ts", "utf8");
    expect(source).toContain("diagnoseConversationTurnContract");
    expect(source).toContain("INVALID_REASONS:");
    expect(source).toContain("contract_invalid_reasons: invalidReasons");
    expect(source).toContain("Corrija exatamente os invariantes listados acima");
  });
});
