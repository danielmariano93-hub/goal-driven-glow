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
import {
  dialogueActsFromContract, interpretConversationTurn, isProviderCapacityFailure, isProviderStructuredFailure,
} from "./ConversationAuthority.ts";
import {
  comparisonPeriodExpressions, normalizeConversationTurnContract, normalizePeriodExpressions,
  type CanonicalConversationTurnContract, type ConversationTurnContract,
} from "./ConversationTurnContract.ts";
import { executeBrainWriteTurn } from "./ConversationBrainRuntime.ts";
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
import { compileDeterministicConversationTurn } from "./DeterministicConversationCompiler.ts";
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
import { remember } from "./MemoryStore.ts";
import {
  composeConversationalReply, type ComposeKind, type ComposeResult,
} from "../v3/ConversationalComposerV3.ts";
import { executeAdvisorReasoning, isAdvisorReasoningKind } from "../v3/AdvisorReasoningV3.ts";
import { executeSpendingGoalAdvice } from "./SpendingGoalTools.ts";
import { executeCategoryReading, executePeriodReview } from "../v3/PeriodReviewV3.ts";
import {
  capSeriesWindow, loadScopedSeries, SCOPED_SERIES_ENGINE, scopedSeriesExecutedIR, scopedSeriesText,
} from "./handlers/ScopedSeriesHandler.ts";
import { isScopedSeriesGrain } from "./SeriesGrain.ts";

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

function constraintsFromContract(contract: ConversationTurnContract, _canonical: string) {
  const semanticQueries = contract.financial_read?.queries ?? [];
  return {
    period: normalizePeriodExpressions(contract.focus).length > 0,
    entity: Boolean(
      contract.focus.category || contract.focus.merchant || contract.focus.goal
      || semanticQueries.some((q) => q.filters.length > 0),
    ),
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
  llm_calls?: number;
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
      llm_calls: Math.max(0, Number(args.llm_calls ?? 0) || 0),
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
  llm_calls?: number;
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

  let nextReferences = args.memory?.references ?? [];
  if (args.contract.act === "repair") nextReferences = invalidateReferences(nextReferences);
  const capturedReferences = captureReferenceObjects(args.tool_calls ?? []);
  if (capturedReferences.length) {
    nextReferences = [...nextReferences, ...capturedReferences].slice(-8);
  }

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
    llm_calls: args.llm_calls,
    model: args.model, provider: args.provider, path: args.path,
    tools: args.tools, error: args.error, diagnostics: args.diagnostics,
  });

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
    // Evidência EXATA executada neste turno: o gráfico e o follow-up usam estes
    // resultados, nunca uma reconstrução a partir da memória.
    executed_calls: (args.tool_calls ?? [])
      .filter((call) => call.ok && call.result != null)
      .map((call) => ({ tool_name: call.tool_name, args: call.args ?? {}, result: call.result, ok: true })),
  };
}

