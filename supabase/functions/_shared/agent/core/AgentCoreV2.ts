// AgentCoreV2 (`nino_conversation_brain.v1`)
//
// Pilot entrypoint da Conversation Architecture V2:
//   mensagem -> Conversation Brain -> Turn Contract -> runtime determinístico
//   -> Financial IR/Action IR -> engines/draft -> resposta.
//
// O AgentCore legado continua disponível como fallback e para fast paths
// estritamente determinísticos durante a migração. Quando a flag está OFF,
// comportamento é 100% legado. Quando está ON, parser/router deixam de ser a
// autoridade primária dos turnos normais.
// deno-lint-ignore-file no-explicit-any

import { handleTurn as handleLegacyTurn, type HandleTurnInput, type HandleTurnResult } from "./AgentCore.ts";
import { service } from "./service.ts";
import { isEnabled } from "./FeatureFlags.ts";
import { loadHistory, withoutCurrentTurn } from "./ConversationHistory.ts";
import { resolveSession } from "./SessionManager.ts";
import { loadConversationMemory, saveConversationMemory, type ConversationMemory } from "./ConversationMemory.ts";
import { loadWorkflow } from "./WriteWorkflowManager.ts";
import { dialogueActsFromContract, interpretConversationTurn } from "./ConversationBrain.ts";
import { normalizePeriodExpressions, type ConversationTurnContract } from "./ConversationTurnContract.ts";
import { executeBrainWriteTurn } from "./ConversationBrainRuntime.ts";
import {
  attachLegacyShadowObservation,
  evaluateConversationBrainShadow,
} from "./ConversationBrainShadow.ts";
import { createTurnEvidenceCache } from "./TurnEvidenceCache.ts";
import { classifyConfirmationAct } from "./ConfirmationVocabulary.ts";
import { findPending } from "./PendingConfirmations.ts";
import { confirmAndBuildReceipt } from "./ConfirmAndReceipt.ts";
import { parseBankNotification } from "./BankNotificationParser.ts";
import { DEFAULT_FAST_LOG_TOKEN, detectFastLog, loadFastLogToken } from "./FastLog.ts";
import { enqueueReply } from "./OutboundQueue.ts";
import { sanitizeUserFacingText } from "./UserSafeError.ts";
import { humanizeReply } from "./ReplyHumanizer.ts";
import { runtimeContext } from "./RuntimeContract.ts";
import { buildTurnPlan } from "./ConversationOrchestrator.ts";
import { runSemanticTurn } from "./SemanticTurnPipeline.ts";
import { compileFinancialQuery } from "./SemanticCompiler.ts";
import { runTool } from "./ToolRuntime.ts";
import { getState, patchState } from "./StateManager.ts";
import { loadClarificationOptions } from "./SemanticClarificationOptions.ts";
import {
  loadMonthlyExpenseBuckets, resolveCategoryIdsByName, typicalMonthlyExecutedIR,
  typicalMonthlyPolicy, typicalMonthlyText,
} from "./handlers/TypicalMonthlyHandler.ts";
import { MAX_IR_QUERIES, type DialogueActLabel } from "./FinancialQueryIR.ts";
import { PROTECTED_ENGINE_FAILURE_REPLY } from "./ProtectedAnalyticalRouting.ts";
import { resolvePeriodExpressions } from "../../analytics/multiPeriodResolver.ts";
import { createTopicRepository, keywordsOf, type TopicRepository } from "./TopicRepository.ts";
import { resolveConversation, type ResolverOutput } from "./ConversationResolver.ts";
import { detectContinuationOffer, resolveContinuation } from "./ContinuationContract.ts";
import { detectExpectation } from "./ConversationExpectation.ts";
import { learnFromTurn } from "./LearningLoop.ts";
import { loadBrainUserContext } from "./BrainUserContext.ts";

const BRAIN_MODEL = "openai/gpt-oss-120b";

