import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeTurnSpecV3ToRuntime,
  bridgeTurnSpecV3ToRuntimePlan,
} from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { SemanticTaskV3, TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { validateTurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { normalizeSemanticInterpreterV3Output } from "../../supabase/functions/_shared/agent/v3/SemanticInterpreterV3";
import {
  compareSemanticSignaturesV3,
  semanticSignatureV3,
} from "../../supabase/functions/_shared/agent/v3/SemanticComparatorV3";
import {
  executeAdvisorReasoning,
  lastCompleteMonthsWindow,
  parseHypotheticalAmount,
  type AdvisorDeps,
} from "../../supabase/functions/_shared/agent/v3/AdvisorReasoningV3";
import {
  allowedNumbersFrom,
  composeConversationalReply,
  guardComposedReply,
  sanitizeRelationshipNotes,
  type ComposeInput,
} from "../../supabase/functions/_shared/agent/v3/ConversationalComposerV3";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";

const NOW = new Date("2026-09-29T10:00:00-03:00");
const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

function task(tasks: SemanticTaskV3[], canonical = "pedido composto"): TurnSpecV3 {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    response_intent: "execute",
    act: "new_request",
    canonical_request: canonical,
    inherit_topic: false,
    references: [],
    tasks: tasks as [SemanticTaskV3, ...SemanticTaskV3[]],
  };
}

const lazerQuery: SemanticTaskV3 = {
  kind: "financial_query",
  family: "financial.query",
  metric: "expense_amount",
  operation: "sum",
  group_by: [],
  filters: [{ field: "category", entity: sourced("Lazer") }],
  periods: [sourced("esse mês")],
  limit: null,
  comparison: null,
};

const nextBestAction: SemanticTaskV3 = {
  kind: "advisory",
  family: "advisory",
  operation: "next_best_action",
  periods: [],
  scenario: null,
  options: [],
};

const cutDelivery: SemanticTaskV3 = {
  kind: "advisory",
  family: "advisory",
  operation: "scenario",
  periods: [],
  scenario: { lever: "cut_category", category: "Delivery", amount: null, percent: 50, goal: null },
  options: [],
};

describe("compound turns (V3 plan bridge)", () => {
  it("splits fact + advice into two executable steps, facts first", () => {
    const plan = bridgeTurnSpecV3ToRuntimePlan(task([nextBestAction, lazerQuery]), NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.contracts.map((c) => c.domain)).toEqual(["financial_read", "advisory"]);
    expect(plan.contracts[1].advisory_kind).toBe("next_best_action");
    expect(plan.contracts[0].focus.category).toBe("Lazer");
  });

  it("puts the confirmation-gated write first and keeps the read", () => {
    const write: SemanticTaskV3 = {
      kind: "financial_write",
      family: "financial.write",
      action: "transaction.create",
      slots: { amount: "50", merchant: "mercado" },
    };
    const plan = bridgeTurnSpecV3ToRuntimePlan(task([lazerQuery, write]), NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.contracts.map((c) => c.mode)).toEqual(["write", "read"]);
  });

  it("makes goal projection executable as its own advisory step", () => {
    const projection: SemanticTaskV3 = {
      kind: "goal_query", family: "goals", operation: "projection", goal: sourced("Viagem"),
    };
    const single = bridgeTurnSpecV3ToRuntime(task([projection]), NOW);
    expect(single.ok).toBe(false);
    const plan = bridgeTurnSpecV3ToRuntimePlan(task([projection]), NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.contracts[0].advisory_kind).toBe("goal_projection");
    expect(plan.contracts[0].advisory_params).toEqual({ goal: "Viagem" });
  });

  it("keeps single-family turns identical to the legacy bridge", () => {
    const legacy = bridgeTurnSpecV3ToRuntime(task([lazerQuery]), NOW);
    const plan = bridgeTurnSpecV3ToRuntimePlan(task([lazerQuery]), NOW);
    expect(plan.ok && legacy.ok).toBe(true);
    if (!plan.ok || !legacy.ok) return;
    expect(plan.contracts).toHaveLength(1);
    expect(plan.contracts[0]).toEqual(legacy.contract);
  });

  it("degrades new advisory operations to legacy engines outside the rollout", () => {
    const legacy = bridgeTurnSpecV3ToRuntime(task([cutDelivery]), NOW);
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.contract.advisory_kind).toBe("financial_plan");
    expect(legacy.contract.advisory_params ?? null).toBeNull();

    const extended = bridgeTurnSpecV3ToRuntime(task([cutDelivery]), NOW, { extended: true });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(extended.contract.advisory_kind).toBe("scenario");
    expect(extended.contract.advisory_params?.scenario).toMatchObject({ lever: "cut_category", category: "Delivery", percent: 50 });
  });
});

