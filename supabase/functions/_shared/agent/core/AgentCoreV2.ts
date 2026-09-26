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
import {
  comparisonPeriodExpressions, normalizeConversationTurnContract, normalizePeriodExpressions,
  type CanonicalConversationTurnContract, type ConversationTurnContract,
} from "./ConversationTurnContract.ts";
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
import { runTool } from "./ToolRuntime.ts";
import { getState, patchState } from "./StateManager.ts";
import { loadClarificationOptions } from "./SemanticClarificationOptions.ts";
import {
  loadMonthlyExpenseBuckets, resolveCategoryIdsByName, typicalMonthlyExecutedIR,
  typicalMonthlyPolicy, typicalMonthlyText,
} from "./handlers/TypicalMonthlyHandler.ts";
import {
  loadMonthlySpendingSeries, monthlySeriesExecutedIR, monthlySpendingSeriesText,
} from "./handlers/MonthlySeriesHandler.ts";
import { MAX_IR_QUERIES, type DialogueActLabel } from "./FinancialQueryIR.ts";
import { PROTECTED_ENGINE_FAILURE_REPLY } from "./ProtectedAnalyticalRouting.ts";
import { executeDeterministicCapability } from "./DeterministicAnswers.ts";
import { resolveBrainAdvisory } from "./BrainAdvisoryBridge.ts";
import { resolvePeriodExpressions } from "../../analytics/multiPeriodResolver.ts";
import { createTopicRepository, keywordsOf, type TopicRepository } from "./TopicRepository.ts";
import { resolveConversation, type ResolverOutput } from "./ConversationResolver.ts";
import { detectContinuationOffer, resolveContinuation } from "./ContinuationContract.ts";
import { detectExpectation } from "./ConversationExpectation.ts";
import { learnFromTurn } from "./LearningLoop.ts";
import { loadBrainUserContext } from "./BrainUserContext.ts";
import { resolveNarrowDeterministicTurn } from "./NarrowDeterministicGate.ts";
import {
  advanceReferences, captureReferenceObjects, invalidateReferences,
} from "./ConversationReferenceStore.ts";
import {
  applyGroundedReferenceScope, executedReferenceScope, groundTurnContract,
} from "./GroundingEngine.ts";
import { buildFinancialReadContract } from "./FinancialReadContract.ts";
import { compileFinancialReadFromTurn } from "./TurnContractFinancialAdapter.ts";
import { verifyFinancialFulfillment } from "./ContractFulfillmentGate.ts";
import { resolveGroundedComparisonFollowup } from "./GroundedComparisonFollowup.ts";
import { applyImplicitPeriodToClarification, resolveImplicitPeriod } from "./ImplicitPeriodPolicy.ts";
import { comparablePrevious } from "../../analytics/periodResolver.ts";

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

function runtimeFailureContract(reply: string): CanonicalConversationTurnContract {
  return {
    version: "conversation_turn_contract.v2",
    act: "conversational",
    mode: "converse",
    domain: "conversation",
    canonical_request: null,
    inherit_focus: false,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: reply,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "not_applicable",
      time: "not_applicable",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  };
}

/**
 * Na V2, explicitness vem do contrato emitido pela autoridade conversacional.
 * O backend pode validar/bindar os slots, mas não chama outro classificador para
 * decidir novamente se o usuário mudou de assunto/entidade/período.
 */
