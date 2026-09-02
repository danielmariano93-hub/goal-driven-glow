// Golden tests do pipeline semântico (`nino_semantic_ir.v3`).
// Cada teste protege uma regra que já quebrou em produção.
import { describe, expect, it, vi } from "vitest";
import {
  applyResolvedSlot, isSlotAnswerAttempt, runSemanticTurn,
} from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline.ts";
import { isFalseDenial, rescueCapabilityDenial } from "../../supabase/functions/_shared/agent/core/CapabilityRescue.ts";
import { normalizeToV2 } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR.ts";

const PERIOD = { from: "2026-09-01", to: "2026-09-30", label: "setembro" };
const FAILURE = "Não consigo garantir esse número agora.";

function ir(overrides: Record<string, unknown> = {}) {
  return {
    version: "financial_query_ir.v1",
    intent: "analyze",
    needs_clarification: [],
    assumptions: [],
    queries: [{
      id: "q1", metric: "expense_amount", operation: "rank",
      group_by: ["category"], filters: [], limit: 5,
    }],
    completeness_targets: ["q1.rank"],
    period: PERIOD,
    comparison_period: null,
    source: "semantic_compiler",
    unsupported_reason: null,
    ...overrides,
  } as any;
}

function deps(overrides: Partial<Parameters<typeof runSemanticTurn>[1]> = {}) {
  return {
    compile: vi.fn(async () => ({ ir: ir(), telemetry: null })),
    runEngine: vi.fn(async () => ({
      ok: true,
      result: { rows: [{ label: "Transporte", value: 983.62 }], total: 983.62 },
      duration_ms: 5,
    })),
    loadOptions: vi.fn(async () => ["Nubank", "Itaú"]),
    recordStage: vi.fn(),
    ...overrides,
  } as Parameters<typeof runSemanticTurn>[1];
}

const base = {
  text: "quais categorias mais gastei neste mês?",
  acts: ["new_query"] as any,
  constraints: { period: false, dimension: true, entity: false },
  period: PERIOD,
  comparison_period: null,
  topic_state: null,
  failure_reply: FAILURE,
};

describe("pipeline semântico — execução e autoridade", () => {
  it("executa nos motores canônicos e não devolve o turno ao planner", async () => {
    const d = deps();
    const out = await runSemanticTurn(base, d);
    expect(out.status).toBe("executable");
    expect(d.runEngine).toHaveBeenCalled();
    expect(out.telemetry.action_planner_used_for_tool_choice).toBe(false);
    expect(out.engines.length).toBeGreaterThan(0);
  });

  it("abre tópico e persiste no estado devolvido", async () => {
    const out = await runSemanticTurn(base, deps());
    expect(out.topic_state.topics.length).toBe(1);
    expect(out.topic_state.active_topic_id).toBe(out.topic_id);
  });

  it("IR sem motor mapeado oferece degradação canônica com falha honesta específica", async () => {
    const out = await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({
        ir: ir({ intent: "unsupported", queries: [], completeness_targets: [] }),
        telemetry: null,
      })),
    } as any));
    expect(out.status).toBe("unsupported");
    // O pipeline não escolhe o texto: entrega ao Core a opção de motor canônico
    // e um texto honesto com o motivo verdadeiro (nunca "janela de comparação").
    expect(out.turn).toBeNull();
    expect(out.canonical_fallback?.allowed).toBe(true);
    expect(out.canonical_fallback?.honest_reply).toMatch(/n[aã]o/i);
  });


  it("compilador sem IR devolve autoridade ao roteador legado", async () => {
    const out = await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({ ir: null, telemetry: null })),
    } as any));
    expect(out.status).toBe("compiler_failed");
    expect(out.turn).toBeNull();
    expect(out.telemetry.executed_by).toBe("legacy_router");
  });
});