export async function handleTurnV2(input: HandleTurnInput): Promise<HandleTurnResult> {
  // V3 é a única autoridade de linguagem. O runtime antigo só atende os atalhos
  // determinísticos abaixo (confirmação pendente, notificação bancária/lote e
  // registro rápido) — nunca mais por falha de leitura de flag.
  const v3AuthorityEnabled = true;
  const sb = service();
  const started = Date.now();

  if (input.channel !== "app") {
    const { data: existing } = await sb.from("outbound_messages")
      .select("body").eq("inbound_message_id", input.inbound_message_id).maybeSingle();
    if (existing?.body) {
      return { reply: String(existing.body), reply_kind: "info", path: "deterministic_fallback" };
    }
  }

  const pending = await findPending(sb, input.conversation_id, input.user_id).catch(() => null);
  const confirmationAct = classifyConfirmationAct(input.text);
  if (pending && (confirmationAct === "confirm" || confirmationAct === "cancel" || confirmationAct === "ambiguous")) {
    return await handleLegacyTurn(input);
  }

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

  const history = input.channel === "app"
    ? loadedHistory
    : withoutCurrentTurn(loadedHistory, input.text);

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

  const v3FirstEnabled = v3AuthorityEnabled
    && await isEnabled("v3_first_authority_v1", input.user_id).catch(() => false);

  // Closed financial grammar and evidence-backed follow-ups use one strict,
  // fail-closed deterministic authority. Everything else reaches V3. This
  // prevents provider capacity from breaking turns whose meaning is already
  // fully represented by owned state (confirmation-gated writes, exact reads,
  // charts and follow-ups over persisted evidence).
  //
  // Under `v3_first_authority_v1` the order follows the architecture contract:
  // V3 is the only language authority during healthy operation and the closed
  // compiler is consulted exclusively as provider-failure recovery below.
  const groundedFollowupContract = v3AuthorityEnabled
    ? (v3FirstEnabled ? null : compileDeterministicConversationTurn({ text: brainText, memory }))
    : resolveGroundedComparisonFollowup(brainText, memory);
  const narrowContract = v3AuthorityEnabled
    ? groundedFollowupContract
    : (groundedFollowupContract ?? resolveNarrowDeterministicTurn(brainText));
  let brain: {
    contract: CanonicalConversationTurnContract | null;
    telemetry: {
      model: string; provider: string | null; llm_calls: number; tokens_in: number; tokens_out: number;
      latency_ms: number; ok: boolean; error: string | null;
    };
    additional_contracts?: CanonicalConversationTurnContract[];
  } = narrowContract
    ? {
      contract: narrowContract,
      telemetry: {
        model: v3AuthorityEnabled
          ? "deterministic:closed_contract"
          : groundedFollowupContract ? "deterministic:grounded_comparison_followup" : "deterministic",
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
    }) as any;

  // V3 remains the sole semantic authority during healthy operation. If both
  // model tiers fail at the provider/structured-output boundary, recover only
  // closed, fail-safe contracts already covered by the deterministic compiler.
  // This prevents a transient 400/429 from turning an unequivocal read or a
  // confirmation-gated write into "não consegui processar". Ambiguous language
  // still returns null from the compiler and keeps the honest technical reply.
  // (Only reachable when the compiler did not already run before V3.)
  let semanticProviderRecovery: string | null = null;
  const providerFailure = isProviderCapacityFailure(brain.telemetry.error)
    || isProviderStructuredFailure(brain.telemetry.error)
    || /semantic_interpreter_v3_(?:contract_invalid|json_invalid)/.test(String(brain.telemetry.error ?? ""));
  if (v3AuthorityEnabled && v3FirstEnabled && !narrowContract && brain.telemetry.ok === false && providerFailure) {
    const recovered = compileDeterministicConversationTurn({ text: brainText, memory });
    if (recovered) {
      semanticProviderRecovery = String(brain.telemetry.error ?? "semantic_authority_unavailable").slice(0, 220);
      brain = {
        contract: recovered,
        telemetry: {
          ...brain.telemetry,
          model: `deterministic:provider_recovery:${brain.telemetry.model}`.slice(0, 180),
          ok: true,
        },
      };
    }
  }
  const semanticResolutionPath: HandleTurnResult["path"] = narrowContract || semanticProviderRecovery
    ? "deterministic_tool"
    : "llm";

  if (!brain.contract) {
    const reply = "Não consegui interpretar essa mensagem com segurança. Pode reformular o pedido em uma frase?";
    const failureContract = runtimeFailureContract(reply);
    return await finishV2({
      sb, input, contract: failureContract, reply, reply_kind: "question",
      path: "deterministic_fallback", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      llm_calls: brain.telemetry.llm_calls,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      error: brain.telemetry.error ?? "conversation_brain_contract_unavailable",
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }
  const contract: CanonicalConversationTurnContract = applyImplicitPeriodToClarification(
    brain.contract,
    brainText,
  );

  const groundedTurn = groundTurnContract(contract, memory);
  if (!groundedTurn.ok) {
    return await finishV2({
      sb, input, contract,
      reply: groundedTurn.clarification ?? "Pode me dizer a que você está se referindo?",
      reply_kind: "question", path: "deterministic_fallback", started_at: started,
      tokens_in: brain.telemetry.tokens_in, tokens_out: brain.telemetry.tokens_out,
      llm_calls: brain.telemetry.llm_calls,
      model: brain.telemetry.model, provider: brain.telemetry.provider,
      session_id, memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    });
  }

  const [composerEnabled, memoryEnabled, advisorEnabled] = await Promise.all([
    isEnabled("conversational_composer_v1", input.user_id).catch(() => false),
    isEnabled("relationship_memory_v1", input.user_id).catch(() => false),
    isEnabled("advisor_reasoning_v1", input.user_id).catch(() => false),
  ]);

  const evidenceCache = createTurnEvidenceCache();
  const ctx: ContractExecutionContext = {
    sb, input, brainText, memory, groundedReference: groundedTurn.reference,
    semanticResolutionPath, brainOk: brain.telemetry.ok !== false, fromClosedCompiler: !!narrowContract || !!semanticProviderRecovery,
    durableUserContext, session_id, evidenceCache, advisorEnabled,
  };

  const steps: CanonicalConversationTurnContract[] = [contract, ...(brain.additional_contracts ?? [])];
  const executions: TurnExecution[] = [];
  for (const [index, step] of steps.entries()) {
    const stepContract = index === 0 ? step : applyImplicitPeriodToClarification(step, brainText);
    if (index > 0) {
      const groundedStep = groundTurnContract(stepContract, memory);
      if (!groundedStep.ok) {
        executions.push({
          contract: stepContract, reply: groundedStep.clarification ?? "Pode me dizer a que você está se referindo?",
          reply_kind: "question", path: "deterministic_fallback", compose_kind: null, evidence: [],
        });
        break;
      }
      executions.push(await executeContract({ ...ctx, groundedReference: groundedStep.reference }, stepContract));
    } else {
      executions.push(await executeContract(ctx, stepContract));
    }
    // A clarification stops the plan: the remaining steps depend on the answer.
    if (executions[executions.length - 1].reply_kind === "question") break;
  }

  const merged = mergeExecutions(executions);

  // ---- Conversational composition (voice) ---------------------------------
  let composition: ComposeResult | null = null;
  let finalReply = merged.reply;
  const composeKind = merged.compose_kind;
  if (composerEnabled && composeKind && merged.composable_body) {
    composition = await composeConversationalReply({
      kind: composeKind,
      channel: input.channel === "app" ? "app" : input.channel === "simulator" ? "simulator" : "whatsapp",
      user_text: input.text,
      history: history.map((turn: any) => ({ role: turn.role === "user" ? "user" : "assistant", content: String(turn.content ?? "") })),
      relationship_context: durableUserContext,
      deterministic_body: merged.composable_body,
      evidence: merged.evidence,
      allow_offer: suggestionsAllowed(durableUserContext),
      capture_memory: memoryEnabled,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
    }).catch((error) => {
      console.warn("[AgentCoreV2] composer failed", String((error as Error)?.message ?? error).slice(0, 160));
      return null;
    });
    if (composition?.mode === "composed") {
      // Review: the composer writes only the opening; the laid-out body follows.
      const composed = (composeKind === "review" || composeKind === "layout") && merged.layout_tail
        ? `${composition.text}\n\n${merged.layout_tail}`
        : composition.text;
      finalReply = merged.fixed_prefix ? `${merged.fixed_prefix}\n\n${composed}` : composed;
    }
  }

  // ---- Relationship memory -------------------------------------------------
  const todayCivil = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  let rememberedNotes = 0;
  if (memoryEnabled && composition?.notes?.length) {
    for (const note of composition.notes) {
      const saved = await remember(sb, {
        user_id: input.user_id,
        kind: "context",
        key: `life:${note.key}`,
        value: {
          note: note.note,
          topic: note.kind,
          horizon: note.horizon,
          noted_at: todayCivil,
        },
        confidence: 0.8,
        source: "user",
        visibility: "user",
      }).catch(() => null);
      if (saved) rememberedNotes += 1;
    }
  }

  return await finishV2({
    sb, input, contract: merged.contract, reply: finalReply, reply_kind: merged.reply_kind,
    path: merged.path, started_at: started,
    tokens_in: brain.telemetry.tokens_in + (composition?.telemetry.tokens_in ?? 0),
    tokens_out: brain.telemetry.tokens_out + (composition?.telemetry.tokens_out ?? 0),
    llm_calls: Number(brain.telemetry.llm_calls ?? 0) + (composition?.telemetry.llm_calls ?? 0),
    model: brain.telemetry.model, provider: brain.telemetry.provider,
    draft_id: merged.draft_id, result: merged.result, session_id,
    tools: merged.tools, tool_calls: merged.tool_calls,
    error: merged.error ?? null,
    memory, topic_repo: topicRepo, topic_resolution: topicResolution,
    active_period: merged.active_period,
    comparison_period: merged.comparison_period,
    diagnostics: {
      ...(merged.diagnostics ?? {}),
      ...(semanticProviderRecovery ? { semantic_provider_recovery: semanticProviderRecovery } : {}),
      v3_first: v3FirstEnabled,
      plan_steps: executions.map((execution) => ({
        mode: execution.contract.mode,
        domain: execution.contract.domain,
        advisory_kind: execution.contract.advisory_kind ?? null,
        reply_kind: execution.reply_kind,
        error: execution.error ?? null,
      })),
      composition: composition
        ? {
          version: composition.version,
          kind: composeKind,
          mode: composition.mode,
          reason: composition.reason,
          violations: composition.violations.slice(0, 6),
          model: composition.telemetry.model,
          latency_ms: composition.telemetry.latency_ms,
          notes_captured: composition.notes.length,
          notes_saved: rememberedNotes,
        }
        : { enabled: composerEnabled, kind: composeKind },
    },
  });
}

// ---------------------------------------------------------------------------
// Contract execution (one step of a possibly compound turn)
// ---------------------------------------------------------------------------

type ContractExecutionContext = {
  sb: any;
  input: HandleTurnInput;
  brainText: string;
  memory: ConversationMemory | null;
  groundedReference: any;
  semanticResolutionPath: HandleTurnResult["path"];
  brainOk: boolean;
  fromClosedCompiler: boolean;
  durableUserContext: string | null;
  session_id: string | undefined;
  evidenceCache: ReturnType<typeof createTurnEvidenceCache>;
  advisorEnabled: boolean;
};

type ToolCallRecord = { tool_name: string; args?: any; result?: any; ok: boolean };

type TurnExecution = {
  contract: CanonicalConversationTurnContract;
  reply: string;
  reply_kind: HandleTurnResult["reply_kind"];
  path: HandleTurnResult["path"];
  /** null = the text must reach the user verbatim (drafts, receipts, failures). */
  compose_kind: ComposeKind | null;
  evidence: unknown[];
  /** Laid-out body delivered verbatim after the composed opening ("review"). */
  layout_tail?: string | null;
  draft_id?: string;
  result?: unknown;
  tools?: string[];
  tool_calls?: ToolCallRecord[];
  error?: string | null;
  active_period?: { from: string; to: string; label?: string | null } | null;
  comparison_period?: { from: string; to: string } | null;
  diagnostics?: Record<string, unknown> | null;
};

const LEGACY_ADVISORY_FOR: Record<string, "financial_plan" | "next_best_action" | "goal_strategy"> = {
  scenario: "financial_plan",
  decision: "next_best_action",
  goal_projection: "goal_strategy",
};

function mergeExecutions(executions: TurnExecution[]): TurnExecution & {
  composable_body: string | null;
  fixed_prefix: string | null;
} {
  const primary = executions[0];
  if (executions.length === 1) {
    return {
      ...primary,
      composable_body: primary.compose_kind ? primary.reply : null,
      fixed_prefix: null,
    };
  }
  // A laid-out review inside a compound turn is delivered as is; only the
  // single-step review gets a composed opening.
  if (executions.some((execution) => execution.compose_kind === "review" || execution.compose_kind === "layout")) {
    executions = executions.map((execution) => execution.compose_kind === "review" || execution.compose_kind === "layout"
      ? { ...execution, compose_kind: null, layout_tail: null }
      : execution);
  }
  // Writes (drafts/receipts) must reach the user verbatim; the rest is composed
  // as a single conversational answer after the fixed part.
  const fixed = executions.filter((execution) => !execution.compose_kind);
  const composable = executions.filter((execution) => !!execution.compose_kind);
  const reply = executions.map((execution) => execution.reply.trim()).filter(Boolean).join("\n\n");
  const draft = executions.find((execution) => execution.reply_kind === "draft");
  const question = executions.find((execution) => execution.reply_kind === "question");
  const errors = executions.map((execution) => execution.error).filter(Boolean) as string[];
  const lastRead = [...executions].reverse().find((execution) => execution.active_period);
  const composeKind: ComposeKind | null = !composable.length
    ? null
    : composable.every((execution) => execution.compose_kind === "recovery")
      ? "recovery"
      : composable.some((execution) => execution.compose_kind === "decision") ? "decision" : "compound";
  return {
    contract: (lastRead ?? primary).contract,
    reply,
    reply_kind: draft ? "draft" : question ? "question" : primary.reply_kind,
    path: executions.every((execution) => execution.path === "deterministic_tool") ? "deterministic_tool" : primary.path,
    compose_kind: composeKind,
    evidence: composable.flatMap((execution) => execution.evidence),
    draft_id: draft?.draft_id ?? primary.draft_id,
    result: draft?.result ?? primary.result,
    tools: executions.flatMap((execution) => execution.tools ?? []),
    tool_calls: executions.flatMap((execution) => execution.tool_calls ?? []),
    error: errors.length ? errors.join(";").slice(0, 300) : null,
    active_period: lastRead?.active_period ?? primary.active_period ?? null,
    comparison_period: lastRead?.comparison_period ?? primary.comparison_period ?? null,
    diagnostics: Object.assign({}, ...executions.map((execution) => execution.diagnostics ?? {})),
    composable_body: composable.length
      ? composable.map((execution) => execution.reply.trim()).filter(Boolean).join("\n\n")
      : null,
    fixed_prefix: fixed.length
      ? fixed.map((execution) => execution.reply.trim()).filter(Boolean).join("\n\n")
      : null,
  };
}

async function executeContract(
  ctx: ContractExecutionContext,
  contract: CanonicalConversationTurnContract,
): Promise<TurnExecution> {
  const { sb, input, memory, evidenceCache } = ctx;
  const brainText = ctx.brainText;

  if (contract.mode === "converse") {
    // Technical fallbacks and closed-compiler replies (which may carry
    // persisted evidence numbers) are delivered verbatim.
    return {
      contract, reply: contract.direct_reply!, reply_kind: "info", path: ctx.semanticResolutionPath,
      compose_kind: ctx.fromClosedCompiler ? null : ctx.brainOk ? "conversation" : "recovery",
      evidence: [],
    };
  }

  if (contract.mode === "clarify") {
    return {
      contract, reply: contract.clarification_question!, reply_kind: "question",
      path: ctx.semanticResolutionPath, compose_kind: null, evidence: [],
    };
  }

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
      return {
        contract,
        reply: "Entendi o pedido, mas não consegui executá-lo com segurança. Não alterei nada.",
        reply_kind: "info", path: "deterministic_fallback", compose_kind: null, evidence: [],
        error: write.error ?? "conversation_brain_write_unhandled",
      };
    }
    const writeExecuted = Boolean(write.tool_name && write.reply_kind !== "question");
    return {
      contract, reply: write.reply,
      reply_kind: write.reply_kind === "draft" ? "draft" : write.reply_kind === "question" ? "question" : "info",
      path: ctx.semanticResolutionPath, compose_kind: null, evidence: [],
      draft_id: write.draft_id, result: write.tool_result,
      tools: writeExecuted && write.tool_name ? [write.tool_name] : [],
      tool_calls: writeExecuted && write.tool_name ? [{
        tool_name: write.tool_name,
        args: write.tool_args,
        result: write.tool_result,
        ok: !write.error,
      }] : [],
      error: write.error ?? null,
    };
  }

  const canonical = String(contract.canonical_request ?? brainText).trim();

  // Advisor reasoning: scenario / decision / goal projection.
  const runAdvisor = async (target: CanonicalConversationTurnContract): Promise<TurnExecution> => {
    const toolCtx = {
      sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: canonical, evidenceCache,
    } as any;
    const outcome = await executeAdvisorReasoning(target, {
      runTool: async (tool, toolArgs) => {
        const exec = await runTool(toolCtx, tool, toolArgs, { timeoutMs: 12_000, maxRetries: 1 });
        return { ok: exec.ok, result: exec.result, error: exec.error };
      },
      loadCategoryBaseline: async (category, window) => {
        const ids = await resolveCategoryIdsByName(sb, input.user_id, category);
        if (!ids.length) return { category, error: "category_not_found" as const };
        if (ids.length > 1) return { category, error: "category_ambiguous" as const };
        const buckets = await loadMonthlyExpenseBuckets(sb, {
          user_id: input.user_id, from: window.from, to: window.to, category_ids: ids,
        });
        const typical = typicalMonthlyPolicy({ buckets, window, preferred: "mean" });
        return { category, typical_monthly: typical.headline, months_with_data: typical.months_with_data, window };
      },
    }).catch((error) => {
      console.warn("[AgentCoreV2] advisor reasoning failed", String((error as Error)?.message ?? error).slice(0, 160));
      return null;
    });
    if (!outcome) {
      return {
        contract: target, reply: PROTECTED_ENGINE_FAILURE_REPLY, reply_kind: "info", path: "deterministic_fallback",
        compose_kind: null, evidence: [], error: "advisor_reasoning_failed",
      };
    }
    const calls = outcome.tool_calls.map((call) => ({
      tool_name: call.tool_name, args: call.args, result: call.result, ok: call.ok,
    }));
    const asksQuestion = !outcome.ok && /\?\s*$/.test(outcome.reply.trim());
    return {
      contract: target, reply: outcome.reply,
      reply_kind: asksQuestion ? "question" : "info",
      path: "deterministic_tool",
      compose_kind: outcome.ok ? (outcome.kind === "decision" ? "decision" : "advisory") : null,
      evidence: [{ [outcome.kind]: outcome.facts }],
      tools: calls.map((call) => call.tool_name),
      tool_calls: calls,
      error: outcome.ok || asksQuestion ? null : outcome.error,
      diagnostics: { advisor_reasoning: { version: outcome.version, kind: outcome.kind, ok: outcome.ok, error: outcome.error } },
    };
  };
  // Grounded advice over the user's owned evidence, used when a legacy
  // advisory engine cannot answer (instead of the misleading generic failure).
  const groundedAdvice = () => runAdvisor({ ...contract, advisory_kind: "decision", advisory_params: contract.advisory_params ?? null });

  // Period review: "como foi meu mês?" — a laid-out balance, not one number.
  if (contract.domain === "advisory" && contract.advisory_kind === "period_review") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const resolved = resolvePeriodExpressions(normalizePeriodExpressions(contract.focus), canonical).periods[0] ?? null;
    const monthStart = `${today.slice(0, 8)}01`;
    const [year, month] = today.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const period = resolved ? { from: resolved.from, to: resolved.to, label: resolved.label ?? null } : { from: monthStart, to: monthEnd, label: null };
    const toolCtx = {
      sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: canonical, evidenceCache,
    } as any;
    const review = await executePeriodReview({
      period,
      today,
      runTool: async (tool, toolArgs) => {
        const exec = await runTool(toolCtx, tool, toolArgs, { timeoutMs: 12_000, maxRetries: 1 });
        return { ok: exec.ok, result: exec.result, error: exec.error };
      },
    }).catch(() => null);
    const calls = (review?.tool_calls ?? []).map((call) => ({
      tool_name: call.tool_name, args: call.args, result: call.result, ok: call.ok,
    }));
    if (!review?.ok) {
      return {
        contract, reply: review?.reply ?? "Não consegui juntar os números desse período agora. Se quiser, me pergunte uma parte específica, como quanto você gastou ou recebeu.",
        reply_kind: "info", path: "deterministic_fallback", compose_kind: null, evidence: [],
        tools: calls.map((call) => call.tool_name), tool_calls: calls,
        error: review?.error ?? "period_review_failed",
      };
    }
    return {
      contract, reply: review.reply, reply_kind: "info", path: "deterministic_tool",
      compose_kind: "review", layout_tail: review.blocks,
      evidence: [{ period_review: review.facts }],
      tools: calls.map((call) => call.tool_name), tool_calls: calls,
      active_period: { from: period.from, to: period.to, label: period.label ?? null },
      diagnostics: { period_review: { version: review.version, ok: true } },
    };
  }

  // Metas de gasto: analisa o histórico e deixa metas + submetas prontas para
  // confirmar (nada é criado sem o "sim").
  if (contract.domain === "advisory" && contract.advisory_kind === "spending_goal_plan") {
    const toolCtx = {
      sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: canonical, evidenceCache,
    } as any;
    const plan = await executeSpendingGoalAdvice(toolCtx).catch((error) => ({
      ok: false as const,
      reply: "Não consegui analisar seu histórico agora. Nenhuma meta foi criada; tente de novo em instantes.",
      error: String((error as Error)?.message ?? error).slice(0, 160),
    }));
    if (!plan.ok) {
      return {
        contract, reply: plan.reply, reply_kind: /\?\s*$/.test(plan.reply.trim()) ? "question" : "info",
        path: "deterministic_tool", compose_kind: null, evidence: [], error: plan.error,
      };
    }
    return {
      contract, reply: plan.reply, reply_kind: "draft", path: "deterministic_tool", compose_kind: null,
      draft_id: plan.draft_id ?? undefined,
      evidence: [{ spending_goal_plan: plan.facts }],
      tools: ["spending_goal_advice"],
      tool_calls: [{ tool_name: "spending_goal_advice", args: {}, result: plan.facts, ok: true }],
      diagnostics: { spending_goal_plan: { version: String(plan.facts.version ?? ""), ok: true } },
    };
  }

  if (contract.domain === "advisory" && isAdvisorReasoningKind(contract.advisory_kind)) {
    if (ctx.advisorEnabled) return await runAdvisor(contract);
    contract = { ...contract, advisory_kind: LEGACY_ADVISORY_FOR[contract.advisory_kind!] ?? "next_best_action" };
  }

  const advisory = resolveBrainAdvisory(contract);
  if (advisory) {
    const advisoryTurn = await executeDeterministicCapability(sb, {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      user_text: canonical,
      capability: advisory.capability,
      evidenceCache,
    }).catch(() => null);

    const legacyFailed = !advisoryTurn || advisoryTurn.finish === "tool_error"
      || !(advisoryTurn.toolCalls ?? []).some((call: any) => call.ok === true);
    if (legacyFailed && ctx.advisorEnabled) return await groundedAdvice();
    if (advisoryTurn) {
      const toolCalls = advisoryTurn.toolCalls ?? [];
      const asksQuestion = /\?\s*$/.test(String(advisoryTurn.reply ?? "").trim())
        && toolCalls.some((call: any) => call.ok === true);
      const succeeded = advisoryTurn.finish !== "tool_error" && toolCalls.some((call: any) => call.ok === true);
      return {
        contract, reply: advisoryTurn.reply,
        reply_kind: asksQuestion ? "question" : "info",
        path: "deterministic_tool",
        compose_kind: succeeded ? "advisory" : null,
        evidence: toolCalls.filter((call: any) => call.ok === true).map((call: any) => call.result),
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
      };
    }
  }
  if (contract.domain === "advisory" && ctx.advisorEnabled) return await groundedAdvice();

  const plan = buildTurnPlan({ text: canonical, history: [] });
  const comparisonIntent = contract.financial_read?.queries.some((query) => query.operation === "compare") ?? false;
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
  const state = ctx.session_id ? await getState(sb, ctx.session_id).catch(() => null) : null;

  const contractQueryCount = Math.max(
    1,
    Math.min(MAX_IR_QUERIES, contract.financial_read?.queries.length ?? 1),
  );
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
    preservation_enforced: true,
    typical_monthly_enabled: true,
    authoritative_contract: true,
    failure_reply: PROTECTED_ENGINE_FAILURE_REPLY,
  }, {
    compile: async (args) => {
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
      const scopedArgs = applyGroundedReferenceScope(tool, toolArgs, ctx.groundedReference);
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
      // Série por grão (dia/semana/trimestre) com recorte: um motor, um template.
      if (isScopedSeriesGrain(query.grain) && query.time.aspect === "trend") {
        const categoryLabel = query.filters.find((f) => f.field === "category")?.value ?? null;
        const merchantLabel = query.filters.find((f) => f.field === "merchant")?.value ?? null;
        const categoryIds = categoryLabel
          ? await resolveCategoryIdsByName(sb, input.user_id, String(categoryLabel))
          : null;
        if (categoryLabel && (!categoryIds || !categoryIds.length)) return { domain_error: "category_not_found" as const };
        if (categoryLabel && categoryIds && categoryIds.length > 1) return { domain_error: "category_ambiguous" as const };
        if (!query.time.from || !query.time.to) return null;
        // Janela legível por grão (ex.: no máximo ~3 meses dia a dia).
        const window = capSeriesWindow(query.grain, String(query.time.from), String(query.time.to));
        const result = await loadScopedSeries(sb, {
          user_id: input.user_id,
          grain: query.grain,
          from: window.from,
          to: window.to,
          category_ids: categoryIds,
          category_label: categoryLabel ? String(categoryLabel) : null,
          merchant: merchantLabel ? String(merchantLabel) : null,
        });
        return {
          text: scopedSeriesText(result),
          executed_ir: scopedSeriesExecutedIR(query, result),
          engine: SCOPED_SERIES_ENGINE,
          result,
        };
      }
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
    return {
      contract, reply: PROTECTED_ENGINE_FAILURE_REPLY, reply_kind: "info", path: "deterministic_fallback",
      compose_kind: "recovery", evidence: [], error: "authoritative_semantic_pipeline_failed",
    };
  }
  if (ctx.session_id) {
    await patchState(sb, ctx.session_id, { semantic_topic_state: semantic.topic_state }).catch(() => undefined);
  }

  const financialReadContract = semantic.ir_v3
    ? buildFinancialReadContract({
      turn: contract,
      requested: semantic.ir_v3,
      grounded_reference: ctx.groundedReference,
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
  if (replyKind === "info" && !fulfillmentBlocked && suggestionsAllowed(ctx.durableUserContext)) {
    const suggestion = suggestionForSemantic(semantic);
    if (suggestion && !detectContinuationOffer(reply)) reply = `${reply}\n\n${suggestion}`;
  }

  const semanticContractFailed = semantic.telemetry?.executed_by === "contract_failed_closed";
  const semanticUnsupported = semantic.status === "unsupported" && !semantic.turn;
  const successfulSemanticExecution = (semantic.turn?.toolCalls ?? []).some((call) => call?.ok === true);
  const toolCalls = (semantic.turn?.toolCalls ?? []).map((call: any) => ({
    tool_name: String(call.tool_name ?? "semantic_engine"),
    args: call.args,
    result: call.result,
    ok: call.ok === true,
  }));

  // "Onde mais gastei?": o ranking ganha leitura de assessor (peso de cada
  // categoria, compromisso escolhido, reembolso que voltou, teto estourado).
  const extraEvidence: unknown[] = [];
  const rankingCall = successfulSemanticExecution && !fulfillmentBlocked && toolCalls.length === 1
    ? toolCalls.find((call) => call.ok && call.tool_name === "analyze_spending")
    : null;
  const ranking = rankingCall?.result as any;
  if (ranking && ranking.metric === "expense" && ranking.group_by === "category"
    && ["rank", "breakdown"].includes(String(ranking.view)) && !ranking.filters?.category
    && (ranking.categories?.length ?? 0) >= 2) {
    const reading = await executeCategoryReading({
      spending: ranking,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
      runTool: async (tool, toolArgs) => {
        const exec = await runTool({
          sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: canonical, evidenceCache,
        } as any, tool, toolArgs, { timeoutMs: 8_000, maxRetries: 0 });
        return { ok: exec.ok, result: exec.result, error: exec.error };
      },
    }).catch(() => null);
    if (reading) {
      reply = reading.body;
      extraEvidence.push({ category_reading: reading.facts });
    }
  }

  // Série (mês a mês, dia a dia) e ranking com leitura: o conteúdo diagramado
  // vai inteiro; a voz escreve só a abertura. Antes o compositor resumia a
  // série e a lista de meses sumia ("quero mês a mês" pedido de novo).
  const SERIES_ENGINES = new Set(["spending_timeseries_monthly", SCOPED_SERIES_ENGINE]);
  const laidOut = replyKind === "info" && !fulfillmentBlocked && successfulSemanticExecution && !!semantic.turn
    && (extraEvidence.length > 0 || (toolCalls.length === 1 && SERIES_ENGINES.has(toolCalls[0].tool_name)));
  return {
    contract, reply, reply_kind: replyKind,
    path: ctx.semanticResolutionPath,
    layout_tail: laidOut ? reply : null,
    compose_kind: laidOut
      ? "layout"
      : replyKind === "info" && !fulfillmentBlocked && successfulSemanticExecution && !!semantic.turn
      ? "answer"
      // Honest failure (blocked, unsupported, no data): keep it honest but
      // human, answering the conversational part without any amount.
      : replyKind === "info" && (fulfillmentBlocked || !successfulSemanticExecution)
        ? "recovery"
        : null,
    evidence: [...toolCalls.filter((call) => call.ok).map((call) => call.result), ...extraEvidence],
    tools: semantic.engines,
    tool_calls: toolCalls,
    error: fulfillmentBlocked
      ? `contract_fulfillment_blocked:${fulfillment!.violations.map((v) => v.code).join(",")}`.slice(0, 300)
      : semanticContractFailed
        ? `semantic_contract_failed_closed:${semantic.status}`.slice(0, 300)
      : semanticUnsupported
        ? `semantic_unsupported:${semantic.validation?.errors.join(",") || "no_engine"}`.slice(0, 300)
      : semantic.turn ? null : (semantic.errors.length ? semantic.errors.join(";").slice(0, 300) : null),
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
  };
}
