import { describe, expect, it } from "vitest";
import {
  MAX_IR_QUERIES, normalizeToV2, topologicalQueryOrder, validateFinancialIRv2,
  type FinancialQueryIRv2,
} from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { validateFinancialPlan } from "../../supabase/functions/_shared/agent/core/FinancialPlanValidator";
import { deriveSemanticStatus, legacyMayOverride, semanticHasExecutionAuthority } from "../../supabase/functions/_shared/agent/core/SemanticStatus";
import { executeSemanticPlan } from "../../supabase/functions/_shared/agent/core/SemanticQueryExecutor";
import { buildEvidenceClaims } from "../../supabase/functions/_shared/agent/core/EvidenceClaims";
import { checkCompleteness } from "../../supabase/functions/_shared/agent/core/CompletenessGate";
import { groundReply } from "../../supabase/functions/_shared/agent/core/GroundingGateV3";
import {
  MAX_REPLANS, runSemanticInvestigation,
} from "../../supabase/functions/_shared/agent/core/SemanticInvestigationLoop";
import {
  clearPendingClarification, emptyTopicState, MAX_TOPIC_STATE, pendingClarificationOf,
  resolvePendingSlot, resolveTopicForTurn, setPendingClarification,
} from "../../supabase/functions/_shared/agent/core/ConversationTopicState";
import { buildClarification, MAX_CLARIFICATION_OPTIONS } from "../../supabase/functions/_shared/agent/core/ClarificationResponse";
import { classifyDialogueState } from "../../supabase/functions/_shared/agent/core/DialogueAct";
import { fastPathIR, isSemanticReadEligible } from "../../supabase/functions/_shared/agent/core/SemanticRouting";
import { applyAiStageTotals, recordAiStage } from "../../supabase/functions/_shared/agent/core/AiStageMetrics";
import { mappingForQuery } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";

const period = { from: "2026-06-04", to: "2026-09-01", label: "últimos 90 dias" };
const previous = { from: "2026-03-06", to: "2026-06-03", label: "90 dias anteriores" };

function irV2(
  queries: Array<Partial<FinancialQueryIRv2["queries"][number]>>,
  top: Partial<FinancialQueryIRv2> = {},
): FinancialQueryIRv2 {
  return {
    version: "financial_query_ir.v2",
    intent: "analyze",
    dialogue: { acts: ["new_query"], topic_id: null, inherits_from_topic_id: null },
    needs_clarification: [],
    assumptions: [],
    queries: queries.map((q, i) => ({
      id: q.id ?? `q${i + 1}`,
      metric: q.metric ?? "expense_amount",
      operation: q.operation ?? "rank",
      group_by: q.group_by ?? ["category"],
      filters: q.filters ?? [],
      limit: q.limit ?? 5,
      depends_on: q.depends_on ?? [],
    })),
    completeness_targets: top.completeness_targets ?? [
      { id: "t1", query_id: queries[0]?.id ?? "q1", claim: "rank", required: true },
    ],
    period,
    comparison_period: previous,
    source: "semantic_compiler",
    unsupported_reason: null,
    ...top,
  };
}

const spendingResult = {
  metric: "expense",
  view: "rank",
  group_by: "category",
  total_metric: 1500,
  transactions_count: 12,
  period: { from: period.from, to: period.to },
  top: [
    { name: "Alimentação", value: 900 },
    { name: "Transporte", value: 600 },
  ],
};

