import { describe, expect, it } from "vitest";
import { resolveExplicitPeriodPt } from "../../supabase/functions/_shared/analytics/explicitPeriodResolver";
import { resolvePeriodExpressions } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";
import { buildTemporalContractV3 } from "../../supabase/functions/_shared/agent/v3/TemporalContractV3";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { verifySemanticInvariantsV3 } from "../../supabase/functions/_shared/agent/v3/SemanticInvariantsV3";
import type { TaskTurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import {
  buildFinancialReadContract,
  validateFinancialReadContract,
} from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { trustedActivePeriod } from "../../supabase/functions/_shared/agent/core/ConversationMemory";
import { classifyConfirmationAct } from "../../supabase/functions/_shared/agent/core/ConfirmationVocabulary";
import { isProviderStructuredFailure } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";
import { buildEvidenceClaims } from "../../supabase/functions/_shared/agent/core/EvidenceClaims";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";

const NOW = new Date("2026-09-28T15:00:00-03:00");
const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

function expenseTurn(period: string): TaskTurnSpecV3 {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    response_intent: "execute",
    act: "new_request",
    canonical_request: `quanto gastei ${period}`,
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_query",
      family: "financial.query",
      metric: "expense_amount",
      operation: "sum",
      group_by: [],
      filters: [],
      periods: [sourced(period)],
      limit: null,
      comparison: null,
    }],
  };
}

function financialIr(from: string, to: string) {
  return {
    version: "financial_query_ir.v3",
    intent: "lookup",
    dialogue: { acts: ["question"], topic_id: null },
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount",
      filters: [],
      time: { aspect: "calendar", from, to, n: null, exclude_partial: false, label: `${from}..${to}` },
      grain: "none",
      reduce: "sum",
      group_by: [],
      limit: null,
      comparison_direction: "any",
      comparison_baseline: "period",
      comparison_baseline_window: null,
      depends_on: [],
      legacy_operation: "sum",
    }],
    completeness_targets: [],
    period: { from, to, label: `${from}..${to}` },
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
  } as any;
}