function looksLikeBulkOrDocument(text: string): boolean {
  const raw = String(text ?? "");
  const lines = raw.split(/\n+/).filter((line) => line.trim().length > 0);
  const moneyHits = raw.match(/(?:r\$\s*)?\d+[.,]\d{2}/gi)?.length ?? 0;
  return raw.length > 1800 || (lines.length >= 4 && moneyHits >= 3);
}

function normalizeShort(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function safeReply(text: string): string {
  return sanitizeUserFacingText(humanizeReply(String(text ?? "").trim() || "Certo."));
}

/**
 * Na V2, explicitness vem do contrato emitido pela autoridade conversacional.
 * O backend pode validar/bindar os slots, mas não chama outro classificador para
 * decidir novamente se o usuário mudou de assunto/entidade/período.
 */
function constraintsFromContract(contract: ConversationTurnContract, canonical: string) {
  return {
    period: normalizePeriodExpressions(contract.focus).length > 0,
    entity: Boolean(contract.focus.category || contract.focus.merchant || contract.focus.goal),
    // Dimensão é forma de saída (por cartão/categoria/conta/estabelecimento),
    // não uma nova intenção. Detectá-la lexicalmente não troca o significado.
    dimension: /\bpor\s+(?:cart[aã]o|conta|categoria|estabelecimento|m[eê]s|dia)\b/i.test(canonical),
  };
}

function topicContextText(base: string | null, topic: ResolverOutput | null): string | null {
  const lines: string[] = [];
  if (base?.trim()) lines.push(base.trim());
  if (topic?.clarification_required && topic.clarification_options.length) {
    lines.push(
      `TopicResolution=ambiguous; opções=${topic.clarification_options.slice(0, 3).join(" | ")}. ` +
      `Se a mensagem atual depender de contexto anterior, pergunte qual assunto o usuário quer retomar.`,
    );
  } else if (topic?.topic) {
    const t = topic.topic;
    lines.push(
      `Tópico durável relevante: assunto=${t.subject}; última_pergunta=${String(t.last_query ?? "").slice(0, 240)}; ` +
      `resumo=${String(t.summary ?? "").slice(0, 180) || "—"}; período=${t.period_from ?? "—"}..${t.period_to ?? "—"}.`,
    );
  }
  return lines.length ? lines.join("\n").slice(0, 7000) : null;
}

function subjectFromContract(contract: ConversationTurnContract): string {
  return contract.focus.goal
    ? `meta:${contract.focus.goal}`
    : contract.focus.category
      ? `categoria:${contract.focus.category}`
      : contract.focus.merchant
        ? `estabelecimento:${contract.focus.merchant}`
        : contract.mode === "write"
          ? `escrita:${contract.action?.action ?? "financeira"}`
          : contract.mode;
}

function suggestionForSemantic(semantic: any): string | null {
  if (!semantic || semantic.status !== "executable") return null;
  const q = semantic.ir_v2?.queries?.[0];
  if (!q) return null;
  const group = q.group_by?.[0] ?? null;
  if (q.metric === "expense_amount" && q.operation === "rank" && group === "category") {
    return "Se quiser, eu abro a categoria que mais pesou e mostro os principais estabelecimentos.";
  }
  if (q.metric === "expense_amount" && q.operation === "rank" && group === "merchant") {
    return "Se quiser, eu separo isso por categoria ou comparo com o período anterior.";
  }
  if (q.metric === "expense_amount" && ["sum", "value"].includes(q.operation)) {
    return "Se quiser, eu comparo esse valor com o período anterior e mostro o que mais mudou.";
  }
  if (q.metric === "goal_progress") {
    return "Se quiser, eu transformo esse progresso em um próximo passo objetivo para a meta.";
  }
  if (q.metric === "financial_health") {
    return "Posso transformar esse diagnóstico em um próximo passo prático para este mês.";
  }
  return null;
}

async function enqueueIfNeeded(sb: any, input: HandleTurnInput, body: string): Promise<void> {
  if (input.channel === "app" || !input.to_phone) return;
  await enqueueReply(sb, {
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    to_phone: input.to_phone,
    body,
    idempotency_key: `run:${input.inbound_message_id}`,
    inbound_message_id: input.inbound_message_id,
    source: input.channel === "simulator" ? "simulator" : "whatsapp",
  });
}

async function recordV2Run(args: {
  sb: any;
  input: HandleTurnInput;
  contract: ConversationTurnContract;
  started_at: number;
  tokens_in: number;
  tokens_out: number;
  model?: string | null;
  provider?: string | null;
  tools?: string[];
  error?: string | null;
}): Promise<string | undefined> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await args.sb.from("agent_runs").insert({
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      prompt_version_id: null,
      model: args.model ?? BRAIN_MODEL,
      provider: args.provider ?? null,
      status: args.error ? "error" : "done",
      started_at: new Date(args.started_at).toISOString(),
      ended_at: now,
      channel: args.input.channel,
      path: "conversation_brain_v1",
      capability: `brain:${args.contract.mode}`,
      tool_scope: args.tools ?? [],
      tools_used: args.tools ?? [],
      steps: args.tools?.length ?? 0,
      tokens_in: args.tokens_in,
      tokens_out: args.tokens_out,
      latency_ms: Date.now() - args.started_at,
      error_sanitized: args.error ?? null,
      error_masked: args.error ?? null,
      context_layers: runtimeContext(`conversation_brain:${args.contract.mode}`),
    }).select("id").maybeSingle();
    if (error) return undefined;
    return (data as any)?.id as string | undefined;
  } catch {
    return undefined;
  }
}