function constraintsFromContract(contract: ConversationTurnContract, _canonical: string) {
  const semanticQueries = contract.financial_read?.queries ?? [];
  return {
    period: normalizePeriodExpressions(contract.focus).length > 0,
    entity: Boolean(
      contract.focus.category || contract.focus.merchant || contract.focus.goal
      || semanticQueries.some((q) => q.filters.length > 0),
    ),
    // Dimensão vem do Turn Contract, nunca de uma segunda leitura lexical.
    dimension: semanticQueries.some((q) => q.group_by.length > 0),
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

function suggestionsAllowed(userContext: string | null | undefined): boolean {
  const text = String(userContext ?? "");
  return !/"suggestion_frequency"\s*:\s*"low"/i.test(text)
    && !/sugest(?:ao|oes)[^\n]{0,20}=low/i.test(text);
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
  path: HandleTurnResult["path"];
  tools?: string[];
  error?: string | null;
  diagnostics?: Record<string, unknown> | null;
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
      path: args.path,
      capability: `brain:${args.contract.mode}`,
      tool_scope: args.tools ?? [],
      tools_used: args.tools ?? [],
      steps: args.tools?.length ?? 0,
      tokens_in: args.tokens_in,
      tokens_out: args.tokens_out,
      latency_ms: Date.now() - args.started_at,
      error_sanitized: args.error ?? null,
      error_masked: args.error ?? null,
      context_layers: {
        ...runtimeContext(`conversation_brain:${args.contract.mode}`),
        ...(args.diagnostics ? { semantic_execution: args.diagnostics } : {}),
      },
    }).select("id").maybeSingle();
    if (error) {
      console.error("[AgentCoreV2] agent_runs insert failed", JSON.stringify({
        code: String((error as any)?.code ?? ""),
        message: String((error as any)?.message ?? "").slice(0, 180),
        path: args.path,
      }));
      return undefined;
    }
    return (data as any)?.id as string | undefined;
  } catch (error) {
    console.error("[AgentCoreV2] agent_runs insert exception", String((error as Error)?.message ?? "").slice(0, 180));
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
  diagnostics?: Record<string, unknown> | null;
}): Promise<HandleTurnResult> {
  const body = safeReply(args.reply);

  // Reference Store is working memory, not semantic inference. Repairs
  // invalidate the previous referent; successful tool results can publish a
  // new structured entity set for later "delas/essa categoria" follow-ups.
  let nextReferences = args.memory?.references ?? [];
  if (args.contract.act === "repair") nextReferences = invalidateReferences(nextReferences);
  const capturedReferences = captureReferenceObjects(args.tool_calls ?? []);
  if (capturedReferences.length) {
    nextReferences = [...nextReferences, ...capturedReferences].slice(-8);
  }

  // Durable topic continuity is updated for meaningful V2 topics. Pure social
  // turns ("oi", "obrigado") must not replace the financial topic the user may
  // resume a message later.
  const incidentalConversation = args.contract.mode === "converse"
    && args.contract.act === "conversational"
    && !args.contract.inherit_focus;
  let activeTopicId = args.topic_resolution?.topic_id
    ?? (args.contract.act === "topic_switch" ? null : args.memory?.active_topic_id ?? null);
  const shouldPersistTopic = !!args.topic_repo
    && !args.topic_resolution?.clarification_required
    && !incidentalConversation;
  if (shouldPersistTopic && args.topic_repo) {
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
      current_topic: incidentalConversation
        ? args.memory?.current_topic ?? null
        : subjectFromContract(args.contract),
      active_topic_id: incidentalConversation
        ? args.memory?.active_topic_id ?? null
        : activeTopicId,
      previous_intent: incidentalConversation
        ? args.memory?.previous_intent ?? null
        : args.contract.mode,
      active_category: incidentalConversation
        ? args.memory?.active_category ?? null
        : args.contract.focus.category ?? (inherit ? args.memory?.active_category ?? null : null),
      active_merchant: incidentalConversation
        ? args.memory?.active_merchant ?? null
        : args.contract.focus.merchant ?? (inherit ? args.memory?.active_merchant ?? null : null),
      active_period: incidentalConversation
        ? args.memory?.active_period ?? null
        : args.active_period ?? (inherit ? args.memory?.active_period ?? null : null),
      comparison_period: incidentalConversation
        ? args.memory?.comparison_period ?? null
        : args.comparison_period ?? (inherit ? args.memory?.comparison_period ?? null : null),
      pending_slots: args.reply_kind === "question" ? ["brain_clarification"] : [],
      awaiting: args.reply_kind === "question" && !awaiting
        ? { kind: "brain_clarification" as const, asked_at: new Date().toISOString() }
        : awaiting,
      pending_conversation_action: detectContinuationOffer(body)
        ?? (incidentalConversation ? args.memory?.pending_conversation_action ?? null : null),
      conversation_summary: incidentalConversation
        ? args.memory?.conversation_summary ?? null
        : String(args.contract.canonical_request ?? args.input.text).slice(0, 500),
      references: nextReferences,
    }).catch(() => null);
  }

  await enqueueIfNeeded(args.sb, args.input, body);
  const run_id = await recordV2Run({
    sb: args.sb, input: args.input, contract: args.contract,
    started_at: args.started_at, tokens_in: args.tokens_in, tokens_out: args.tokens_out,
    model: args.model, provider: args.provider, path: args.path,
    tools: args.tools, error: args.error, diagnostics: args.diagnostics,
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
    const contract = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2", act: "answer", mode: "converse",
      domain: "conversation",
      canonical_request: null, inherit_focus: true,
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: null,
      direct_reply: "Confirmação resolvida pelo estado financeiro pendente.",
      clarification_question: null,
      resolution: {
        intent: "resolved", reference: "not_applicable", time: "not_applicable",
        entity: "not_applicable", action: "not_applicable",
      },
      reference: null,
      advisory_kind: null,
    })!;
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

  const [loadedHistory, rawMemory, workflow, durableUserContext, recentTopics, quotedTopic] = await Promise.all([
    loadHistory(sb, input.conversation_id, { limit: 16, excludeMessageId: input.inbound_message_id }).catch(() => []),
    loadConversationMemory(sb, session_id ?? null).catch(() => null),
    loadWorkflow(sb, { user_id: input.user_id, conversation_id: input.conversation_id }).catch(() => null),
    loadBrainUserContext(sb, input.user_id).catch(() => null),
    topicRepo ? topicRepo.listRecent(12).catch(() => []) : Promise.resolve([]),
    topicRepo && input.reply_context?.quoted_message_id
      ? topicRepo.findByMessageId(input.reply_context.quoted_message_id).catch(() => null)
      : Promise.resolve(null),
  ]);
  const memory = rawMemory
    ? { ...rawMemory, references: advanceReferences(rawMemory.references ?? []) }
    : rawMemory;

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

  const groundedFollowupContract = resolveGroundedComparisonFollowup(brainText, memory);
  const narrowContract = groundedFollowupContract ?? resolveNarrowDeterministicTurn(brainText);
  const brain = narrowContract
    ? {
      contract: narrowContract,
      telemetry: {
        model: groundedFollowupContract ? "deterministic:grounded_comparison_followup" : "deterministic",
        provider: null,
        llm_calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
        ok: true,
        error: null,
      },
    }
    : await interpretConversationTurn({
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

  // Depois que a lane V2 assumiu o turno, nenhuma falha do Brain pode devolver
  // autoridade ao parser/router legado. Falha de interpretação é fail-closed:
  // não executa ferramenta, não alarga escopo e pede reformulação.
  if (!brain.contract) {
    const reply = "Não consegui interpretar essa mensagem com segurança. Pode reformular o pedido em uma frase?";
    const failureContract = runtimeFailureContract(reply);
    return await finishV2({
      sb, input, contract: failureContract, reply, reply_kind: "question",
      path: "deterministic_fallback", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      error: brain.telemetry.error ?? "conversation_brain_contract_unavailable",
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }
  const contract: CanonicalConversationTurnContract = applyImplicitPeriodToClarification(
    brain.contract,
    brainText,
  );

  // Grounding only binds the reference already declared by the Turn Contract.
  // Missing/expired referents fail closed instead of widening scope.
  const groundedTurn = groundTurnContract(contract, memory);
  if (!groundedTurn.ok) {
    return await finishV2({
      sb, input, contract,
      reply: groundedTurn.clarification ?? "Pode me dizer a que você está se referindo?",
      reply_kind: "question", path: "deterministic_fallback", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

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
    if (!write.handled) {
      return await finishV2({
        sb, input, contract,
        reply: "Entendi o pedido, mas não consegui executá-lo com segurança. Não alterei nada.",
        reply_kind: "info", path: "deterministic_fallback", started_at: started,
        tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
        model: brain.telemetry.model, provider: brain.telemetry.provider,
        error: write.error ?? "conversation_brain_write_unhandled",
        session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
      });
    }
    const writeExecuted = Boolean(write.tool_name && write.reply_kind !== "question");
    return await finishV2({
      sb, input, contract, reply: write.reply,
      reply_kind: write.reply_kind === "draft" ? "draft" : write.reply_kind === "question" ? "question" : "info",
      path: "llm", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      draft_id: write.draft_id, result: write.tool_result, session_id,
      tools: writeExecuted && write.tool_name ? [write.tool_name] : [],
      tool_calls: writeExecuted && write.tool_name ? [{
        tool_name: write.tool_name,
        args: write.tool_args,
        result: write.tool_result,
        ok: !write.error,
      }] : [],
      error: write.error ?? null,
      memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

  // READ: Brain resolve significado/continuidade. Advisory intents with a
  // dedicated canonical engine are bound here BEFORE FinancialQueryIR. This is
  // not a second language classifier: the bridge only reads the canonical
  // request emitted by the Conversation Brain.
  const canonical = String(contract.canonical_request ?? brainText).trim();
  const advisory = resolveBrainAdvisory(contract);
  if (advisory) {
    const advisoryTurn = await executeDeterministicCapability(sb, {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      user_text: canonical,
      capability: advisory.capability,
      evidenceCache,
    }).catch(() => null);

    if (advisoryTurn) {
      const toolCalls = advisoryTurn.toolCalls ?? [];
      const asksQuestion = /\?\s*$/.test(String(advisoryTurn.reply ?? "").trim())
        && toolCalls.some((call: any) => call.ok === true);
      return await finishV2({
        sb, input, contract, reply: advisoryTurn.reply,
        reply_kind: asksQuestion ? "question" : "info",
        path: "deterministic_tool", started_at: started,
        tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
        model: brain.telemetry.model, provider: brain.telemetry.provider,
        session_id,
        tools: toolCalls.map((call: any) => String(call.tool_name ?? "")).filter(Boolean),
        tool_calls: toolCalls.map((call: any) => ({
          tool_name: String(call.tool_name ?? "advisory_engine"),
          args: call.args,
          result: call.result,
          ok: call.ok === true,
        })),
        error: advisoryTurn.finish === "tool_error"
          ? String(toolCalls.find((call: any) => call.ok === false)?.error ?? "advisory_engine_error")
          : null,
        memory, topic_repo: topicRepo, topic_resolution: topicResolution,
      });
    }
  }

  // canonical_request já incorporou continuidade/elipse. O resolver temporal
  // não recebe histórico, portanto não pode reclassificar o turno novamente.
  const plan = buildTurnPlan({ text: canonical, history: [] });
  const comparisonIntent = contract.financial_read?.queries.some((query) => query.operation === "compare") ?? false;
  // Em comparação, o Brain declara baseline/target como papéis semânticos.
  // O resolver abaixo só converte as expressões humanas em datas — ele não
  // decide mais qual período é referência e qual é o avaliado.
  const comparisonExpressions = comparisonPeriodExpressions(contract);
  const statisticalTargetExpression = contract.financial_read?.queries.find((query) =>
    query.operation === "compare"
    && query.comparison_baseline === "mean_previous_complete_months"
  )?.comparison_target_expression?.trim() || null;
  const multiPeriod = resolvePeriodExpressions(
    comparisonExpressions
      ?? (statisticalTargetExpression ? [statisticalTargetExpression] : normalizePeriodExpressions(contract.focus)),
    canonical,
  );
  const hasExplicitComparisonRoles = comparisonIntent
    && !!comparisonExpressions
    && multiPeriod.periods.length >= 2;
  const explicitBasePeriod = hasExplicitComparisonRoles ? multiPeriod.periods[1] : multiPeriod.periods[0];
  const lastRelatedPeriod = memory?.last_analysis?.period ?? memory?.last_tool_context?.period ?? null;
  const periodPolicy = resolveImplicitPeriod({
    explicit: explicitBasePeriod,
    active: memory?.active_period ?? null,
    last_related: lastRelatedPeriod,
    current_month: plan.effective_period,
  });
  const basePeriod = periodPolicy.period;
  const resolvedComparisonPeriod = hasExplicitComparisonRoles
    ? multiPeriod.periods[0]
    : comparablePrevious(basePeriod);
  const acts = dialogueActsFromContract(contract) as DialogueActLabel[];
  const constraints = constraintsFromContract(contract, canonical);
  const state = session_id ? await getState(sb, session_id).catch(() => null) : null;

  // O contrato já declara quantas subconsultas fazem parte do pedido. Uma flag
  // antiga não pode truncar essa semântica depois do Brain.
  const contractQueryCount = Math.max(
    1,
    Math.min(MAX_IR_QUERIES, contract.financial_read?.queries.length ?? 1),
  );
  // Replan semântico por LLM permanece disponível no pipeline legado, mas não
  // na lane autoritativa: um IR revisado seria uma segunda interpretação.
  const authoritativeInvestigationEnabled = false;

  const semantic = await runSemanticTurn({
    text: canonical,
    acts,
    constraints,
    period: {
      from: basePeriod.from,
      to: basePeriod.to,
      label: basePeriod.label,
    },
    comparison_period: resolvedComparisonPeriod,
    periods: multiPeriod.periods.length >= 2 ? multiPeriod.periods : null,
    comparison_intent: comparisonIntent,
    previous_query: contract.inherit_focus ? (memory?.conversation_summary ?? null) : null,
    topic_state: state?.semantic_topic_state ?? null,
    max_queries: contractQueryCount,
    investigation_enabled: authoritativeInvestigationEnabled,
    // Segurança semântica é parte da V2, não uma otimização opcional.
    preservation_enforced: true,
    // "por mês/costumo" jamais pode cair no MTD na arquitetura nova.
    typical_monthly_enabled: true,
    authoritative_contract: true,
    failure_reply: PROTECTED_ENGINE_FAILURE_REPLY,
  }, {
    compile: async (args) => {
      // Financial semantics come only from the canonical Turn Contract.
      // Replan semântico por LLM é recusado nesta lane: evidência pode mudar a
      // execução, nunca reescrever o significado já contratado.
      if (args.replan) return null;
      const compiled = compileFinancialReadFromTurn({
        turn: contract,
        period: {
          from: basePeriod.from,
          to: basePeriod.to,
          label: basePeriod.label ?? "período solicitado",
        },
        comparison_period: resolvedComparisonPeriod
          ? {
            from: resolvedComparisonPeriod.from,
            to: resolvedComparisonPeriod.to,
            label: resolvedComparisonPeriod.label ?? "período anterior",
          }
          : null,
      });
      return compiled ?? {
        ir: null,
        telemetry: {
          model: "deterministic:turn_contract",
          llm_calls: 0,
          tokens_in: 0,
          tokens_out: 0,
          latency_ms: 0,
          ok: false,
          error: "turn_contract_financial_adapter_failed",
          source: "unavailable" as const,
        },
      };
    },
    runEngine: async (tool, toolArgs) => {
      const scopedArgs = applyGroundedReferenceScope(tool, toolArgs, groundedTurn.reference);
      const exec = await runTool({
        sb,
        user_id: input.user_id,
        conversation_id: input.conversation_id,
        user_text: canonical,
        evidenceCache,
      } as any, tool, scopedArgs, { timeoutMs: 12_000, maxRetries: 1 });
      return { ok: exec.ok, result: exec.result, error: exec.error, duration_ms: exec.duration_ms };
    },
    runTypicalMonthly: async (query) => {
      if (query.grain === "month" && query.time.aspect === "trend") {
        const categoryLabel = query.filters.find((f) => f.field === "category")?.value ?? null;
        const merchantLabel = query.filters.find((f) => f.field === "merchant")?.value ?? null;
        const categoryIds = categoryLabel
          ? await resolveCategoryIdsByName(sb, input.user_id, String(categoryLabel))
          : null;
        if (categoryLabel && (!categoryIds || !categoryIds.length)) {
          return { domain_error: "category_not_found" as const };
        }
        if (categoryLabel && categoryIds && categoryIds.length > 1) {
          return { domain_error: "category_ambiguous" as const };
        }
        const from = String(query.time.from ?? "");
        const to = String(query.time.to ?? "");
        if (!from || !to) return null;
        const result = await loadMonthlySpendingSeries(sb, {
          user_id: input.user_id,
          from, to,
          category_ids: categoryIds,
          category_label: categoryLabel ? String(categoryLabel) : null,
          merchant: merchantLabel ? String(merchantLabel) : null,
        });
        return {
          text: monthlySpendingSeriesText(result),
          executed_ir: monthlySeriesExecutedIR(query, result),
          engine: "spending_timeseries_monthly",
          result,
        };
      }

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

  if (!semantic) {
    return await finishV2({
      sb, input, contract,
      reply: PROTECTED_ENGINE_FAILURE_REPLY,
      reply_kind: "info", path: "deterministic_fallback", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      error: "authoritative_semantic_pipeline_failed",
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }
  if (session_id) {
    await patchState(sb, session_id, { semantic_topic_state: semantic.topic_state }).catch(() => undefined);
  }

  // Hierarquia de contratos: Turn Contract -> financial_read_contract.v4.
  // O contrato financeiro encapsula o IR v3 existente; ele não compete com a
  // autoridade conversacional e é verificado contra a execução/evidência.
  const financialReadContract = semantic.ir_v3
    ? buildFinancialReadContract({
      turn: contract,
      requested: semantic.ir_v3,
      grounded_reference: groundedTurn.reference,
    })
    : null;
  const appliedReferenceScope = (semantic.turn?.toolCalls ?? [])
    .map((call: any) => executedReferenceScope(call?.result))
    .find((scope: any) => !!scope) ?? null;
  const fulfillment = financialReadContract
    ? verifyFinancialFulfillment({
      contract: financialReadContract,
      preservation: semantic.preservation,
      grounding: semantic.grounding ?? null,
      applied_reference_scope: appliedReferenceScope,
    })
    : null;

  let reply = semantic.turn?.reply
    ?? semantic.canonical_fallback?.honest_reply
    ?? "Entendi a pergunta, mas não consegui fechar uma resposta segura com os dados disponíveis.";
  let replyKind: HandleTurnResult["reply_kind"] = semantic.status === "clarification_required" ? "question" : "info";
  const fulfillmentBlocked = !!fulfillment && !fulfillment.ok && !!semantic.turn;
  if (fulfillmentBlocked) {
    reply = PROTECTED_ENGINE_FAILURE_REPLY;
    replyKind = "info";
  }
  if (replyKind === "info" && !fulfillmentBlocked && suggestionsAllowed(durableUserContext)) {
    const suggestion = suggestionForSemantic(semantic);
    if (suggestion && !detectContinuationOffer(reply)) reply = `${reply}\n\n${suggestion}`;
  }

  // A lane autoritativa pode devolver a resposta protegida antes de executar
  // qualquer engine. Isso é uma falha real do contrato, não um run "done".
  // Sem este sinal, o incidente de produção aparecia saudável na telemetria.
  const semanticContractFailed = semantic.telemetry?.executed_by === "contract_failed_closed";
  const semanticUnsupported = semantic.status === "unsupported" && !semantic.turn;
  const successfulSemanticExecution = (semantic.turn?.toolCalls ?? []).some((call) => call?.ok === true);

  return await finishV2({
    sb, input, contract, reply, reply_kind: replyKind,
    path: "llm", started_at: started,
    tokens_in: brain.telemetry.tokens_in,
    tokens_out: brain.telemetry.tokens_out,
    model: brain.telemetry.model, provider: brain.telemetry.provider,
    session_id,
    tools: semantic.engines,
    tool_calls: (semantic.turn?.toolCalls ?? []).map((call: any) => ({
      tool_name: String(call.tool_name ?? "semantic_engine"),
      args: call.args,
      result: call.result,
      ok: call.ok === true,
    })),
    error: fulfillmentBlocked
      ? `contract_fulfillment_blocked:${fulfillment!.violations.map((v) => v.code).join(",")}`.slice(0, 300)
      : semanticContractFailed
        ? `semantic_contract_failed_closed:${semantic.status}`.slice(0, 300)
      : semanticUnsupported
        ? `semantic_unsupported:${semantic.validation?.errors.join(",") || "no_engine"}`.slice(0, 300)
      : semantic.turn ? null : (semantic.errors.length ? semantic.errors.join(";").slice(0, 300) : null),
    memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    // Persist the period contract that was ACTUALLY executed. Using the
    // pre-semantic planner period here stored July + an unrelated June window
    // after a July/August turn, poisoning the next elliptical follow-up.
    active_period: successfulSemanticExecution && semantic.ir_v2?.period
      ? { from: semantic.ir_v2.period.from, to: semantic.ir_v2.period.to, label: semantic.ir_v2.period.label ?? null }
      : memory?.active_period ?? { from: basePeriod.from, to: basePeriod.to, label: basePeriod.label ?? null },
    comparison_period: successfulSemanticExecution && semantic.ir_v2?.comparison_period
      ? { from: semantic.ir_v2.comparison_period.from, to: semantic.ir_v2.comparison_period.to }
      : memory?.comparison_period ?? null,
    diagnostics: {
      semantic_status: semantic.status,
      executed_by: semantic.telemetry?.executed_by ?? null,
      mapped_tools: semantic.validation?.mapped.map((item) => item.tool) ?? [],
      validation_errors: semantic.validation?.errors ?? [],
      unsupported_queries: semantic.validation?.unsupported_queries ?? [],
      engines: semantic.engines,
      successful_execution: successfulSemanticExecution,
    },
  });
}