describe("nino_semantic_ir.v3 — contrato IR v2", () => {
  it("normaliza IR v1 (targets string) para v2 com objetos verificáveis", () => {
    const v1 = {
      version: "financial_query_ir.v1",
      intent: "analyze",
      needs_clarification: [],
      assumptions: [],
      queries: [{ id: "q1", metric: "expense_amount", operation: "rank", group_by: ["category"], filters: [], limit: 5 }],
      completeness_targets: ["q1.result"],
      period, comparison_period: previous, source: "semantic_compiler", unsupported_reason: null,
    } as any;
    const v2 = normalizeToV2(v1, { acts: ["repair", "constraint_update"] });
    expect(v2.version).toBe("financial_query_ir.v2");
    expect(v2.dialogue.acts).toEqual(["repair", "constraint_update"]);
    expect(v2.completeness_targets[0]).toMatchObject({ query_id: "q1", claim: "rank", required: true });
    expect(v2.queries[0].depends_on).toEqual([]);
  });

  it("rejeita ciclo, dependência inexistente, id duplicado e query duplicada", () => {
    const cycle = irV2([
      { id: "q1", depends_on: ["q2"] },
      { id: "q2", operation: "sum", group_by: [], depends_on: ["q1"] },
    ]);
    expect(validateFinancialIRv2(cycle)).toContain("dependency_cycle");

    const missing = irV2([{ id: "q1", depends_on: ["q9"] }]);
    expect(validateFinancialIRv2(missing).some((e) => e.includes("depends_on_missing"))).toBe(true);

    const dupId = irV2([{ id: "q1" }, { id: "q1", operation: "sum", group_by: [] }]);
    expect(validateFinancialIRv2(dupId).some((e) => e.startsWith("duplicate_query_id"))).toBe(true);

    const dupQuery = irV2([{ id: "q1" }, { id: "q2" }]);
    expect(validateFinancialIRv2(dupQuery).some((e) => e.startsWith("duplicate_query"))).toBe(true);
  });

  it("rejeita combinações inválidas: compare sem base, value com group_by, rank sem dimensão", () => {
    const compare = irV2([{ id: "q1", operation: "compare", group_by: [] }], { comparison_period: null });
    expect(validateFinancialIRv2(compare)).toContain("q1_compare_without_comparison_period");
    expect(validateFinancialIRv2(irV2([{ id: "q1", operation: "sum", group_by: ["category"] }])))
      .toContain("q1_value_with_group_by");
    expect(validateFinancialIRv2(irV2([{ id: "q1", operation: "rank", group_by: [] }])))
      .toContain("q1_rank_without_dimension");
  });

  it("respeita o teto de queries e ordena por dependência", () => {
    const many = irV2(Array.from({ length: MAX_IR_QUERIES + 1 }, (_, i) => ({
      id: `q${i + 1}`, limit: i + 1,
    })));
    expect(validateFinancialIRv2(many)).toContain("queries_over_limit");

    const ir = irV2([
      { id: "q1", operation: "sum", group_by: [] },
      { id: "q2", depends_on: ["q1"] },
    ]);
    const waves = topologicalQueryOrder(ir.queries)!;
    expect(waves.map((w) => w.map((q) => q.id))).toEqual([["q1"], ["q2"]]);
  });
});