async function finishV2(args: {
  sb: any;
  input: HandleTurnInput;
  contract: ConversationTurnContract;
  reply: string;
  reply_kind: HandleTurnResult["reply_kind"];
  path: HandleTurnResult["path"];
  started_at: number;
  tokens_in: number;
  tokens_out: number;
  model?: string | null;
  provider?: string | null;
  draft_id?: string;
  result?: unknown;
  session_id?: string;
  tools?: string[];
  tool_calls?: Array<{ tool_name: string; args?: any; result?: any; ok: boolean }>;
  error?: string | null;
  memory?: ConversationMemory | null;
  topic_repo?: TopicRepository | null;
  topic_resolution?: ResolverOutput | null;
  active_period?: { from: string; to: string; label?: string | null } | null;
  comparison_period?: { from: string; to: string } | null;
}): Promise<HandleTurnResult> {
  const body = safeReply(args.reply);

  // Durable topic continuity is updated for every V2 mode, not only financial
  // READs. This is what lets "voltando naquele assunto..." survive a new session.
  let activeTopicId = args.topic_resolution?.topic_id ?? args.memory?.active_topic_id ?? null;
  if (args.topic_repo && !args.topic_resolution?.clarification_required) {
    const subject = subjectFromContract(args.contract);
    if (activeTopicId) {
      await args.topic_repo.touch(activeTopicId, {
        subject,
        last_query: String(args.contract.canonical_request ?? args.input.text).slice(0, 600),
        status: args.reply_kind === "question" ? "clarifying" : "answered",
        keywords: keywordsOf(String(args.contract.canonical_request ?? args.input.text)),
        period_from: args.active_period?.from ?? null,
        period_to: args.active_period?.to ?? null,
      } as any).catch(() => undefined);
    } else {
      const opened = await args.topic_repo.open({
        subject,
        title: String(args.contract.canonical_request ?? args.input.text).slice(0, 80),
        last_query: String(args.contract.canonical_request ?? args.input.text).slice(0, 600),
        keywords: keywordsOf(String(args.contract.canonical_request ?? args.input.text)),
        period: args.active_period ? { from: args.active_period.from, to: args.active_period.to } : null,
      }).catch(() => null);
      activeTopicId = opened?.id ?? null;
    }
    if (activeTopicId && args.input.inbound_message_id) {
      await args.topic_repo.linkMessage({
        topic_id: activeTopicId,
        message_id: args.input.inbound_message_id,
        direction: "inbound",
        surface: args.input.channel,
      }).catch(() => undefined);
    }
  }

  if (args.session_id) {
    const inherit = args.contract.inherit_focus;
    const awaiting = args.contract.mode === "clarify"
      ? { kind: "brain_clarification" as const, asked_at: new Date().toISOString() }
      : detectExpectation(body);
    await saveConversationMemory(args.sb, args.session_id, {
      current_topic: subjectFromContract(args.contract),
      active_topic_id: activeTopicId,
      previous_intent: args.contract.mode,
      active_category: args.contract.focus.category ?? (inherit ? args.memory?.active_category ?? null : null),
      active_merchant: args.contract.focus.merchant ?? (inherit ? args.memory?.active_merchant ?? null : null),
      active_period: args.active_period ?? (inherit ? args.memory?.active_period ?? null : null),
      comparison_period: args.comparison_period ?? (inherit ? args.memory?.comparison_period ?? null : null),
      pending_slots: args.reply_kind === "question" ? ["brain_clarification"] : [],
      awaiting: args.reply_kind === "question" && !awaiting
        ? { kind: "brain_clarification" as const, asked_at: new Date().toISOString() }
        : awaiting,
      pending_conversation_action: detectContinuationOffer(body),
      conversation_summary: String(args.contract.canonical_request ?? args.input.text).slice(0, 500),
    }).catch(() => null);
  }

  await enqueueIfNeeded(args.sb, args.input, body);
  const run_id = await recordV2Run({
    sb: args.sb, input: args.input, contract: args.contract,
    started_at: args.started_at, tokens_in: args.tokens_in, tokens_out: args.tokens_out,
    model: args.model, provider: args.provider,
    tools: args.tools, error: args.error,
  });

  // V2 must learn too. Previously the 100% Conversation Brain rollout bypassed
  // the legacy learning loop, so corrections/preferences stopped reinforcing.
  await learnFromTurn(args.sb, {
    user_id: args.input.user_id,
    intent: `brain:${args.contract.mode}`,
    policy_decision: args.contract.act,
    reply_kind: String(args.reply_kind ?? "info"),
    tool_calls: args.tool_calls ?? (args.tools ?? []).map((tool_name) => ({ tool_name, ok: !args.error })),
    user_text: args.input.text,
  }).catch(() => undefined);

  return {
    reply: body,
    reply_kind: args.reply_kind,
    path: args.path,
    draft_id: args.draft_id,
    result: args.result,
    run_id,
    session_id: args.session_id,
  };
}