describe("Nino V3 single-route hardening", () => {
  it.each([
    "21/09/2026 a 27/09/2026",
    "do dia 21 ao dia 27",
    "semana passada do dia 21 ao dia 27",
    "21-27",
  ])("grounds equivalent explicit period '%s' to the same canonical window", (text) => {
    const period = resolveExplicitPeriodPt(text, NOW);
    expect(period).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("never discards a single authoritative period expression to reparse raw text", () => {
    const resolved = resolvePeriodExpressions(
      ["21-27"],
      "quanto eu gastei este mês?",
      NOW,
    );
    expect(resolved.source).toBe("single");
    expect(resolved.periods).toHaveLength(1);
    expect(resolved.periods[0]).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("fails closed when an authoritative temporal slot cannot be grounded", () => {
    const resolved = resolvePeriodExpressions(["quando eu era criança"], "este mês", NOW);
    expect(resolved.source).toBe("unresolved_authoritative");
    expect(resolved.periods).toEqual([]);
  });

  it("makes time first-class before the transitional executor", () => {
    const turn = expenseTurn("semana passada do dia 21 ao dia 27");
    const temporal = buildTemporalContractV3(turn, NOW);
    expect(temporal.ok).toBe(true);
    expect(temporal.periods[0]).toMatchObject({
      from: "2026-09-21",
      to: "2026-09-27",
      source: "current_turn",
      canonical_expression: "2026-09-21..2026-09-27",
    });

    const bridge = bridgeTurnSpecV3ToRuntime(turn, NOW);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    expect(bridge.contract.focus.period_expression).toBe("semana passada do dia 21 ao dia 27");
    expect(bridge.contract.focus.period_expressions).toEqual(["2026-09-21..2026-09-27"]);
  });

  it("rejects semantic-period to Financial-IR drift before execution", () => {
    const bridge = bridgeTurnSpecV3ToRuntime(expenseTurn("21-27"), NOW);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;

    const wrong = buildFinancialReadContract({
      turn: bridge.contract,
      requested: financialIr("2026-09-01", "2026-09-28"),
    });
    expect(validateFinancialReadContract(wrong)).toContain("turn_period_vs_financial_ir_mismatch");

    const correct = buildFinancialReadContract({
      turn: bridge.contract,
      requested: financialIr("2026-09-21", "2026-09-27"),
    });
    expect(validateFinancialReadContract(correct)).not.toContain("turn_period_vs_financial_ir_mismatch");
  });

  it("prefers evidence-backed period memory over a stale conversational pointer", () => {
    const trusted = trustedActivePeriod({
      active_period: { from: "2026-09-01", to: "2026-09-28", label: "este mês" },
      last_tool_context: { tool: "analyze_spending", period: { from: "2026-09-21", to: "2026-09-27" } },
      last_analysis: null,
    } as any);
    expect(trusted.source).toBe("last_tool_context");
    expect(trusted.evidence_backed).toBe(true);
    expect(trusted.period).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("never maps pending cancellation to undo of an already committed action", () => {
    const unsafe: TaskTurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "repair",
      canonical_request: "Pensando bem, deixa pra lá. Não registra nada.",
      inherit_topic: true,
      references: [],
      tasks: [{ kind: "financial_write", family: "financial.write", action: "undo.last", slots: {} }],
    };
    const checked = verifySemanticInvariantsV3(unsafe);
    expect(checked.ok).toBe(false);
    expect(checked.violations).toContain("cancel_pending_must_not_be_undo");
    expect(classifyConfirmationAct("Pensando bem, deixa pra lá. Não registra nada.")).toBe("cancel");
  });

  it("allows undo only for explicit reversal of a committed action", () => {
    const turn: TaskTurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      response_intent: "execute",
      act: "new_request",
      canonical_request: "Desfaz o último lançamento que eu registrei.",
      inherit_topic: false,
      references: [],
      tasks: [{ kind: "financial_write", family: "financial.write", action: "undo.last", slots: {} }],
    };
    expect(verifySemanticInvariantsV3(turn).violations).not.toContain("undo_requires_explicit_committed_reversal");
  });

  it("treats structured provider 400 as technical failure rather than user ambiguity", () => {
    expect(isProviderStructuredFailure("structured_call_gateway_400:tool_use_failed")).toBe(true);
    expect(isProviderStructuredFailure("generated json does not match schema")).toBe(true);
  });

  it("recognizes debt engine-envelope facts as evidence and formats the debt list", () => {
    const result = {
      engine: "debt_status",
      facts: {
        debts_analyzed: 1,
        overdue_count: 0,
        overdue_amount: 0,
        due_soon_count: 0,
        due_soon_amount: 0,
        total_outstanding: 1200,
        worst: { name: "Empréstimo Lucas" },
        next_due: null,
        undefined_count: 1,
      },
      breakdown: [{ name: "Empréstimo Lucas", outstanding_balance: 1200, situation: "indefinido" }],
      evidence: { period: { from: "2026-09-28", to: "2026-09-28" } },
      answer_format: { headline: "Dívidas em dia." },
    };
    const claims = buildEvidenceClaims({
      period: { from: "2026-09-28", to: "2026-09-28", label: "hoje" },
      comparison_period: null,
    } as any, {
      outcomes: [{ query_id: "q1", engine: "get_debt_status", status: "ok", result }],
    } as any);
    expect(claims.claims.some((claim) => claim.type === "money" && claim.value === 1200)).toBe(true);
    expect(claims.claims.some((claim) => claim.type === "entity" && claim.label === "Empréstimo Lucas")).toBe(true);

    const text = semanticBlockText("get_debt_status", result);
    expect(text).toContain("Empréstimo Lucas");
    expect(text).toContain("1.200,00");
  });
});