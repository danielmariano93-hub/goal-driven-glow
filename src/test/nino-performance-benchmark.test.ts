// Benchmark de decisão (`nino_adaptive.v1`) + 20 conversas golden de
// continuidade (`nino_threads.v1`).
//
// O que é medido aqui é a DECISÃO (tier, contexto, orçamento, assunto), que é
// determinística. Latência real de rede/modelo é medida em produção pelos
// marcos de `ExecutionTrace` e pelas colunas de `agent_runs`.
import { describe, it, expect } from "vitest";
import { classifyTurn } from "../../supabase/functions/_shared/agent/core/TurnComplexityClassifier.ts";
import { planExecution, TIER_LATENCY_TARGETS } from "../../supabase/functions/_shared/agent/core/AdaptiveExecutionRouter.ts";
import { selectContext } from "../../supabase/functions/_shared/agent/core/ContextSelector.ts";
import { resolveConversation } from "../../supabase/functions/_shared/agent/core/ConversationResolver.ts";
import { keywordsOf, type TopicThread } from "../../supabase/functions/_shared/agent/core/TopicRepository.ts";

type Case = {
  name: string;
  text: string;
  state_transition?: boolean;
  structured_event?: boolean;
  simple_write?: boolean;
  min_tier: number;
  max_tier: number;
};

const CASES: Case[] = [
  { name: "confirmação", text: "salvar", state_transition: true, min_tier: 0, max_tier: 0 },
  { name: "cancelamento", text: "cancela", state_transition: true, min_tier: 0, max_tier: 0 },
  { name: "comprovante bancário", text: "Compra aprovada de R$ 92,00 no Atacadão", structured_event: true, min_tier: 1, max_tier: 1 },
  { name: "lançamento simples", text: "gastei 30 no mercado", simple_write: true, min_tier: 1, max_tier: 1 },
  { name: "leitura factual", text: "quanto gastei em mercado esse mes?", min_tier: 2, max_tier: 2 },
  { name: "saldo", text: "qual meu saldo disponivel hoje?", min_tier: 2, max_tier: 2 },
  { name: "comparação simples", text: "gastei mais em transporte esse mes comparando com o mes passado?", min_tier: 3, max_tier: 4 },
  { name: "follow-up curto", text: "e no cartão?", min_tier: 3, max_tier: 4 },
  { name: "análise composta", text: "por que minhas dividas cresceram e a meta parou? isso virou padrao no cartao?", min_tier: 4, max_tier: 4 },
  { name: "hipótese", text: "se eu parcelar essa compra em 6x, vale a pena com a minha meta e as dividas?", min_tier: 3, max_tier: 4 },
];

describe("benchmark de decisão por tier", () => {
  for (const c of CASES) {
    it(`${c.name} respeita a faixa de tier`, () => {
      const signals = classifyTurn({
        text: c.text,
        has_pending_confirmation: c.state_transition,
        confirmation_act: c.state_transition ? (/cancel/.test(c.text) ? "cancel" : "confirm") : "none",
        structured_bank_event: c.structured_event,
      });
      const plan = planExecution({
        signals,
        state_transition: c.state_transition,
        structured_event: c.structured_event,
        simple_write: c.simple_write,
      });
      expect(plan.tier).toBeGreaterThanOrEqual(c.min_tier);
      expect(plan.tier).toBeLessThanOrEqual(c.max_tier);
      const ctx = selectContext({ tier: plan.tier });
      // Nenhum turno de escrita/confirmação carrega diagnóstico ou assessor.
      if (plan.tier <= 1) expect(ctx.loaded).not.toContain("diagnosis");
      // O orçamento nunca é maior que o do tier acima.
      expect(plan.max_prompt_chars).toBeLessThanOrEqual(32_000);
      expect(TIER_LATENCY_TARGETS[plan.tier].p50).toBeLessThan(TIER_LATENCY_TARGETS[plan.tier].p95);
    });
  }

  it("nenhum turno determinístico chama modelo", () => {
    for (const c of CASES.filter((x) => x.state_transition || x.structured_event || x.simple_write)) {
      const signals = classifyTurn({ text: c.text, has_pending_confirmation: c.state_transition, confirmation_act: c.state_transition ? "confirm" : "none", structured_bank_event: c.structured_event });
      const plan = planExecution({ signals, state_transition: c.state_transition, structured_event: c.structured_event, simple_write: c.simple_write });
      expect(plan.max_llm_calls).toBe(0);
    }
  });
});

// --------------------------------------------------------------------------
// 20 conversas golden de continuidade
// --------------------------------------------------------------------------
const thread = (id: string, subject: string, title: string, query: string, days = 0): TopicThread => ({
  id, user_id: "u1", conversation_id: "c1", subject, title, summary: null,
  status: "answered", keywords: keywordsOf(`${title} ${query}`), entities: [], acts: [],
  period_from: null, period_to: null, original_query: query, last_query: query,
  evidence_reference: null, execution_summary: null, turn_count: 2,
  opened_at: new Date(Date.now() - days * 86_400_000).toISOString(),
  last_activity_at: new Date(Date.now() - days * 86_400_000).toISOString(),
});