describe("clarificação com opções reais e retomada", () => {
  it("pergunta com as opções do banco e guarda o IR original", async () => {
    const out = await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({ ir: ir({ needs_clarification: ["card"] }), telemetry: null })),
    } as any));
    expect(out.status).toBe("clarification_required");
    expect(out.turn?.reply).toContain("Nubank");
    const pending = out.topic_state.topics[0].pending_clarification;
    expect(pending?.slot).toBe("card");
    expect(pending?.ir).toBeTruthy();
  });

  it("resposta ao slot retoma o IR guardado sem recompilar a pergunta", async () => {
    const first = await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({ ir: ir({ needs_clarification: ["card"] }), telemetry: null })),
    } as any));
    const compile = vi.fn(async () => ({ ir: ir(), telemetry: null }));
    const second = await runSemanticTurn(
      { ...base, text: "Nubank", acts: ["clarification"] as any, topic_state: first.topic_state },
      deps({ compile } as any),
    );
    expect(compile).not.toHaveBeenCalled();
    expect(second.status).toBe("executable");
    expect(second.telemetry.resumed_from_pending).toBe(true);
    const filters = second.ir_v2!.queries[0].filters;
    expect(filters.some((f) => f.field === "card" && f.value === "Nubank")).toBe(true);
  });

  it("resposta ambígua ao slot pergunta de novo em vez de chutar", async () => {
    const first = await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({ ir: ir({ needs_clarification: ["card"] }), telemetry: null })),
      loadOptions: vi.fn(async () => ["Nubank Roxo", "Nubank Preto"]),
    } as any));
    const second = await runSemanticTurn(
      { ...base, text: "Nubank", acts: ["clarification"] as any, topic_state: first.topic_state },
      deps(),
    );
    expect(second.status).toBe("clarification_required");
    expect(second.turn?.reply).toContain("Nubank");
  });

  it("applyResolvedSlot substitui o filtro do slot sem duplicar", () => {
    const applied = applyResolvedSlot(normalizeToV2(ir()), "card", "Itaú", "q1");
    expect(applied!.queries[0].filters.filter((f) => f.field === "card")).toHaveLength(1);
    expect(applied!.needs_clarification).toHaveLength(0);
  });

  it("frase longa não é tratada como resposta de slot", () => {
    expect(isSlotAnswerAttempt("Nubank")).toBe(true);
    expect(isSlotAnswerAttempt("na verdade quero ver tudo do mês passado inteiro por categoria")).toBe(false);
  });
});

describe("gates e investigação", () => {
  it("gate bloqueado não responde e devolve resgate de ferramenta canônica", async () => {
    const out = await runSemanticTurn(base, deps({
      runEngine: vi.fn(async () => ({ ok: false, error: "engine_down", duration_ms: 1 })),
    } as any));
    expect(out.turn).toBeNull();
    expect(out.rescue?.tool).toBeTruthy();
    expect(out.errors).toContain("semantic_gate_blocked");
  });

  it("investigação replaneja no máximo 2 vezes", async () => {
    const compile = vi.fn(async () => ({
      ir: ir({
        intent: "investigate",
        comparison_period: { from: "2026-08-01", to: "2026-08-31", label: "agosto" },
        queries: [{
          id: "q1", metric: "expense_amount", operation: "explain", group_by: [], filters: [], limit: null,
        }],
      }),
      telemetry: null,
    }));

    const out = await runSemanticTurn(
      { ...base, text: "por que gastei mais que no mês passado?", investigation_enabled: true },
      deps({ compile, runEngine: vi.fn(async () => ({ ok: false, error: "sem dados", duration_ms: 1 })) } as any),
    );
    const investigation = out.telemetry.investigation as any;
    expect(investigation.ran).toBe(true);
    expect(investigation.replan_count).toBeLessThanOrEqual(2);
  });

  it("telemetria registra o estágio do compilador", async () => {
    const recordStage = vi.fn();
    await runSemanticTurn(base, deps({
      compile: vi.fn(async () => ({
        ir: ir(),
        telemetry: { model: "m", llm_calls: 1, tokens_in: 10, tokens_out: 5, latency_ms: 30, ok: true, error: null, source: "llm" },
      })),
      recordStage,
    } as any));
    expect(recordStage).toHaveBeenCalledWith(expect.objectContaining({ tokens_in: 10 }), "semantic_compiler");
  });
});

describe("capability rescue", () => {
  it("detecta negação falsa", () => {
    expect(isFalseDenial("Não tenho acesso aos seus gastos.")).toBe(true);
    expect(isFalseDenial("Seus gastos com transporte somaram R$ 983,62.")).toBe(false);
  });

  it("substitui a negação pelo texto determinístico quando há motor registrado", () => {
    const out = rescueCapabilityDenial({
      reply: "Infelizmente não consigo consultar isso agora.",
      engines: ["analyze_spending"],
      deterministic_text: "Transporte: R$ 983,62 em setembro.",
    });
    expect(out.rescued).toBe(true);
    expect(out.text).toContain("983,62");
  });

  it("sem evidência determinística preserva a resposta original", () => {
    const out = rescueCapabilityDenial({
      reply: "Não tenho acesso a isso.",
      engines: ["analyze_spending"],
      deterministic_text: null,
    });
    expect(out.rescued).toBe(false);
    expect(out.reason).toBe("no_deterministic_text");
  });
});