describe("scenario semantics in TurnSpec V3", () => {
  it("requires a magnitude and a category for a category cut", () => {
    const bad = task([{ ...cutDelivery, scenario: { lever: "cut_category", category: null, amount: null, percent: null, goal: null } } as SemanticTaskV3]);
    const errors = validateTurnSpecV3(bad).errors;
    expect(errors).toContain("task_0_scenario_magnitude_required");
    expect(errors).toContain("task_0_scenario_category_required");
  });

  it("normalizes the strict interpreter output for a what-if question", () => {
    const turn = normalizeSemanticInterpreterV3Output({
      version: "nino_turn_spec.v3",
      kind: "task",
      act: "new_request",
      canonical_request: "E se eu cortar metade do delivery?",
      inherit_topic: false,
      references: [],
      direct_reply: null,
      clarification_question: null,
      tasks: [{
        kind: "advisory", financial: null, goal: null, write: null,
        advisory: {
          operation: "scenario", periods: [], options: [],
          scenario: { lever: "cut_category", category: "Delivery", amount: null, percent: 50, goal: null },
        },
      }],
    });
    expect(turn?.kind).toBe("task");
    if (turn?.kind !== "task") return;
    expect(turn.tasks[0]).toMatchObject({ kind: "advisory", operation: "scenario", scenario: { percent: 50 } });
  });

  it("treats diverging hypothetical magnitudes as a semantic disagreement", () => {
    const a = semanticSignatureV3(task([cutDelivery]));
    const b = semanticSignatureV3(task([{ ...cutDelivery, scenario: { ...(cutDelivery as any).scenario, percent: 30 } } as SemanticTaskV3]));
    expect(compareSemanticSignaturesV3(a, b).semantic_match).toBe(false);
    const c = semanticSignatureV3(task([{ ...cutDelivery, options: ["qualquer texto"] } as SemanticTaskV3]));
    expect(compareSemanticSignaturesV3(a, c).semantic_match).toBe(true);
  });
});

