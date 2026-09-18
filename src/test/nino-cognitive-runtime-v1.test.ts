import { describe, expect, it, vi } from "vitest";
import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate";
import {
  advanceReferences,
  captureReferenceObjects,
  invalidateReferences,
  resolveStructuredReference,
} from "../../supabase/functions/_shared/agent/core/ConversationReferenceStore";
import { groundTurnContract } from "../../supabase/functions/_shared/agent/core/GroundingEngine";
import {
  buildFinancialReadContract,
  validateFinancialReadContract,
} from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import { computeCompare } from "../../supabase/functions/_shared/analytics/compare";
import { emptyMemory } from "../../supabase/functions/_shared/agent/core/ConversationMemory";
import { writeDurableMemory } from "../../supabase/functions/_shared/agent/core/MemoryWriter";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import type { FinancialQueryIRv3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";

function financialTurn(over: Partial<CanonicalConversationTurnContract> = {}): CanonicalConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: "Compare meus gastos por categoria entre julho e agosto.",
    inherit_focus: false,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: "julho",
      period_expressions: ["julho", "agosto"],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "resolved",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [{
        metric: "expense_amount",
        operation: "compare",
        group_by: ["category"],
        filters: [],
        limit: 5,
      }],
    },
    advisory_kind: null,
    ...over,
  };
}

function requestedIR(): FinancialQueryIRv3 {
  return {
    version: "financial_query_ir.v3",
    intent: "analyze",
    dialogue: { acts: ["new_query"], topic_id: null, inherits_from_topic_id: null },
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1",
      metric: "expense_amount",
      filters: [],
      time: {
        aspect: "calendar",
        from: "2026-08-01",
        to: "2026-08-31",
        n: null,
        exclude_partial: false,
        label: "agosto",
      },
      grain: "none",
      reduce: "sum",
      group_by: ["category"],
      limit: 5,
      depends_on: [],
      legacy_operation: "compare",
    }],
    completeness_targets: [{
      id: "q1.direction",
      query_id: "q1",
      claim: "direction",
      required: true,
    }],
    period: { from: "2026-08-01", to: "2026-08-31", label: "agosto" },
    comparison_period: { from: "2026-07-01", to: "2026-07-31", label: "julho" },
    source: "semantic_compiler",
    unsupported_reason: null,
  };
}