/**
 * Entry point V2. O rollout é fail-closed: flag ausente/desligada usa o Core
 * legado sem nenhum efeito colateral novo. O shadow é uma flag separada e
 * apenas compara interpretação: nunca executa tools/drafts da V2.
 */
export async function handleTurnV2(input: HandleTurnInput): Promise<HandleTurnResult> {
  const enabled = await isEnabled("conversation_brain_v1", input.user_id);
  const shadowEnabled = !enabled && await isEnabled("conversation_brain_shadow_v1", input.user_id);

  if (!enabled && !shadowEnabled) return await handleLegacyTurn(input);

  if (!enabled && shadowEnabled) {
    const sb = service();
    // Os dois caminhos veem o mesmo turno. O shadow só interpreta; o legado
    // continua sendo o único responsável pela resposta e por qualquer side effect.
    const [legacy] = await Promise.all([
      handleLegacyTurn(input),
      evaluateConversationBrainShadow({
        sb,
        input: {
          user_id: input.user_id,
          conversation_id: input.conversation_id,
          inbound_message_id: input.inbound_message_id ?? null,
          channel: input.channel,
          text: input.text,
        },
        model: BRAIN_MODEL,
      }),
    ]);
    await attachLegacyShadowObservation({
      sb,
      input: {
        user_id: input.user_id,
        conversation_id: input.conversation_id,
        inbound_message_id: input.inbound_message_id ?? null,
        channel: input.channel,
        text: input.text,
      },
      legacy: { path: legacy.path ?? null, reply_kind: legacy.reply_kind ?? null },
    }).catch(() => undefined);
    return legacy;
  }

  const sb = service();
  const started = Date.now();

  // Retry de WhatsApp: devolve o outbound já criado antes de qualquer chamada de IA.
  if (input.channel !== "app") {
    const { data: existing } = await sb.from("outbound_messages")
      .select("body").eq("inbound_message_id", input.inbound_message_id).maybeSingle();
    if (existing?.body) {
      return { reply: String(existing.body), reply_kind: "info", path: "deterministic_fallback" };
    }
  }

  // Fast paths permitidos na V2 são estados/eventos inequívocos, não
  // classificadores gerais de linguagem.
  const pending = await findPending(sb, input.conversation_id, input.user_id).catch(() => null);
  const confirmationAct = classifyConfirmationAct(input.text);
  if (pending && (confirmationAct === "confirm" || confirmationAct === "cancel" || confirmationAct === "ambiguous")) {
    return await handleLegacyTurn(input);
  }

  // "Quero" confirma um draft somente quando existe ESTADO pendente. Fora
  // desse estado ele segue para o Brain e responde à pergunta/oferta recente.
  if (pending && normalizeShort(input.text) === "quero") {
    const outcome = await confirmAndBuildReceipt(sb, pending, {
      source_message_id: input.inbound_message_id ?? null,
    });
    const contract: ConversationTurnContract = {
      version: "conversation_turn_contract.v1", act: "answer", mode: "converse",
      canonical_request: null, inherit_focus: true,
      focus: { category: null, merchant: null, goal: null, period_expression: null },
      action: null,
      direct_reply: "Confirmação resolvida pelo estado financeiro pendente.",
      clarification_question: null,
      confidence: 1,
    };
    return await finishV2({
      sb, input, contract, reply: outcome.reply,
      reply_kind: outcome.ok ? "receipt" : "info",
      path: "deterministic_tool", started_at: started,
      tokens_in: 0, tokens_out: 0,
      result: outcome.execution?.result ?? null,
      tools: ["confirm_pending_action"], error: outcome.ok ? null : outcome.error,
    });
  }

  const bank = parseBankNotification(input.text);
  if (bank.draftable || looksLikeBulkOrDocument(input.text)) return await handleLegacyTurn(input);

  const fastLogToken = await loadFastLogToken(sb, input.user_id).catch(() => DEFAULT_FAST_LOG_TOKEN);
  if (detectFastLog(input.text, fastLogToken).triggered) return await handleLegacyTurn(input);

  const session = await resolveSession(sb, {
    user_id: input.user_id,
    channel: input.channel,
    conversation_id: input.conversation_id,
  }).catch(() => null as any);
  const session_id = session?.id as string | undefined;

  const threadsEnabled = await isEnabled("conversation_threads_v1", input.user_id).catch(() => false);
  const topicRepo = threadsEnabled
    ? createTopicRepository({ sb, user_id: input.user_id, conversation_id: input.conversation_id })
    : null;

  const [loadedHistory, memory, workflow, durableUserContext, recentTopics, quotedTopic] = await Promise.all([
    loadHistory(sb, input.conversation_id, { limit: 16, excludeMessageId: input.inbound_message_id }).catch(() => []),
    loadConversationMemory(sb, session_id ?? null).catch(() => null),
    loadWorkflow(sb, { user_id: input.user_id, conversation_id: input.conversation_id }).catch(() => null),
    loadBrainUserContext(sb, input.user_id).catch(() => null),
    topicRepo ? topicRepo.listRecent(12).catch(() => []) : Promise.resolve([]),
    topicRepo && input.reply_context?.quoted_message_id
      ? topicRepo.findByMessageId(input.reply_context.quoted_message_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  // WhatsApp persiste a mensagem antes do Core, mas o id técnico nem sempre é
  // o id de conversation_messages. Remove por conteúdo para não duplicar o turno.
  const history = input.channel === "app"
    ? loadedHistory
    : withoutCurrentTurn(loadedHistory, input.text);

  // A resposta curta "sim/quero/pode" primeiro tenta cumprir a oferta que o
  // próprio Nino acabou de fazer. Sem isso, cada aceite precisa ser
  // reinterpretado do zero pelo modelo.
  const continuation = resolveContinuation({
    text: input.text,
    action: memory?.pending_conversation_action ?? null,
    hasPendingWrite: !!pending,
  });
  const brainText = continuation.continue && continuation.prompt ? continuation.prompt : input.text;
  if (continuation.continue && session_id) {
    await saveConversationMemory(sb, session_id, { pending_conversation_action: null }).catch(() => null);
  }

  const topicResolution = topicRepo
    ? resolveConversation({
      text: brainText,
      quoted_message_id: input.reply_context?.quoted_message_id ?? null,
      quoted_topic: quotedTopic,
      has_pending_confirmation: !!pending,
      awaiting_answer: Boolean(memory?.awaiting),
      active_topic_id: memory?.active_topic_id ?? null,
      topics: recentTopics,
    })
    : null;
  const userContext = topicContextText(durableUserContext, topicResolution);

  const brain = await interpretConversationTurn({
    text: brainText,
    history,
    memory,
    workflow,
    user_context: userContext,
    model: BRAIN_MODEL,
    sb,
    user_id: input.user_id,
    run_id: null,
  });

  // O cérebro nunca vira mais uma camada em cima do legado: se ele falha, sai
  // completamente do caminho e o Core anterior assume o turno original.
  if (!brain.contract) return await handleLegacyTurn(input);
  const contract = brain.contract;

  if (contract.mode === "converse") {
    return await finishV2({
      sb, input, contract, reply: contract.direct_reply!, reply_kind: "info", path: "llm",
      started_at: started, tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

  if (contract.mode === "clarify") {
    return await finishV2({
      sb, input, contract, reply: contract.clarification_question!,
      reply_kind: "question", path: "llm", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

  const evidenceCache = createTurnEvidenceCache();

  if (contract.mode === "write") {
    const write = await executeBrainWriteTurn({
      sb,
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      user_text: input.text,
      contract,
      evidenceCache,
    });
    if (!write.handled) return await handleLegacyTurn(input);
    return await finishV2({
      sb, input, contract, reply: write.reply,
      reply_kind: write.reply_kind === "draft" ? "draft" : write.reply_kind === "question" ? "question" : "info",
      path: "llm", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      draft_id: write.draft_id, result: write.tool_result, session_id,
      tools: write.tool_name ? [write.tool_name] : [],
      tool_calls: write.tool_name ? [{
        tool_name: write.tool_name,
        args: write.tool_args,
        result: write.tool_result,
        ok: !write.error,
      }] : [],
      error: write.error ?? null,
      memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

  // READ: Brain resolve significado/continuidade; Semantic Compiler apenas
  // traduz o pedido canônico para Financial IR. Nenhum router reinterpreta o act.
  const canonical = String(contract.canonical_request ?? brainText).trim();
  const plan = buildTurnPlan({ text: canonical, history });
  const multiPeriod = resolvePeriodExpressions(normalizePeriodExpressions(contract.focus), canonical);
  const basePeriod = multiPeriod.periods[0] ?? {
    from: plan.effective_period.from,
    to: plan.effective_period.to,
    label: plan.effective_period.label,
  };
  const acts = dialogueActsFromContract(contract) as DialogueActLabel[];
  const constraints = constraintsFromContract(contract, canonical);
  const state = session_id ? await getState(sb, session_id).catch(() => null) : null;

  const multiQuery = await isEnabled("semantic_ir_multiquery_v1", input.user_id);
  const investigation = await isEnabled("semantic_investigation_loop_v1", input.user_id);

  const semantic = await runSemanticTurn({
    text: canonical,
    acts,
    constraints,
    period: {
      from: basePeriod.from,
      to: basePeriod.to,
      label: basePeriod.label,
    },
    comparison_period: plan.previous_period,
    periods: multiPeriod.periods.length >= 2 ? multiPeriod.periods : null,
    comparison_intent: multiPeriod.comparison_intent,
    previous_query: contract.inherit_focus ? (memory?.conversation_summary ?? null) : null,
    topic_state: state?.semantic_topic_state ?? null,
    max_queries: multiQuery ? MAX_IR_QUERIES : 1,
    investigation_enabled: investigation,
    // Segurança semântica é parte da V2, não uma otimização opcional.
    preservation_enforced: true,
    // "por mês/costumo" jamais pode cair no MTD na arquitetura nova.
    typical_monthly_enabled: true,
    failure_reply: PROTECTED_ENGINE_FAILURE_REPLY,
  }, {
    compile: (args) => compileFinancialQuery({
      text: args.text,
      model: BRAIN_MODEL,
      period: {
        from: basePeriod.from,
        to: basePeriod.to,
        label: basePeriod.label,
      },
      comparison_period: plan.previous_period,
      previous_query: args.previous_query,
      max_queries: args.max_queries,
      replan: args.replan ?? null,
      reason: "conversation_brain_v1_read_compile",
      sb,
      user_id: input.user_id,
      run_id: null,
    }),
    runEngine: async (tool, toolArgs) => {
      const exec = await runTool({
        sb,
        user_id: input.user_id,
        conversation_id: input.conversation_id,
        user_text: canonical,
        evidenceCache,
      } as any, tool, toolArgs, { timeoutMs: 12_000, maxRetries: 1 });
      return { ok: exec.ok, result: exec.result, error: exec.error, duration_ms: exec.duration_ms };
    },
    runTypicalMonthly: async (query) => {
      const label = query.filters.find((f) => f.field === "category")?.value ?? null;
      const categoryIds = label ? await resolveCategoryIdsByName(sb, input.user_id, String(label)) : null;
      if (label && (!categoryIds || !categoryIds.length)) return { domain_error: "category_not_found" as const };
      if (label && categoryIds && categoryIds.length > 1) return { domain_error: "category_ambiguous" as const };
      const window = { from: query.time.from!, to: query.time.to!, n: query.time.n ?? 6 };
      const buckets = await loadMonthlyExpenseBuckets(sb, {
        user_id: input.user_id, from: window.from, to: window.to, category_ids: categoryIds,
      });
      const result = typicalMonthlyPolicy({
        buckets, window, preferred: query.reduce === "mean" ? "mean" : "typical",
      });
      return {
        text: typicalMonthlyText(result, label ? String(label) : null),
        executed_ir: typicalMonthlyExecutedIR(query, result),
        engine: "typical_monthly_expense",
        result,
      };
    },
    loadOptions: async (slot) => (await loadClarificationOptions({ sb, user_id: input.user_id, slot })).options,
    recordStage: () => undefined,
  }).catch(() => null);

  if (!semantic) return await handleLegacyTurn(input);
  if (session_id) {
    await patchState(sb, session_id, { semantic_topic_state: semantic.topic_state }).catch(() => undefined);
  }

  let reply = semantic.turn?.reply
    ?? semantic.canonical_fallback?.honest_reply
    ?? "Entendi a pergunta, mas não consegui fechar uma resposta segura com os dados disponíveis.";
  const replyKind: HandleTurnResult["reply_kind"] = semantic.status === "clarification_required" ? "question" : "info";
  if (replyKind === "info") {
    const suggestion = suggestionForSemantic(semantic);
    if (suggestion && !detectContinuationOffer(reply)) reply = `${reply}\n\n${suggestion}`;
  }

  return await finishV2({
    sb, input, contract, reply, reply_kind: replyKind,
    path: "llm", started_at: started,
    tokens_in: brain.telemetry.tokens_in,
    tokens_out: brain.telemetry.tokens_out,
    model: brain.telemetry.model, provider: brain.telemetry.provider,
    session_id,
    tools: semantic.engines,
    tool_calls: semantic.engines.map((tool_name: string) => ({ tool_name, ok: true })),
    error: semantic.errors.length ? semantic.errors.join(";").slice(0, 300) : null,
    memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    active_period: { from: basePeriod.from, to: basePeriod.to, label: basePeriod.label ?? null },
    comparison_period: plan.previous_period,
  });
}
