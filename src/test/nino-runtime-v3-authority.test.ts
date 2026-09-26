import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { verifySemanticInvariantsV3 } from "../../supabase/functions/_shared/agent/v3/SemanticInvariantsV3";
import type { TaskTurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";

const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

function baseTask(task: TaskTurnSpecV3["tasks"][number]): TaskTurnSpecV3 {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    response_intent: "execute",
    act: "new_request",
    canonical_request: "teste canônico",
    inherit_topic: false,
    references: [],
    tasks: [task],
  };
}

describe("Nino Runtime V3 production authority", () => {
  it("routes normal semantic authority through V3 with a marked V2 circuit breaker", () => {
    const authority = readFileSync("supabase/functions/_shared/agent/core/ConversationAuthority.ts", "utf8");
    expect(authority).toContain('isEnabled("runtime_v3_authority_v1"');
    expect(authority).toContain("interpretSemanticTurnV3");
    expect(authority).toContain("bridgeTurnSpecV3ToRuntime");
    expect(authority).toContain("v3-authority:");
    expect(authority).toContain("v3-circuit-breaker:");

    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain('from "./ConversationAuthority.ts"');
    expect(core).toContain('v3AuthorityEnabled || await isEnabled("conversation_brain_v1"');
    const narrow = core.indexOf("resolveNarrowDeterministicTurn(brainText)");
    const authorityCall = core.indexOf("await interpretConversationTurn({", narrow);
    expect(narrow).toBeGreaterThan(0);
    expect(authorityCall).toBeGreaterThan(narrow);
  });

  it("does not double-call V3 shadow once authority owns the turn", () => {
    const entry = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2Entry.ts", "utf8");
    expect(entry).toContain('const authorityEnabled = await isEnabled("runtime_v3_authority_v1"');
    expect(entry).toContain("const shadowEnabled = !authorityEnabled");
  });

  it("bridges canonical historical monthly semantics into the mature financial runtime", () => {
    const turn = baseTask({
      kind: "financial_query",
      family: "financial.query",
      metric: "expense_amount",
      operation: "trend",
      group_by: ["month"],
      filters: [{ field: "category", entity: sourced("Lazer") }],
      periods: [sourced("últimos 5 meses")],
      limit: null,
      comparison: null,
    });
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract).toMatchObject({
      mode: "read",
      domain: "financial_read",
      focus: { category: "Lazer", period_expression: "últimos 5 meses" },
      financial_read: { queries: [{ metric: "expense_amount", operation: "trend", group_by: ["month"] }] },
    });
  });

  it("bridges habitual monthly value without inventing a historical window", () => {
    const turn = baseTask({
      kind: "financial_query",
      family: "financial.query",
      metric: "expense_amount",
      operation: "value",
      group_by: [],
      filters: [{ field: "category", entity: sourced("Assinaturas") }],
      periods: [],
      limit: null,
      comparison: null,
    });
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.focus.period_expressions).toEqual([]);
    expect(result.contract.financial_read?.queries[0]).toMatchObject({ operation: "value", group_by: [] });
  });

  it("bridges canonical transaction.create writes", () => {
    const turn = baseTask({
      kind: "financial_write",
      family: "financial.write",
      action: "transaction.create",
      slots: { amount: "50,00", merchant: "Teste" },
    });
    const result = bridgeTurnSpecV3ToRuntime(turn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract).toMatchObject({
      mode: "write",
      domain: "financial_write",
      action: { action: "transaction.create" },
    });
  });

  it("fails closed when a monthly series is emitted as sum/breakdown", () => {
    for (const operation of ["sum", "breakdown"] as const) {
      const turn = baseTask({
        kind: "financial_query",
        family: "financial.query",
        metric: "expense_amount",
        operation,
        group_by: ["month"],
        filters: [{ field: "category", entity: sourced("Lazer") }],
        periods: [sourced("últimos 5 meses")],
        limit: null,
        comparison: null,
      });
      const result = verifySemanticInvariantsV3(turn);
      expect(result.ok).toBe(false);
      expect(result.violations).toContain("task_0_monthly_series_requires_trend");
    }
  });

  it("hardens the V3 prompt/schema for production monthly semantics and writes", () => {
    const interpreter = readFileSync("supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts", "utf8");
    expect(interpreter).toContain("enum: [...ACTION_KINDS]");
    expect(interpreter).toContain('"Quanto gasto por mês com X?"');
    expect(interpreter).toContain("operation=trend");
    expect(interpreter).toContain('"Registre um gasto..." = transaction.create');

    const smoke = readFileSync("scripts/nino_conversation_provider_smoke.ts", "utf8");
    expect(smoke).toContain("interpretSemanticTurnV3");
    expect(smoke).toContain("V3 monthly authority smoke failed");
    expect(smoke).toContain("V3 write authority smoke failed");
  });
});