describe("Nino Cognitive Runtime v1 — autoridade única e contratos hierárquicos", () => {
  it("normaliza v1 para Turn Contract v2 e descarta confiança numérica", () => {
    const out = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v1",
      act: "new_request",
      mode: "read",
      canonical_request: "Quanto gastei em julho?",
      inherit_focus: false,
      focus: {
        category: null, merchant: null, goal: null,
        period_expression: "julho", period_expressions: ["julho"],
      },
      action: null,
      direct_reply: null,
      clarification_question: null,
      confidence: 0.99,
    });
    expect(out?.version).toBe("conversation_turn_contract.v2");
    expect(out?.domain).toBe("financial_read");
    expect(out?.resolution.intent).toBe("resolved");
    expect(out).not.toHaveProperty("confidence");
  });

  it("falha fechado quando uma referência necessária não foi resolvida", () => {
    const out = normalizeConversationTurnContract({
      ...financialTurn(),
      act: "follow_up",
      inherit_focus: true,
      reference: {
        kind: "previous_result_set",
        target: "category",
        expression: "delas",
        status: "missing",
      },
      resolution: {
        intent: "resolved",
        reference: "missing",
        time: "resolved",
        entity: "not_applicable",
        action: "not_applicable",
      },
    });
    expect(out).toBeNull();
  });

  it("advisory exige subtipo emitido pela mesma autoridade", () => {
    expect(normalizeConversationTurnContract({
      ...financialTurn(),
      domain: "advisory",
      financial_read: null,
      advisory_kind: null,
    })).toBeNull();

    expect(normalizeConversationTurnContract({
      ...financialTurn(),
      domain: "advisory",
      financial_read: null,
      advisory_kind: "next_best_action",
    })?.advisory_kind).toBe("next_best_action");
  });

  it("fast path é estreito e produz o mesmo Turn Contract canônico", () => {
    const saldo = resolveNarrowDeterministicTurn("Qual meu saldo?");
    expect(saldo).toMatchObject({
      version: "conversation_turn_contract.v2",
      domain: "financial_read",
      mode: "read",
      resolution: { intent: "resolved" },
    });
    expect(resolveNarrowDeterministicTurn("E qual delas piorou?")).toBeNull();
    expect(resolveNarrowDeterministicTurn("Quanto gastei com alimentação?")).toBeNull();
  });

  it("falha de compilação na lane autoritativa não devolve autoridade ao legado", async () => {
    const runEngine = vi.fn(async () => ({ ok: false, result: null, error: "should_not_run", duration_ms: 0 }));
    const out = await runSemanticTurn({
      text: "Quanto gastei em julho?",
      acts: ["new_query"],
      constraints: { period: true, dimension: false, entity: false },
      period: { from: "2026-07-01", to: "2026-07-31", label: "julho" },
      comparison_period: null,
      periods: null,
      comparison_intent: false,
      previous_query: null,
      topic_state: null,
      max_queries: 1,
      investigation_enabled: false,
      preservation_enforced: true,
      typical_monthly_enabled: false,
      authoritative_contract: true,
      failure_reply: "FALHA_CANONICA",
      now: new Date("2026-09-17T12:00:00Z"),
    }, {
      compile: async () => ({ ir: null, telemetry: null }),
      runEngine,
      loadOptions: async () => [],
      recordStage: () => undefined,
    });

    expect(out.turn?.reply).toBe("FALHA_CANONICA");
    expect(out.telemetry.executed_by).toBe("contract_failed_closed");
    expect(out.telemetry.action_planner_used_for_tool_choice).toBe(false);
    expect(runEngine).not.toHaveBeenCalled();
  });
});

describe("Reference Store + Grounding — 'delas' é um objeto, não palavra-chave", () => {
  const now = new Date("2026-09-17T23:00:00Z");

  it("une as categorias exibidas por múltiplas execuções do mesmo turno", () => {
    const refs = captureReferenceObjects([
      {
        tool_name: "analyze_spending",
        args: { group_by: "category", query_id: "q1__july" },
        ok: true,
        result: { group_by: "category", top: [
          { name: "Moradia", value: 8655.37 },
          { name: "Dívidas e empréstimos", value: 3042.73 },
          { name: "Lazer", value: 2447.17 },
          { name: "Assinaturas", value: 2167.44 },
          { name: "Transporte", value: 1490.46 },
        ] },
      },
      {
        tool_name: "analyze_spending",
        args: { group_by: "category", query_id: "q1__august" },
        ok: true,
        result: { group_by: "category", top: [
          { name: "Moradia", value: 3845.71 },
          { name: "Transporte", value: 1345.23 },
          { name: "Lazer", value: 1193.73 },
          { name: "Alimentação", value: 1295.98 },
          { name: "Assinaturas", value: 1076.97 },
        ] },
      },
    ], now);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ target: "category", type: "entity_set", status: "active" });
    expect(refs[0].entity_labels).toEqual([
      "Moradia", "Dívidas e empréstimos", "Lazer", "Assinaturas", "Transporte", "Alimentação",
    ]);
  });

  it("grounda 'delas' no conjunto estruturado anterior e expira sem adivinhar", () => {
    const refs = captureReferenceObjects([{
      tool_name: "analyze_spending",
      args: { group_by: "category" },
      ok: true,
      result: { group_by: "category", top: [
        { name: "Moradia", value: 100 },
        { name: "Alimentação", value: 90 },
      ] },
    }], now);

    const request = {
      kind: "previous_result_set" as const,
      target: "category" as const,
      expression: "delas",
      status: "resolved" as const,
    };

    expect(resolveStructuredReference(request, refs, now)).toMatchObject({
      status: "resolved",
      target: "category",
      entity_labels: ["Moradia", "Alimentação"],
    });

    let aged = refs;
    for (let i = 0; i < 5; i++) aged = advanceReferences(aged, new Date(now.getTime() + i * 1000));
    expect(resolveStructuredReference(request, aged, now)).toMatchObject({
      status: "missing",
      reason: "reference_expired_or_missing",
    });
  });

  it("repair invalida referência anterior", () => {
    const refs = captureReferenceObjects([{
      tool_name: "analyze_spending",
      args: { group_by: "category" },
      ok: true,
      result: { group_by: "category", top: [
        { name: "Moradia", value: 100 },
        { name: "Lazer", value: 80 },
      ] },
    }], now);
    expect(invalidateReferences(refs)[0].status).toBe("invalidated");
  });

  it("Grounding Engine pede esclarecimento quando o referencial venceu", () => {
    const turn = financialTurn({
      act: "follow_up",
      inherit_focus: true,
      reference: {
        kind: "previous_result_set",
        target: "category",
        expression: "delas",
        status: "resolved",
      },
      resolution: {
        intent: "resolved",
        reference: "resolved",
        time: "resolved",
        entity: "not_applicable",
        action: "not_applicable",
      },
    });
    const memory = { ...emptyMemory(), references: [] };
    const out = groundTurnContract(turn, memory, now);
    expect(out.ok).toBe(false);
    expect(out.clarification).toContain("delas");
  });
});

