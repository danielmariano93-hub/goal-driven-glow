// `nino_adaptive.v1` + `nino_threads.v1`
//
// Fixtures A–J: tier por complexidade, seleção de contexto, precedência de
// citação, ambiguidade, retomada de longo prazo, escalada e cache seguro.
import { describe, it, expect } from "vitest";
import {
  classifyTurn,
} from "../../supabase/functions/_shared/agent/core/TurnComplexityClassifier.ts";
import {
  planExecution, selectTier, escalate, canEarlyExit, TIER_LATENCY_TARGETS,
} from "../../supabase/functions/_shared/agent/core/AdaptiveExecutionRouter.ts";
import { selectContext, isCacheable } from "../../supabase/functions/_shared/agent/core/ContextSelector.ts";
import { createExecutionTrace, latencyBreakdown } from "../../supabase/functions/_shared/agent/core/ExecutionTrace.ts";
import { resolveConversation } from "../../supabase/functions/_shared/agent/core/ConversationResolver.ts";
import { topicScore, keywordsOf, type TopicThread } from "../../supabase/functions/_shared/agent/core/TopicRepository.ts";
import { deterministicTierColumns } from "../../supabase/functions/_shared/agent/core/AdaptiveTurn.ts";

const topic = (over: Partial<TopicThread>): TopicThread => ({
  id: over.id ?? "t1",
  user_id: "u1",
  conversation_id: "c1",
  subject: over.subject ?? "gastos",
  title: over.title ?? null,
  summary: null,
  status: over.status ?? "answered",
  keywords: over.keywords ?? [],
  entities: over.entities ?? [],
  acts: [],
  period_from: null,
  period_to: null,
  original_query: over.original_query ?? null,
  last_query: over.last_query ?? null,
  evidence_reference: null,
  execution_summary: null,
  turn_count: 1,
  opened_at: new Date().toISOString(),
  last_activity_at: over.last_activity_at ?? new Date().toISOString(),
});

describe("A. tier por transição de estado e evento estruturado", () => {
  it("confirmação de pendência é T0 sem modelo", () => {
    const s = classifyTurn({ text: "salvar", has_pending_confirmation: true, confirmation_act: "confirm" });
    const plan = planExecution({ signals: s, state_transition: true });
    expect(plan.tier).toBe(0);
    expect(plan.max_llm_calls).toBe(0);
    expect(plan.use_semantic_ir).toBe(false);
    expect(s.risk_score).toBeGreaterThan(0.5);
  });

  it("comprovante bancário reconhecido é T1 sem modelo", () => {
    const s = classifyTurn({ text: "Você pagou R$ 92,00 no Atacadão hoje", structured_bank_event: true });
    const plan = planExecution({ signals: s, structured_event: true });
    expect(plan.tier).toBe(1);
    expect(plan.max_llm_calls).toBe(0);
  });
});

describe("B. leitura factual simples fica no T2", () => {
  it("pergunta com domínio e período não escala para raciocínio", () => {
    const s = classifyTurn({ text: "quanto gastei em transporte esse mes?" });
    const plan = planExecution({ signals: s });
    expect(plan.tier).toBe(2);
    expect(plan.max_llm_calls).toBe(1);
    expect(plan.max_prompt_chars).toBeLessThanOrEqual(10_000);
  });
});

describe("C. comparação e multi-domínio escalam", () => {
  it("comparação de categorias vira T3 ou T4", () => {
    const s = classifyTurn({ text: "comparando meus gastos de transporte e alimentação com o mês passado" });
    const { tier } = selectTier({ signals: s });
    expect(tier).toBeGreaterThanOrEqual(3);
  });

  it("pergunta composta multi-domínio vira T4", () => {
    const s = classifyTurn({
      text: "por que minhas dívidas cresceram, minha meta parou e o cartão aumentou? isso virou padrão?",
    });
    const plan = planExecution({ signals: s });
    expect(plan.tier).toBe(4);
    expect(plan.use_semantic_ir).toBe(true);
    expect(plan.allow_parallel_tools).toBe(true);
  });
});