describe("nino_semantic_ir.v3 — status e precedência", () => {
  it("só compiler_failed devolve autoridade ao legado", () => {
    expect(legacyMayOverride("compiler_failed")).toBe(true);
    for (const status of ["executable", "clarification_required", "unsupported"] as const) {
      expect(legacyMayOverride(status)).toBe(false);
    }
    expect(semanticHasExecutionAuthority("executable")).toBe(true);
    expect(semanticHasExecutionAuthority("clarification_required")).toBe(false);
  });

  it("IR válido e mapeado => executable; clarificação pendente => clarification_required", () => {
    const ir = irV2([{ id: "q1" }]);
    const ok = validateFinancialPlan(ir);
    expect(ok.ok).toBe(true);
    expect(ok.mapped[0].tool).toBe("analyze_spending");
    expect(deriveSemanticStatus({ ir, validation: ok })).toBe("executable");

    const ambiguous = { ...ir, needs_clarification: ["cartão"] };
    const pending = validateFinancialPlan(ambiguous);
    expect(deriveSemanticStatus({ ir: ambiguous, validation: pending })).toBe("clarification_required");
  });

  it("IR sem motor mapeado => unsupported (não cai no legado)", () => {
    const ir = irV2([{
      id: "q1", metric: "goal_progress", operation: "rank", group_by: ["merchant"], filters: [],
    }]);
    const validation = validateFinancialPlan(ir);
    expect(validation.ok).toBe(false);
    expect(deriveSemanticStatus({ ir, validation })).toBe("unsupported");
  });

  it("compilador sem IR => compiler_failed (único caso de legado)", () => {
    expect(deriveSemanticStatus({ ir: null, validation: null })).toBe("compiler_failed");
  });

  it("READ financeiro é elegível mesmo quando o legado classificou como saldo", () => {
    const state = classifyDialogueState("quanto gastei com transporte neste mês?", { kind: "question" } as any);
    expect(isSemanticReadEligible({
      capability_name: "financial_snapshot", acts: state.acts, has_clarification: false,
    })).toBe(true);
    // WRITE e conversa mantêm seus contratos próprios.
    expect(isSemanticReadEligible({
      capability_name: "transaction_entry", acts: ["write"], has_clarification: false,
    })).toBe(false);
  });

  it("TESTE ARQUITETURAL: READ não-fast-path força o Semantic Compiler", () => {
    const state = classifyDialogueState("quais categorias mais gastei nos últimos 90 dias?", { kind: "question" } as any);
    const fast = fastPathIR({
      text: "quais categorias mais gastei nos últimos 90 dias?",
      acts: state.acts, constraints: state.constraints, period, comparison_period: previous,
    });
    // Fast Path recusa (ranking + período) => o compilador semântico é obrigatório.
    expect(fast).toBeNull();
    expect(isSemanticReadEligible({
      capability_name: "financial_snapshot", acts: state.acts, has_clarification: false,
    })).toBe(true);
  });

  it("Fast Path só aceita métrica canônica única sem ambiguidade", () => {
    const plain = classifyDialogueState("qual meu saldo?", { kind: "question" } as any);
    const fast = fastPathIR({
      text: "qual meu saldo?", acts: plain.acts, constraints: plain.constraints, period,
    });
    expect(fast?.queries[0].metric).toBe("balance");

    const repaired = classifyDialogueState("não foi isso, eu queria por cartão nos últimos 90 dias", { kind: "question" } as any);
    expect(fastPathIR({
      text: "qual meu saldo?", acts: repaired.acts, constraints: repaired.constraints, period,
    })).toBeNull();
  });
});

describe("nino_semantic_ir.v3 — dialogue act multi-label", () => {
  it("repair + constraint_update preserva os dois rótulos", () => {
    const state = classifyDialogueState("não foi isso, eu queria por cartão nos últimos 90 dias", { kind: "question" } as any);
    expect(state.acts).toContain("repair");
    expect(state.acts).toContain("constraint_update");
    expect(state.acts).not.toContain("new_query");
    expect(state.constraints.dimension).toBe(true);
    expect(state.constraints.period).toBe(true);
  });

  it("follow-up continua o tópico e não vira pergunta nova", () => {
    const state = classifyDialogueState("e no mês passado?", { kind: "question" } as any);
    expect(state.acts).toContain("followup");
    expect(state.acts).not.toContain("new_query");
  });

  it("WRITE não é confundido com READ semântico", () => {
    const state = classifyDialogueState("gastei 50 no mercado hoje", { kind: "transaction" } as any);
    expect(state.acts).toContain("write");
    expect(isSemanticReadEligible({
      capability_name: "transaction_entry", acts: state.acts, has_clarification: false,
    })).toBe(false);
  });
});