describe("Financial Read Contract v4 + Contract Fulfillment Gate", () => {
  const grounded = {
    status: "resolved" as const,
    reference_id: "ref-1",
    target: "category" as const,
    entity_labels: ["Moradia", "Alimentação"],
    reason: "reference_store",
  };

  const turn = financialTurn({
    act: "follow_up",
    inherit_focus: true,
    reference: {
      kind: "previous_result_set",
      target: "category",
      expression: "delas",
      status: "resolved",
    },
    resolution: {
      intent: "resolved",
      reference: "resolved",
      time: "resolved",
      entity: "not_applicable",
      action: "not_applicable",
    },
  });

  it("traduz Turn Contract para Financial IR sem uma segunda interpretação de linguagem", () => {
    const compiled = compileFinancialReadFromTurn({
      turn,
      period: { from: "2026-08-01", to: "2026-08-31", label: "agosto" },
      comparison_period: { from: "2026-07-01", to: "2026-07-31", label: "julho" },
    });
    expect(compiled?.telemetry).toMatchObject({ llm_calls: 0, model: "deterministic:turn_contract" });
    expect(compiled?.ir?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "compare",
      group_by: ["category"],
      filters: [],
      limit: 5,
    });
  });

  it("Turn Contract produz um Financial Read Contract subordinado", () => {
    const contract = buildFinancialReadContract({ turn, requested: requestedIR(), grounded_reference: grounded });
    expect(contract).toMatchObject({
      version: "financial_read_contract.v4",
      source_turn_version: "conversation_turn_contract.v2",
      grounded_reference: { target: "category", entity_labels: ["Moradia", "Alimentação"] },
    });
    expect(validateFinancialReadContract(contract)).toEqual([]);
  });

  it("detecta se o IR financeiro contradiz a semântica emitida pelo Brain", () => {
    const wrong = requestedIR();
    wrong.queries[0] = { ...wrong.queries[0], legacy_operation: "rank" };
    const contract = buildFinancialReadContract({ turn, requested: wrong, grounded_reference: grounded });
    expect(validateFinancialReadContract(contract)).toContain("turn_semantics_vs_financial_ir_mismatch");
  });

  it("bloqueia execução que alargou ou perdeu o conjunto referido", () => {
    const contract = buildFinancialReadContract({ turn, requested: requestedIR(), grounded_reference: grounded });
    const missing = verifyFinancialFulfillment({
      contract,
      preservation: null,
      grounding: null,
      applied_reference_scope: null,
    });
    expect(missing.ok).toBe(false);
    expect(missing.violations.map((v) => v.code)).toContain("reference_scope_not_executed");

    const changed = verifyFinancialFulfillment({
      contract,
      preservation: null,
      grounding: null,
      applied_reference_scope: { target: "category", entity_labels: ["Educação", "Saúde"] },
    });
    expect(changed.ok).toBe(false);
    expect(changed.violations.map((v) => v.code)).toContain("reference_scope_changed");

    const exact = verifyFinancialFulfillment({
      contract,
      preservation: null,
      grounding: null,
      applied_reference_scope: { target: "category", entity_labels: ["Alimentação", "Moradia"] },
    });
    expect(exact.ok).toBe(true);
  });

  it("Contract Fulfillment Gate também bloqueia violação factual de grounding", () => {
    const contract = buildFinancialReadContract({ turn, requested: requestedIR(), grounded_reference: grounded });
    const out = verifyFinancialFulfillment({
      contract,
      preservation: null,
      grounding: {
        ok: false,
        violations: [{ type: "unsupported_numeric_claim", reason: "claim_without_evidence" }],
      } as any,
      applied_reference_scope: { target: "category", entity_labels: ["Moradia", "Alimentação"] },
    });

    expect(out.ok).toBe(false);
    expect(out.violations.map((v) => v.code)).toContain("evidence_grounding_violation");
  });

  it("compare engine calcula somente o conjunto grounded", () => {
    const result = computeCompare({
      txs: [
        { id: "1", status: "confirmed", type: "expense", amount: 100, occurred_at: "2026-07-10", category_id: "mor", movement_kind: "transaction" },
        { id: "2", status: "confirmed", type: "expense", amount: 150, occurred_at: "2026-08-10", category_id: "mor", movement_kind: "transaction" },
        { id: "3", status: "confirmed", type: "expense", amount: 50, occurred_at: "2026-07-11", category_id: "ali", movement_kind: "transaction" },
        { id: "4", status: "confirmed", type: "expense", amount: 90, occurred_at: "2026-08-11", category_id: "ali", movement_kind: "transaction" },
        { id: "5", status: "confirmed", type: "expense", amount: 0, occurred_at: "2026-07-12", category_id: "edu", movement_kind: "transaction" },
        { id: "6", status: "confirmed", type: "expense", amount: 800, occurred_at: "2026-08-12", category_id: "edu", movement_kind: "transaction" },
      ] as any,
      categoryNames: new Map([
        ["mor", "Moradia"], ["ali", "Alimentação"], ["edu", "Educação"],
      ]),
      metric: "expense",
      period_a: { from: "2026-07-01", to: "2026-07-31" },
      period_b: { from: "2026-08-01", to: "2026-08-31" },
      group_by: "category",
      category_scope: ["Moradia", "Alimentação"],
    });

    expect(result.by_group.map((row) => row.name).sort()).toEqual(["Alimentação", "Moradia"]);
    expect(result.by_group.find((row) => row.name === "Moradia")?.delta_abs).toBe(50);
    expect(result.by_group.find((row) => row.name === "Alimentação")?.delta_abs).toBe(40);
    expect(result.applied_reference_scope?.entity_labels).toEqual(["Moradia", "Alimentação"]);
    expect(result.total_b).toBe(240);
  });
});

describe("Memory Writer — memória relacional, nunca verdade financeira viva", () => {
  it("remove valores financeiros antes de persistir", async () => {
    let upsertPayload: any = null;
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn((payload: any) => {
        upsertPayload = payload;
        return chain;
      }),
    };
    const sb: any = { from: vi.fn(() => chain) };

    const result = await writeDurableMemory(sb, {
      user_id: "u1",
      kind: "context",
      key: "preference:review",
      value: {
        preference: "comparar meses fechados",
        balance: 9000,
        nested: { invoice_total: 500, note: "manter contexto" },
        text: "minha fatura R$ 500,00, mas prefiro comparar meses fechados",
      },
      source: "user",
    });

    expect(result.dropped_financial_fields).toEqual(expect.arrayContaining([
      "balance", "nested.invoice_total",
    ]));
    expect(upsertPayload.value.balance).toBeUndefined();
    expect(upsertPayload.value.nested.invoice_total).toBeUndefined();
    expect(upsertPayload.value.nested.note).toBe("manter contexto");
    expect(upsertPayload.value.text).not.toContain("500,00");
  });
});