describe("D. seleção de contexto antes de carregar", () => {
  it("T0 não carrega nenhuma camada e T4 carrega o caminho completo", () => {
    const t0 = selectContext({ tier: 0 });
    expect(t0.loaded).toEqual([]);
    expect(t0.history_turns).toBe(0);
    const t4 = selectContext({ tier: 4 });
    expect(t4.loaded).toContain("diagnosis");
    expect(t4.history_turns).toBe(12);
  });

  it("T2 não carrega diagnóstico nem assessor", () => {
    const t2 = selectContext({ tier: 2 });
    expect(t2.skipped).toContain("diagnosis");
    expect(t2.skipped).toContain("advisor_context");
  });

  it("verdade financeira nunca é cacheável; configuração é", () => {
    expect(isCacheable("feature_flags")).toBe(true);
    expect(isCacheable("saldo")).toBe(false);
    expect(isCacheable("fatura")).toBe(false);
  });
});

describe("E. escalada progressiva e early exit", () => {
  it("escala um tier por gate e registra o motivo", () => {
    const s = classifyTurn({ text: "quanto gastei em transporte esse mes?" });
    const plan = planExecution({ signals: s });
    const up = escalate(plan, "completeness", s);
    expect(up.tier).toBe(3);
    expect(up.escalations.at(-1)).toMatchObject({ from: 2, to: 3, gate: "completeness" });
  });

  it("nunca passa do T4", () => {
    const s = classifyTurn({ text: "compara tudo e explica por que virou padrão nas dívidas e no cartão" });
    const plan = planExecution({ signals: s });
    const up = escalate(plan, "response_grounding", s);
    expect(up.tier).toBe(4);
  });

  it("early exit só quando tudo está determinado", () => {
    expect(canEarlyExit(classifyTurn({ text: "quanto gastei em mercado esse mes?" }))).toBe(true);
    expect(canEarlyExit(classifyTurn({ text: "e aquilo?" }))).toBe(false);
  });

  it("metas de latência são separadas por tier e crescentes", () => {
    const tiers = [0, 1, 2, 3, 4] as const;
    for (let i = 1; i < tiers.length; i++) {
      expect(TIER_LATENCY_TARGETS[tiers[i]].p95).toBeGreaterThan(TIER_LATENCY_TARGETS[tiers[i - 1]].p95);
    }
  });
});

describe("F. precedência da mensagem citada", () => {
  it("citação vence tópico ativo e similaridade", () => {
    const quoted = topic({ id: "tq", subject: "metas", title: "Meta da viagem" });
    const out = resolveConversation({
      text: "isso mesmo",
      quoted_message_id: "wamid.1",
      quoted_topic: quoted,
      active_topic_id: "t-outro",
      topics: [quoted, topic({ id: "t-outro", subject: "cartao", keywords: ["cartao", "fatura"] })],
    });
    expect(out.source).toBe("quoted_message");
    expect(out.topic_id).toBe("tq");
    expect(out.clarification_required).toBe(false);
  });

  it("expectativa pendente tem precedência sobre similaridade", () => {
    const out = resolveConversation({
      text: "pode salvar",
      has_pending_confirmation: true,
      active_topic_id: "t1",
      topics: [topic({ id: "t1" })],
    });
    expect(out.source).toBe("pending_expectation");
  });
});

describe("G. ambiguidade pede clarificação em vez de chutar", () => {
  it("dois tópicos plausíveis empatados exigem clarificação", () => {
    const a = topic({ id: "ta", subject: "metas", title: "Meta da viagem", keywords: ["viagem", "meta", "reserva"] });
    const b = topic({ id: "tb", subject: "metas", title: "Meta do carro", keywords: ["viagem", "meta", "reserva"] });
    const out = resolveConversation({
      text: "voltando pra aquela meta de viagem e reserva",
      topics: [a, b],
    });
    expect(out.clarification_required).toBe(true);
    expect(out.clarification_options).toHaveLength(2);
    expect(out.topic_id).toBeNull();
  });

  it("mudança explícita de assunto não herda contexto", () => {
    const out = resolveConversation({
      text: "muda de assunto: quanto tenho de saldo?",
      active_topic_id: "t1",
      topics: [topic({ id: "t1", keywords: ["cartao"] })],
    });
    expect(out.source).toBe("new_topic");
    expect(out.is_new_topic).toBe(true);
  });
});