describe("advisor reasoning", () => {
  it("parses hypothetical money the way people say it", () => {
    expect(parseHypotheticalAmount("R$ 3.000")).toBe(3000);
    expect(parseHypotheticalAmount("500")).toBe(500);
    expect(parseHypotheticalAmount("1,5 mil")).toBe(1500);
    expect(parseHypotheticalAmount("2 mil reais")).toBe(2000);
    expect(parseHypotheticalAmount("-300")).toBe(-300);
    expect(parseHypotheticalAmount("metade")).toBeNull();
  });

  it("uses the last complete months as the baseline window", () => {
    expect(lastCompleteMonthsWindow("2026-09-29", 3)).toEqual({ from: "2026-06-01", to: "2026-08-31", n: 3 });
  });

  function deps(overrides: Partial<AdvisorDeps> = {}): AdvisorDeps {
    return {
      today: "2026-09-29",
      loadCategoryBaseline: async (category, window) => ({
        category, typical_monthly: 600, months_with_data: 3, window,
      }),
      runTool: async (tool, args) => {
        if (tool === "project_goal_completion") {
          return { ok: true, result: { goal_id: "g1", name: "Viagem", current: 2000, target: 8000, remaining: 6000, observed_pace_month: 500, required_pace_month: 750, projected_date: "2027-09-15", days_ahead_or_late: 90 } };
        }
        if (tool === "simulate_goal_pace") {
          expect(args.monthly_contribution).toBe(800);
          return { ok: true, result: { projected_date: "2027-04-10", months: 7.5 } };
        }
        if (tool === "get_financial_snapshot") {
          return { ok: true, result: { available_today: 4200, projected_month_end_available: 1800, cards_owed: 950, net_worth_composition: { invested: 12000 }, active_debts: [{ name: "Empréstimo", outstanding_balance: 5000, installment_amount: 400 }] } };
        }
        return { ok: false, result: null, error: "unexpected_tool" };
      },
      ...overrides,
    };
  }

  function advisoryContract(kind: "scenario" | "decision" | "goal_projection", params: Record<string, unknown> | null) {
    return normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: "new_request", mode: "read", domain: "advisory",
      canonical_request: "simulação",
      inherit_focus: false,
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null, direct_reply: null, clarification_question: null,
      resolution: { intent: "resolved", reference: "not_applicable", time: "not_applicable", entity: "not_applicable", action: "not_applicable" },
      reference: null, financial_read: null,
      advisory_kind: kind,
      advisory_params: params,
    })!;
  }

  it("computes a category cut and its effect on the active goal", async () => {
    const contract = advisoryContract("scenario", { scenario: { lever: "cut_category", category: "Delivery", amount: null, percent: 50, goal: null } });
    const out = await executeAdvisorReasoning(contract, deps());
    expect(out?.ok).toBe(true);
    expect(out?.facts).toMatchObject({ monthly_saving: 300, annual_saving: 3600, new_typical_monthly: 300 });
    const reply = String(out?.reply ?? "").replace(/\u00a0/g, " ");
    expect(reply).toContain("R$ 300,00");
    expect(reply).toContain("setembro de 2027");
    expect(reply).toContain("abril de 2027");
    expect(out?.tool_calls.map((c) => c.tool_name)).toEqual(["typical_monthly_expense", "project_goal_completion", "simulate_goal_pace"]);
  });

  it("asks instead of guessing when the category does not exist", async () => {
    const contract = advisoryContract("scenario", { scenario: { lever: "cut_category", category: "Iate", amount: null, percent: 50, goal: null } });
    const out = await executeAdvisorReasoning(contract, deps({
      loadCategoryBaseline: async (category) => ({ category, error: "category_not_found" }),
    }));
    expect(out?.ok).toBe(false);
    expect(out?.reply).toMatch(/\?$/);
  });

  it("gathers owned evidence for a decision without inventing rates", async () => {
    const contract = advisoryContract("decision", { options: ["quitar o empréstimo", "investir"] });
    const out = await executeAdvisorReasoning(contract, deps());
    expect(out?.ok).toBe(true);
    expect(out?.facts).toMatchObject({ total_debt: 5000, available_today: 4200 });
    expect(out?.reply).not.toMatch(/%/);
  });

  it("projects a goal from the observed pace", async () => {
    const contract = advisoryContract("goal_projection", { goal: "Viagem" });
    const out = await executeAdvisorReasoning(contract, deps());
    expect(out?.ok).toBe(true);
    const reply = String(out?.reply ?? "").replace(/\u00a0/g, " ");
    expect(reply).toContain("faltam R$ 6.000,00");
    expect(reply).toContain("setembro de 2027");
    expect(reply).toContain("R$ 750,00");
  });
});

function composeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    kind: "answer",
    channel: "whatsapp",
    user_text: "quanto gastei com lazer esse mês?",
    history: [],
    relationship_context: null,
    deterministic_body: "Em setembro, você gastou R$ 1.234,56 com Lazer.",
    evidence: [{ total: 1234.56, previous_total: 980 }],
    allow_offer: true,
    capture_memory: true,
    today: "2026-09-29",
    ...overrides,
  };
}