describe("nino_semantic_ir.v3 — execução, evidência e gates", () => {
  it("TESTE ARQUITETURAL: o executor semântico roda o motor; o ActionPlanner não escolhe tool", async () => {
    const ir = irV2([{ id: "q1" }]);
    const validation = validateFinancialPlan(ir);
    const calls: string[] = [];
    const execution = await executeSemanticPlan({
      ir, validation,
      runner: async (tool) => { calls.push(tool); return { ok: true, result: spendingResult, duration_ms: 5 }; },
    });
    // A ferramenta veio do mapeamento determinístico do IR, não de escolha da LLM.
    expect(mappingForQuery(ir.queries[0], ir)?.tool).toBe("analyze_spending");
    expect(calls).toEqual(["analyze_spending"]);
    expect(execution.complete).toBe(true);
    expect(execution.engines).toEqual(["analyze_spending"]);
  });

  it("executa dependências em ondas e isola falha", async () => {
    const ir = irV2([
      { id: "q1", operation: "sum", group_by: [] },
      { id: "q2", depends_on: ["q1"] },
    ]);
    const validation = validateFinancialPlan(ir);
    const order: string[] = [];
    const execution = await executeSemanticPlan({
      ir, validation,
      runner: async (_tool, _args, query_id) => {
        order.push(query_id);
        return query_id === "q2"
          ? { ok: false, error: "engine_down" }
          : { ok: true, result: spendingResult };
      },
    });
    expect(order).toEqual(["q1", "q2"]);
    expect(execution.failed_queries).toEqual(["q2"]);
    expect(execution.complete).toBe(false);
  });

  it("claims cobrem money, rank, entity, count, period e absence", async () => {
    const ir = irV2([{ id: "q1" }]);
    const validation = validateFinancialPlan(ir);
    const execution = await executeSemanticPlan({
      ir, validation, runner: async () => ({ ok: true, result: spendingResult }),
    });
    const claims = buildEvidenceClaims(ir, execution);
    const types = new Set(claims.claims.map((c) => c.type));
    expect(types.has("money")).toBe(true);
    expect(types.has("rank")).toBe(true);
    expect(types.has("entity")).toBe(true);
    expect(types.has("count")).toBe(true);
    expect(types.has("period")).toBe(true);
    expect(claims.allowed_derivations).toContain("percentage_share");

    const empty = await executeSemanticPlan({
      ir, validation,
      runner: async () => ({ ok: true, result: { total_metric: 0, transactions_count: 0, top: [] } }),
    });
    expect(buildEvidenceClaims(ir, empty).claims.some((c) => c.type === "absence")).toBe(true);
  });

  it("CompletenessGate nunca dá A+B como completo tendo só A", async () => {
    const ir = irV2([
      { id: "q1", operation: "sum", group_by: [] },
      { id: "q2" },
    ], {
      completeness_targets: [
        { id: "t1", query_id: "q1", claim: "money", required: true },
        { id: "t2", query_id: "q2", claim: "rank", required: true },
      ],
    });
    const validation = validateFinancialPlan(ir);
    const execution = await executeSemanticPlan({
      ir, validation,
      runner: async (_t, _a, query_id) => query_id === "q1"
        ? { ok: true, result: spendingResult }
        : { ok: false, error: "engine_down" },
    });
    const claims = buildEvidenceClaims(ir, execution);
    const completeness = checkCompleteness({ ir, execution, claims });
    expect(completeness.complete).toBe(false);
    expect(completeness.missing_targets.map((m) => m.id)).toContain("t2");
    expect(completeness.fulfilled_targets).toContain("t1");
    expect(completeness.partial_allowed).toBe(true);
  });

  it("GroundingGate aceita número exato e derivação permitida", async () => {
    const ir = irV2([{ id: "q1" }]);
    const validation = validateFinancialPlan(ir);
    const execution = await executeSemanticPlan({ ir, validation, runner: async () => ({ ok: true, result: spendingResult }) });
    const claims = buildEvidenceClaims(ir, execution);
    const exact = groundReply({
      reply: "Onde mais pesou por categorias: Alimentação R$ 900,00 e Transporte R$ 600,00.",
      claims,
    });
    expect(exact.ok).toBe(true);
    const derived = groundReply({ reply: "A diferença entre as duas foi de R$ 300,00.", claims });
    expect(derived.violations).toEqual([]);
  });

  it("GroundingGate bloqueia ranking trocado mesmo com número certo", async () => {
    const ir = irV2([{ id: "q1" }]);
    const validation = validateFinancialPlan(ir);
    const execution = await executeSemanticPlan({ ir, validation, runner: async () => ({ ok: true, result: spendingResult }) });
    const claims = buildEvidenceClaims(ir, execution);
    const bad = groundReply({ reply: "Sua maior categoria foi Transporte, com R$ 600,00.", claims });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "rank" && v.status === "semantic_mismatch")).toBe(true);
  });

  it("GroundingGate bloqueia número que não está na evidência", async () => {
    const ir = irV2([{ id: "q1" }]);
    const validation = validateFinancialPlan(ir);
    const execution = await executeSemanticPlan({ ir, validation, runner: async () => ({ ok: true, result: spendingResult }) });
    const claims = buildEvidenceClaims(ir, execution);
    const bad = groundReply({ reply: "Você gastou R$ 4.212,77 nesse período.", claims });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "money" && v.status === "unbacked")).toBe(true);
  });
});