describe("H. retomada de longo alcance", () => {
  it("tópico antigo relevante é recuperado por palavras-chave", () => {
    const old = topic({
      id: "told",
      subject: "metas",
      title: "Meta reserva emergência",
      keywords: keywordsOf("meta reserva emergencia aporte mensal"),
      last_activity_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    const score = topicScore("como está minha meta de reserva de emergência?", old);
    expect(score).toBeGreaterThan(0.3);
    const out = resolveConversation({ text: "como está minha meta de reserva de emergência?", topics: [old] });
    expect(out.topic_id).toBe("told");
    expect(["semantic_match", "recent_history"]).toContain(out.source);
  });

  it("pergunta sem relação nenhuma abre assunto novo", () => {
    const old = topic({ id: "told", keywords: keywordsOf("cartao fatura itau") });
    const out = resolveConversation({ text: "quanto rendeu meu investimento?", topics: [old] });
    expect(out.is_new_topic).toBe(true);
  });

  it("memória de tópico guarda semântica e referência, nunca valor financeiro", () => {
    const t = topic({ id: "t1", keywords: keywordsOf("gastos transporte agosto") });
    expect(JSON.stringify(t)).not.toMatch(/R\$/);
    expect(t.evidence_reference).toBeNull();
  });
});

describe("I. trace e marcos de latência", () => {
  it("separa backend de percebido e registra caminho crítico", () => {
    const trace = createExecutionTrace();
    const base = Date.now();
    trace.mark("inbound_received_at", new Date(base));
    trace.mark("agent_started_at", new Date(base + 100));
    trace.tool("financial_position", true);
    trace.parallelGroup(["financial_position", "list_debts"]);
    trace.mark("agent_completed_at", new Date(base + 1_100));
    trace.mark("provider_sent_at", new Date(base + 1_200));
    trace.mark("provider_ack_at", new Date(base + 2_000));
    trace.criticalPath(1_000);
    const lat = latencyBreakdown(trace.data.marks);
    expect(lat.backend_latency_ms).toBe(1_000);
    expect(lat.provider_latency_ms).toBe(800);
    expect(lat.perceived_latency_ms).toBe(2_000);
    const cols = trace.toRunColumns();
    expect(cols.critical_path_ms).toBe(1_000);
    expect(cols.parallel_groups).toEqual([["financial_position", "list_debts"]]);
  });

  it("atalho determinístico reporta tier e saída antecipada", () => {
    const cols = deterministicTierColumns({ tier: 0, reason: "state_transition", started_at: Date.now() - 250 });
    expect(cols.execution_tier).toBe(0);
    expect(cols.early_exit_stage).toBe("state_transition");
    expect(Number(cols.backend_latency_ms)).toBeGreaterThanOrEqual(0);
  });
});

describe("J. sinais não inventam dificuldade", () => {
  it("follow-up curto é dependente de contexto, não complexo", () => {
    const s = classifyTurn({ text: "e no cartão?", open_topic_count: 1 });
    expect(s.context_dependency_score).toBeGreaterThanOrEqual(0.2);
    expect(s.complexity_score).toBeLessThan(0.6);
  });

  it("saudação não vira análise financeira", () => {
    const s = classifyTurn({ text: "bom dia" });
    expect(s.financial_reasoning_score).toBe(0);
    expect(s.risk_score).toBe(0);
  });

  it("lançamento em linguagem natural marca risco de escrita", () => {
    const s = classifyTurn({ text: "gastei 30 no mercado agora" });
    expect(s.risk_score).toBeGreaterThanOrEqual(0.7);
  });
});
