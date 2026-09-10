// AdaptiveTurn (`nino_adaptive.v1` + `nino_threads.v1`)
//
// Costura fina entre o núcleo e as duas frentes novas: inteligência proporcional
// (classificador -> roteador -> trace) e continuidade de assunto (tópicos
// duráveis -> resolver -> vínculo de mensagens).
//
// Fail-closed por construção: com as flags desligadas, `prepare()` devolve
// `null` e o turno segue exatamente o caminho canônico atual. Nada aqui calcula
// verdade financeira nem formata resposta.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyTurn, type ClassifierInput, type TurnSignals } from "./TurnComplexityClassifier.ts";
import {
  canEarlyExit, escalate, planExecution, tierTargets,
  type EscalationGate, type ExecutionPlan,
} from "./AdaptiveExecutionRouter.ts";
import { selectContext, type ContextSelection } from "./ContextSelector.ts";
import { createExecutionTrace, latencyBreakdown, type ExecutionTrace } from "./ExecutionTrace.ts";
import { createTopicRepository, keywordsOf, type TopicRepository, type TopicThread } from "./TopicRepository.ts";
import { resolveConversation, type ResolverOutput } from "./ConversationResolver.ts";
import { topicForQuotedMessage, linkTurnMessages } from "./MessageTopicLinker.ts";
import { isEnabled } from "./FeatureFlags.ts";

export type AdaptiveTurn = {
  signals: TurnSignals;
  plan: ExecutionPlan;
  context: ContextSelection;
  trace: ExecutionTrace;
  topic: ResolverOutput | null;
  repo: TopicRepository | null;
  targets: { p50: number; p95: number };
  early_exit_allowed: boolean;
  escalate(gate: EscalationGate): void;
  /** Fecha o turno: telemetria + tópico durável + vínculo de mensagens. */
  finalize(args: {
    inbound_message_id?: string | null;
    outbound_message_id?: string | null;
    engines?: string[];
    complete?: boolean;
    run_id?: string | null;
    tool_call_ids?: string[];
    subject_hint?: string | null;
  }): Promise<Record<string, unknown>>;
};

export async function prepareAdaptiveTurn(args: {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
  text: string;
  quoted_message_id?: string | null;
  has_pending_confirmation?: boolean;
  awaiting_answer?: boolean;
  active_topic_id?: string | null;
  session_topic_count?: number;
}): Promise<AdaptiveTurn | null> {
  const [adaptive, threads] = await Promise.all([
    isEnabled("adaptive_execution_v1", args.user_id),
    isEnabled("conversation_threads_v1", args.user_id),
  ]);
  if (!adaptive && !threads) return null;

  const repo = threads
    ? createTopicRepository({ sb: args.sb, user_id: args.user_id, conversation_id: args.conversation_id })
    : null;

  // Carregamento paralelo: tópicos duráveis e mensagem citada não dependem um
  // do outro. Nenhuma leitura de verdade financeira acontece aqui.
  const [topics, quotedTopic] = await Promise.all([
    repo ? repo.listRecent(12) : Promise.resolve([] as TopicThread[]),
    repo ? topicForQuotedMessage(repo, args.quoted_message_id ?? null) : Promise.resolve(null),
  ]);

  const classifierInput: ClassifierInput = {
    text: args.text,
    has_pending_confirmation: args.has_pending_confirmation,
    quoted_message_id: args.quoted_message_id ?? null,
    open_topic_count: topics.length || (args.session_topic_count ?? 0),
    awaiting_answer: args.awaiting_answer,
  };
  const signals = classifyTurn(classifierInput);

  const topic = repo
    ? resolveConversation({
        text: args.text,
        quoted_message_id: args.quoted_message_id ?? null,
        quoted_topic: quotedTopic,
        has_pending_confirmation: args.has_pending_confirmation,
        awaiting_answer: args.awaiting_answer,
        active_topic_id: args.active_topic_id ?? null,
        topics,
      })
    : null;

  let plan = planExecution({ signals });
  const trace = createExecutionTrace();
  trace.mark("agent_started_at");
  trace.signals(signals);
  trace.plan(plan);
  if (topic) {
    trace.topic({
      source: topic.source, topic_id: topic.topic_id, score: topic.score,
      candidates: topic.candidates,
      quoted_used: topic.source === "quoted_message",
    });
  }

  const context = selectContext({
    tier: plan.tier,
    needs_topics: Boolean(topic && topic.topic_id),
  });
  trace.context(context.loaded, context.skipped);

  const startedAt = Date.now();

  return {
    signals,
    get plan() { return plan; },
    context,
    trace,
    topic,
    repo,
    targets: tierTargets(plan.tier),
    early_exit_allowed: canEarlyExit(signals),
    escalate(gate) {
      plan = escalate(plan, gate, signals);
      trace.plan(plan);
    },
    async finalize(a) {
      trace.mark("agent_completed_at");
      trace.criticalPath(Date.now() - startedAt);

      let topic_id = topic?.topic_id ?? null;
      if (repo && !topic?.clarification_required) {
        const subject = a.subject_hint || topic?.topic?.subject || "geral";
        if (!topic_id) {
          const created = await repo.open({
            subject,
            title: args.text.slice(0, 80),
            last_query: args.text,
            keywords: keywordsOf(args.text),
          });
          topic_id = created?.id ?? null;
        } else {
          await repo.touch(topic_id, {
            last_query: args.text,
            status: a.complete === false ? "open" : "answered",
            keywords: keywordsOf(args.text),
            execution_summary: { engines: a.engines ?? [], complete: a.complete !== false },
            evidence_reference: { run_id: a.run_id ?? null, tool_call_ids: a.tool_call_ids ?? [] },
          } as any);
        }
        if (topic_id) {
          trace.topic({
            source: topic?.source ?? "new_topic", topic_id,
            score: topic?.score ?? null,
            quoted_used: topic?.source === "quoted_message",
          });
          await linkTurnMessages({
            repo, topic_id,
            inbound_message_id: a.inbound_message_id ?? null,
            outbound_message_id: a.outbound_message_id ?? null,
          });
        }
      }

      const cols = trace.toRunColumns();
      const lat = latencyBreakdown(trace.data.marks);
      return {
        ...cols,
        backend_latency_ms: lat.backend_latency_ms,
        provider_latency_ms: lat.provider_latency_ms,
        perceived_latency_ms: lat.perceived_latency_ms,
      };
    },
  } as AdaptiveTurn;
}

/** Telemetria mínima dos atalhos determinísticos (T0/T1), sem custo extra. */
export function deterministicTierColumns(args: {
  tier: 0 | 1;
  reason: string;
  started_at: number;
}): Record<string, unknown> {
  const trace = createExecutionTrace();
  trace.mark("agent_started_at", new Date(args.started_at));
  trace.plan({
    tier: args.tier, route: args.tier === 0 ? "confirmation" : "structured_entry",
    model_tier: "none", selection_reason: args.reason,
    max_llm_calls: 0, max_prompt_chars: 0, timeout_budget_ms: args.tier === 0 ? 3_000 : 6_000,
    use_semantic_ir: false, allow_parallel_tools: false, escalations: [],
  });
  trace.context([], []);
  trace.earlyExit(args.reason);
  trace.mark("agent_completed_at");
  trace.criticalPath(Date.now() - args.started_at);
  const cols = trace.toRunColumns();
  const lat = latencyBreakdown(trace.data.marks);
  return { ...cols, backend_latency_ms: lat.backend_latency_ms };
}