describe("nino_semantic_ir.v3 — investigação com teto", () => {
  it("replaneja no máximo 2 vezes e revalida cada IR revisado", async () => {
    const ir = irV2([{ id: "q1" }], {
      intent: "investigate",
      completeness_targets: [{ id: "t1", query_id: "q1", claim: "direction", required: true }],
    });
    let replans = 0;
    const result = await runSemanticInvestigation({
      question: "por que gastei mais este mês?",
      ir,
      validation: validateFinancialPlan(ir),
      runner: async () => ({ ok: true, result: { total_metric: 10, top: [] } }),
      replan: async (request) => {
        replans++;
        expect(request.original_question).toContain("por que");
        expect(request.missing_targets).toContain("t1");
        return irV2([{ id: "q1", limit: 3 + replans }], {
          intent: "investigate",
          completeness_targets: [{ id: "t1", query_id: "q1", claim: "direction", required: true }],
        });
      },
    });
    expect(replans).toBe(MAX_REPLANS);
    expect(result.replan_count).toBe(MAX_REPLANS);
    expect(result.completeness.complete).toBe(false);
  });

  it("replan inválido é descartado, não executado", async () => {
    const ir = irV2([{ id: "q1" }], {
      completeness_targets: [{ id: "t1", query_id: "q1", claim: "direction", required: true }],
    });
    const result = await runSemanticInvestigation({
      question: "por que gastei mais?",
      ir,
      validation: validateFinancialPlan(ir),
      runner: async () => ({ ok: true, result: { total_metric: 10, top: [] } }),
      replan: async () => irV2([{ id: "q1", operation: "rank", group_by: [] }]),
    });
    expect(result.replan_count).toBe(0);
    expect(result.replan_reasons.some((r) => r.startsWith("replan_invalid"))).toBe(true);
  });
});