describe("conversational composer guard", () => {
  it("accepts a human rewrite that keeps the evidence", () => {
    const out = guardComposedReply({
      text: "Esse mês o Lazer somou *R$ 1.234,56* — mais do que os R$ 980,00 do mês anterior. Quer que eu abra onde foi?",
      input: composeInput(),
    });
    expect(out).toEqual({ ok: true, violations: [] });
  });

  it("accepts compact rounding (R$ 1,2 mil)", () => {
    expect(guardComposedReply({ text: "Deu uns R$ 1.234,56, ou seja, R$ 1,2 mil em Lazer.", input: composeInput() }).ok).toBe(true);
  });

  it("rejects an invented amount", () => {
    const out = guardComposedReply({ text: "Você gastou R$ 1.234,56, e dá pra economizar R$ 400,00.", input: composeInput() });
    expect(out.ok).toBe(false);
    expect(out.violations.join(",")).toContain("number_not_in_evidence");
  });

  it("rejects a rewrite that drops the answer", () => {
    const out = guardComposedReply({ text: "Seu lazer está sob controle esse mês.", input: composeInput() });
    expect(out.violations).toContain("headline_number_missing");
  });

  it("rejects internal/provider leaks and false action claims", () => {
    expect(guardComposedReply({ text: "Segundo o motor, R$ 1.234,56.", input: composeInput() }).ok).toBe(false);
    expect(guardComposedReply({ text: "Registrei R$ 1.234,56 pra você.", input: composeInput() }).ok).toBe(false);
  });

  it("does not let conversation turns invent money but allows what the user said", () => {
    const input = composeInput({ kind: "conversation", user_text: "tô preocupado, recebi só 3 mil esse mês", deterministic_body: "Entendo a preocupação." });
    expect(guardComposedReply({ text: "Entendo. Com 3 mil fica apertado mesmo — vamos olhar juntos?", input }).ok).toBe(true);
    expect(guardComposedReply({ text: "Entendo. Você ainda tem R$ 2.500,00 livres.", input }).ok).toBe(false);
  });

  it("collects numbers from nested evidence", () => {
    const allowed = allowedNumbersFrom([], [{ a: { b: [{ c: 42.5 }] } }]);
    expect(allowed).toContain(42.5);
  });

  it("keeps relationship notes durable, non-financial and non-sensitive", () => {
    const notes = sanitizeRelationshipNotes([
      { key: "Viagem Dezembro", note: "Planeja viajar para o Nordeste em dezembro", kind: "plan", horizon: "2026-12" },
      { key: "salario", note: "Recebe 5000 reais por mês", kind: "work", horizon: null },
      { key: "saude", note: "Está em tratamento de saúde", kind: "concern", horizon: null },
    ]);
    expect(notes).toEqual([
      { key: "viagem_dezembro", note: "Planeja viajar para o Nordeste em dezembro", kind: "plan", horizon: "2026-12" },
    ]);
  });
});

describe("conversational composer runtime", () => {
  afterEach(() => vi.unstubAllGlobals());

  const provider = {
    provider: "groq" as const,
    baseUrl: "https://api.groq.test/openai/v1",
    apiKey: "test",
    modelOverride: null,
  } as any;

  function stubReply(reply: string, remember: unknown[] = []) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply, remember }), tool_calls: [{ type: "function", function: { name: "emit_nino_reply", arguments: JSON.stringify({ reply, remember }) } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
  }

  it("returns the composed voice and captured notes when the guard passes", async () => {
    stubReply("Esse mês o Lazer ficou em R$ 1.234,56. Quer que eu compare com agosto?", [
      { key: "viagem", note: "Planeja uma viagem em dezembro", kind: "plan", horizon: "2026-12" },
    ]);
    const out = await composeConversationalReply(composeInput({ provider_override: provider }));
    expect(out.mode).toBe("composed");
    expect(out.text).toContain("R$ 1.234,56");
    expect(out.notes).toHaveLength(1);
    expect(out.telemetry.llm_calls).toBe(1);
  });

  it("falls back to the deterministic body when the model invents a number", async () => {
    stubReply("Você gastou R$ 1.234,56 e vai sobrar R$ 700,00.");
    const out = await composeConversationalReply(composeInput({ provider_override: provider }));
    expect(out.mode).toBe("deterministic");
    expect(out.text).toBe("Em setembro, você gastou R$ 1.234,56 com Lazer.");
    expect(out.reason).toContain("guard:");
  });

  it("falls back when the provider is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{\"error\":\"rate\"}", { status: 429 })));
    const out = await composeConversationalReply(composeInput({ provider_override: provider }));
    expect(out.mode).toBe("deterministic");
    expect(out.telemetry.ok).toBe(false);
  });
});