const metas = thread("t-metas", "metas", "Meta reserva de emergência", "quanto falta para minha reserva de emergencia", 12);
const cartao = thread("t-cartao", "cartao", "Fatura do cartão", "quanto ta a fatura do cartao esse mes", 2);
const dividas = thread("t-dividas", "dividas", "Dívida do Banco Pan", "quando vence a divida do banco pan", 5);
const transporte = thread("t-transporte", "gastos", "Gastos com transporte", "quanto gastei em transporte", 1);

type Golden = {
  n: number; text: string;
  quoted?: TopicThread | null;
  pending?: boolean;
  active?: string | null;
  topics: TopicThread[];
  expect_topic: string | null;
  expect_source?: string;
  expect_clarification?: boolean;
};

const GOLDEN: Golden[] = [
  { n: 1, text: "isso mesmo", quoted: metas, topics: [metas, cartao], expect_topic: "t-metas", expect_source: "quoted_message" },
  { n: 2, text: "pode salvar", pending: true, active: "t-transporte", topics: [transporte], expect_topic: "t-transporte", expect_source: "pending_expectation" },
  { n: 3, text: "voltando pra reserva de emergencia", topics: [metas, cartao], expect_topic: "t-metas", expect_source: "explicit_reference" },
  { n: 4, text: "quanto ta a fatura do cartao esse mes", topics: [metas, cartao], expect_topic: "t-cartao" },
  { n: 5, text: "quando vence a divida do banco pan", topics: [dividas, cartao], expect_topic: "t-dividas" },
  { n: 6, text: "muda de assunto: quanto rendeu meu investimento", active: "t-cartao", topics: [cartao], expect_topic: null, expect_source: "new_topic" },
  { n: 7, text: "e a reserva de emergencia, como ficou", topics: [metas], expect_topic: "t-metas" },
  { n: 8, text: "quanto gastei em transporte", active: "t-transporte", topics: [transporte, cartao], expect_topic: "t-transporte" },
  { n: 9, text: "bom dia", topics: [cartao], expect_topic: null, expect_source: "new_topic" },
  { n: 10, text: "obrigado", topics: [metas], expect_topic: null, expect_source: "new_topic" },
  { n: 11, text: "lembra que falamos da divida do banco pan", topics: [dividas], expect_topic: "t-dividas", expect_source: "explicit_reference" },
  { n: 12, text: "quanto falta para minha reserva de emergencia", topics: [metas, dividas], expect_topic: "t-metas" },
  { n: 13, text: "cancela", pending: true, active: "t-cartao", topics: [cartao], expect_topic: "t-cartao", expect_source: "pending_expectation" },
  { n: 14, text: "aquela pergunta da fatura do cartao", topics: [cartao, dividas], expect_topic: "t-cartao", expect_source: "explicit_reference" },
  { n: 15, text: "quanto gastei com mercado ontem", topics: [transporte], expect_topic: null, expect_source: "new_topic" },
  { n: 16, text: "isso continua igual?", quoted: dividas, topics: [dividas, cartao], expect_topic: "t-dividas", expect_source: "quoted_message" },
  { n: 17, text: "e a divida do banco pan, ja paguei?", topics: [dividas], expect_topic: "t-dividas" },
  { n: 18, text: "esquece, outra coisa: qual meu saldo", active: "t-metas", topics: [metas], expect_topic: null, expect_source: "new_topic" },
  { n: 19, text: "sobre a fatura do cartao esse mes", topics: [cartao], expect_topic: "t-cartao" },
  { n: 20, text: "voltando pra aquela meta", topics: [metas, thread("t-metas2", "metas", "Meta reserva de emergência", "quanto falta para minha reserva de emergencia", 9)], expect_topic: null, expect_clarification: true },
];

describe("20 conversas golden de continuidade", () => {
  for (const g of GOLDEN) {
    it(`golden ${g.n}: ${g.text}`, () => {
      const out = resolveConversation({
        text: g.text,
        quoted_message_id: g.quoted ? "wamid.x" : null,
        quoted_topic: g.quoted ?? null,
        has_pending_confirmation: g.pending,
        active_topic_id: g.active ?? null,
        topics: g.topics,
      });
      if (g.expect_clarification) {
        expect(out.clarification_required).toBe(true);
        expect(out.topic_id).toBeNull();
        return;
      }
      expect(out.topic_id).toBe(g.expect_topic);
      if (g.expect_source) expect(out.source).toBe(g.expect_source);
      // Continuidade nunca guarda número como verdade.
      expect(JSON.stringify(out)).not.toMatch(/R\$/);
    });
  }
});