describe("nino_semantic_ir.v3 — tópicos e clarificação", () => {
  it("repair mantém topic_id e herda período; override explícito vence", () => {
    let state = emptyTopicState();
    const first = resolveTopicForTurn({
      state, text: "quanto gastei com transporte neste mês?", acts: ["new_query"],
      period: { from: period.from, to: period.to }, entities: ["Transporte"],
    });
    state = first.state;
    const repair = resolveTopicForTurn({
      state, text: "não foi isso", acts: ["repair"],
    });
    expect(repair.topic.topic_id).toBe(first.topic.topic_id);
    expect(repair.topic.period).toEqual({ from: period.from, to: period.to });
    expect(repair.topic.entities).toEqual(["Transporte"]);

    const override = resolveTopicForTurn({
      state, text: "não foi isso, eu queria nos últimos 90 dias", acts: ["repair", "constraint_update"],
      period: { from: previous.from, to: previous.to }, explicit_period_override: true,
    });
    expect(override.topic.period).toEqual({ from: previous.from, to: previous.to });
  });

  it("assunto novo cria tópico e não herda período nem entidade incompatível", () => {
    let state = emptyTopicState();
    state = resolveTopicForTurn({
      state, text: "quanto gastei com transporte neste mês?", acts: ["new_query"],
      period: { from: period.from, to: period.to }, entities: ["Transporte"],
    }).state;
    const next = resolveTopicForTurn({ state, text: "como estão minhas metas?", acts: ["new_query"] });
    expect(next.created).toBe(true);
    expect(next.topic.period).toBeNull();
    expect(next.topic.entities).toEqual([]);
  });

  it("small-talk não cria nem limpa tópico e a pilha respeita o teto", () => {
    let state = emptyTopicState();
    for (let i = 0; i < MAX_TOPIC_STATE + 3; i++) {
      state = resolveTopicForTurn({ state, text: `pergunta ${i} sobre gasto categoria ${i}`, acts: ["new_query"] }).state;
    }
    expect(state.topics.length).toBe(MAX_TOPIC_STATE);
    const active = state.active_topic_id;
    const small = resolveTopicForTurn({ state, text: "obrigado", acts: ["conversational"] });
    expect(small.created).toBe(false);
    expect(small.state.active_topic_id).toBe(active);
  });

  it("retomada explícita recupera o tópico anterior", () => {
    let state = emptyTopicState();
    const goals = resolveTopicForTurn({ state, text: "como estão minhas metas de viagem?", acts: ["new_query"] });
    state = goals.state;
    state = resolveTopicForTurn({ state, text: "quanto gastei com transporte?", acts: ["new_query"] }).state;
    const resumed = resolveTopicForTurn({ state, text: "voltando às minhas metas de viagem", acts: ["followup"] });
    expect(resumed.resumed_topic_id).toBe(goals.topic.topic_id);
  });

  it("pending clarification guarda contexto e resolve só o slot", () => {
    let state = emptyTopicState();
    const turn = resolveTopicForTurn({
      state, text: "quanto gastei no cartão?", acts: ["new_query"], period: { from: period.from, to: period.to },
    });
    state = setPendingClarification(turn.state, {
      topic_id: turn.topic.topic_id,
      slot: "card",
      options: ["Nubank", "Itaú"],
      period: { from: period.from, to: period.to },
      query_id: "q1",
      ir: irV2([{ id: "q1" }]),
    });
    const pending = pendingClarificationOf(state)!;
    expect(pending.slot).toBe("card");
    expect(pending.query_id).toBe("q1");
    expect(pending.period).toEqual({ from: period.from, to: period.to });
    expect(resolvePendingSlot(pending, "Nubank")).toMatchObject({ resolved: true, value: "Nubank" });
    // Resposta ainda ambígua => perguntar de novo, sem recompilar outra pergunta.
    expect(resolvePendingSlot({ ...pending, options: ["Nubank Roxinho", "Nubank Ultravioleta"] }, "nubank").resolved)
      .toBe(false);
    state = clearPendingClarification(state, turn.topic.topic_id);
    expect(pendingClarificationOf(state)).toBeNull();
  });

  it("clarificação determinística lista opções canônicas com teto", () => {
    const q = buildClarification({ slot: "cartão", options: ["A", "B", "C", "D", "E", "F"] });
    expect(q.slot).toBe("card");
    expect(q.options.length).toBe(MAX_CLARIFICATION_OPTIONS);
    expect(q.reply).toMatch(/cart/i);
  });
});

describe("nino_semantic_ir.v3 — telemetria por estágio", () => {
  it("agregados de IA são soma dos estágios (compiler + resposta)", () => {
    const metrics = { llm_calls: 0, tokens_in: 0, tokens_out: 0 } as any;
    recordAiStage(metrics, {
      stage: "semantic_compiler", model: "google/gemini-3.6-flash",
      llm_calls: 1, tokens_in: 1000, tokens_out: 50, latency_ms: 700, ok: true,
    });
    recordAiStage(metrics, {
      stage: "response_generator", model: "google/gemini-3.6-flash",
      llm_calls: 1, tokens_in: 2000, tokens_out: 100, latency_ms: 1200, ok: true,
    });
    expect(metrics.llm_calls).toBe(2);
    expect(metrics.tokens_in).toBe(3000);
    expect(metrics.tokens_out).toBe(150);
    expect(applyAiStageTotals(metrics).ai_stages.length).toBe(2);
  });

  it("fast path puro não consome LLM", () => {
    const metrics = { llm_calls: 0, tokens_in: 0, tokens_out: 0 } as any;
    applyAiStageTotals(metrics);
    expect(metrics.llm_calls).toBe(0);
    expect(metrics.tokens_in).toBe(0);
  });
});
