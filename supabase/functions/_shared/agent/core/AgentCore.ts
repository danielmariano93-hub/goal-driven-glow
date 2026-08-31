// AgentCore.handleTurn — single entry point shared by App and WhatsApp.
//
// Fase 2 pipeline:
//   SessionManager → IntentRouter → PolicyEngine
//                → ActionPlanner (LLM loop OR deterministic fallback)
//                → ResponseValidator
//                → Persistence + DecisionLogger + Observability
//
// External behaviour matches Fase 1: reply text, reply_kind, draft_id and
// outbound queueing are all preserved. New signals (DecisionLogger,
// Observability) are additive and best-effort.
// deno-lint-ignore-file no-explicit-any
import { service } from "./service.ts";
import { loadActivePrompt, blocksForTools, composeSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../prompt.ts";
import { createTurnContext } from "./ContextPipeline.ts";
import { resolveSession, type Channel } from "./SessionManager.ts";
import { routeIntent } from "./IntentRouter.ts";
import { evaluate as evaluatePolicy, decideTurn } from "./PolicyEngine.ts";
import { plan as planAction } from "./ActionPlanner.ts";
import { deterministicFallback } from "./DeterministicFallback.ts";
import type { TextProvenance } from "./TextProvenance.ts";

import { validate, validateReply, FRIENDLY_ORCHESTRATOR_ERROR } from "./ResponseValidator.ts";
import { personalizeSystemPrompt } from "./ResponseGenerator.ts";
import { enqueueReply } from "./OutboundQueue.ts";
import { createMetrics, estimateCost, timeStage, summarize, recordArtifact, recordFormulaVersion } from "./Observability.ts";
import { buildRecord, logDecision } from "./DecisionLogger.ts";
import { guard } from "./ErrorRecovery.ts";
import { learnFromTurn } from "./LearningLoop.ts";
import { learnAdvisorInterest } from "./AdvisorInteractionLearning.ts";
import { resolveAdvisorTopicKey } from "../../finance-core/advisorTopics.ts";
import { isLLMConfigured } from "../llm.ts";
import { detectFastLog, loadFastLogToken, runFastLog } from "./FastLog.ts";
import { tryBulkDraft, findBulkPending, executeBulkPending } from "./BulkEntry.ts";

import { buildChannelEnvelope } from "../../intelligence/channelEnvelope.ts";
import { asEvidence } from "../../intelligence/evidence.ts";
import { ensureRequestedArtifact } from "../../intelligence/chartFallback.ts";
import { hasExplicitChartIntent } from "../../intelligence/chartIntent.ts";
import { interpretSemanticQuery } from "../../intelligence/semanticQuery.ts";
import { capabilityPrompt, classifyCapability, resumeDeterministicCapability } from "./CapabilityRouter.ts";
import { withoutCurrentTurn } from "./ConversationHistory.ts";
import { entryFailureMessage } from "./ResponseValidator.ts";
import { humanizeReply } from "./ReplyHumanizer.ts";
import { buildTurnPlan, turnPlanPrompt } from "./ConversationOrchestrator.ts";
import { validateAgainstEvidence } from "./TruthValidator.ts";
import { executeDeterministicCapability } from "./DeterministicAnswers.ts";
import { executeComposite } from "./CompositeExecutor.ts";
import { runCompositeAnalysis } from "./CompositeAnalysis.ts";
import {
  classifyConversational, deterministicConversationalReply, generateConversationalReply,
} from "./Conversational.ts";
import {
  applyMemoryToText, detectCategory, loadConversationMemory, saveConversationMemory,
} from "./ConversationMemory.ts";
import { findPending } from "./PendingConfirmations.ts";
import {
  assignCategoryToEntry, findRecentUncategorized, readCategoryAnswer,
} from "./PendingAction.ts";
import { sanitizeUserFacingText, USER_SAFE_MESSAGES } from "./UserSafeError.ts";
import { detectContinuationOffer, resolveContinuation } from "./ContinuationContract.ts";
import { buildGoalPlan, planToSteps } from "./GoalPlanner.ts";
import { confirmAndBuildReceipt } from "./ConfirmAndReceipt.ts";
import {
  serializeWithinBudget, estimateTokens, measureLayers, fitWorkingMemory, LAYER_BUDGET_CHARS,
} from "./ContextBudget.ts";
import { isEnabled } from "./FeatureFlags.ts";
import { scopeFromToolCalls } from "./ScopeCarryover.ts";
import {
  reconcileEvidence, replyUsesRejectedEvidence, EVIDENCE_CONFLICT_REPLY,
} from "./EvidenceReconciliation.ts";


import { allowsEntryDraft, hasEntryIntent } from "./HypotheticalGuard.ts";
import {
  askForCategory, mentionsAnaphoricCategory, mentionsGoalAnchor, resolveGoalCategoryScope,
} from "./MerchantScope.ts";
import {
  detectExpectation, expectationFromHistory, isExpectationFresh,
} from "./ConversationExpectation.ts";
import { parseEmotionFromText } from "../../intelligence/emotionParse.ts";


/** Cartão de rascunho de lançamento na última fala do Nino. */
const DRAFT_CARD_RX =
  /(?:•\s*\*?(?:Despesa|Receita|Transfer[êe]ncia)\*?:)|(?:deixa eu confirmar antes de salvar)|(?:pode salvar\?)|(?:rascunhei aqui)|(?:fecho assim\?)|(?:confere pra mim)/i;

/** Pergunta de SLOT de lançamento feita pelo próprio Nino no turno anterior. */
const ENTRY_SLOT_QUESTION_RX =
  /(em qual conta eu registro)|(em qual cart[ãa]o eu registro)|(em qu[êe] foi (?:esse|essa))|(faltou a descri[çc][ãa]o)|(qual (?:foi )?o valor)|(qual categoria)/i;


/** Resposta curta a uma pergunta do Nino, sem assunto financeiro próprio. */
function moodFromShortAnswer(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/\b(gast|fatura|cart[aã]o|saldo|d[ií]vida|meta|receita|sal[aá]rio|parcela|conta|R\$|\d)/i.test(t)) return false;
  return t.split(/\s+/).length <= 4;
}



export type HandleTurnInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  channel: Channel;
  to_phone?: string;
  /** Contexto de resposta citada no WhatsApp (`nino_context.v1`). */
  reply_context?: {
    quoted_message_id?: string | null;
    /** Valor citado no recibo respondido — desambigua qual lançamento é. */
    amount_hint?: number | null;
  } | null;
};

export type HandleTurnResult = {
  reply: string;
  reply_kind: "receipt" | "draft" | "question" | "info" | "cancelled" | "expired";
  path: "llm" | "deterministic_tool" | "deterministic_fallback";
  draft_id?: string;
  run_id?: string;
  result?: unknown;
  session_id?: string;
  envelope?: ReturnType<typeof buildChannelEnvelope>;
};

/** Entrada pública: roda o turno e passa a resposta pelo humanizador, que é a
 *  única camada autorizada a tocar no texto final (remove nomes internos). */
export async function handleTurn(input: HandleTurnInput): Promise<HandleTurnResult> {
  const result = await runTurn(input);
  // Guarda de saída única: humaniza e, se algo tentou vazar infraestrutura
  // (créditos, provedor, status HTTP), substitui por texto neutro.
  return { ...result, reply: sanitizeUserFacingText(humanizeReply(result.reply)) };
}

async function runTurn(input: HandleTurnInput): Promise<HandleTurnResult> {
  const sb = service();
  const metrics = createMetrics(input.channel);
  const t0 = Date.now();

  // Dedupe by inbound_message_id (WhatsApp retries hit here first)
  if (input.channel !== "app") {
    const { data: existing } = await sb.from("outbound_messages")
      .select("body").eq("inbound_message_id", input.inbound_message_id).maybeSingle();
    if (existing) {
      return { reply: existing.body as string, reply_kind: "info", path: "deterministic_fallback" };
    }
  }

  const idem = `run:${input.inbound_message_id}`;

  // ---- SessionManager (best-effort) --------------------------------------
  const session_id = await timeStage(metrics, "session", async () => {
    return await guard(async () => {
      const s = await resolveSession(sb, {
        user_id: input.user_id, channel: input.channel, conversation_id: input.conversation_id,
      });
      return s.id as string | undefined;
    }, (msg) => metrics.errors.push("session:" + msg), undefined);
  });

  const tctx = createTurnContext({ sb, user_id: input.user_id, conversation_id: input.conversation_id, session_id: session_id ?? null });

  // ---- CONTINUIDADE (`nino_continuation.v1`) ------------------------------
  // O Nino ofereceu uma análise ("quer comparar…? me dá o ok") e o usuário
  // respondeu "Ok". Antes isso caía no PolicyEngine e virava "não encontrei
  // nada pendente". Agora o "ok" é reescrito na operação que ELE ofereceu,
  // salvo quando existe escrita financeira pendente (essa tem precedência).
  const continuationMemory = await guard(
    () => loadConversationMemory(sb, session_id ?? null),
    (m) => metrics.errors.push("continuation_memory:" + m),
    null,
  );
  // Aceite de continuação também é sinal de interesse pelo tópico (advisor).
  let continuationAccepted = false;
  if (continuationMemory?.pending_conversation_action) {
    const hasPendingWrite = !!(await guard(
      () => findPending(sb, input.conversation_id, input.user_id),
      (m) => metrics.errors.push("continuation_pending:" + m),
      null,
    ));
    const cont = resolveContinuation({
      text: input.text,
      action: continuationMemory.pending_conversation_action,
      hasPendingWrite,
    });
    if (cont.continue && cont.prompt) {
      input = { ...input, text: cont.prompt };
      continuationAccepted = true;
      await guard(
        () => saveConversationMemory(sb, session_id ?? null, { pending_conversation_action: null }),
        (m) => metrics.errors.push("continuation_clear:" + m),
        null,
      );
    }
  }

  // ---- PENDING ACTION (`nino_context.v1`) ---------------------------------
  // O Nino acabou de registrar um lançamento sem categoria. A próxima mensagem
  // curta ("Beleza") é a CATEGORIA — não um acknowledgement nem assunto novo.
  // Também cobre o pedido explícito ("cria a categoria beleza e categoriza").
  // 100% determinístico: nenhuma chamada de modelo.
  {
    const pendingWrite = await guard(
      () => findPending(sb, input.conversation_id, input.user_id),
      (m) => metrics.errors.push("pending_action_write:" + m),
      null,
    );
    // Rascunho aguardando confirmação tem precedência absoluta.
    if (!pendingWrite) {
      const entry = await guard(
        () => findRecentUncategorized(sb, input.user_id, {
          amountHint: input.reply_context?.amount_hint ?? null,
        }),
        (m) => metrics.errors.push("pending_action_entry:" + m),
        null,
      );
      const answer = readCategoryAnswer(input.text, !!entry);
      if (answer && entry) {
        const outcome = await assignCategoryToEntry(sb, {
          user_id: input.user_id, conversation_id: input.conversation_id,
          entry, answer, user_text: input.text,
        });
        if (outcome.handled) {
          metrics.path = "deterministic_tool" as any;
          metrics.capability = "assign_category";
          if (input.channel !== "app" && input.to_phone) {
            await enqueueReply(sb, {
              user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone,
              body: outcome.reply, idempotency_key: idem,
              inbound_message_id: input.inbound_message_id,
              source: input.channel === "simulator" ? "simulator" : "whatsapp",
            });
          }
          metrics.stages.total = Date.now() - t0;
          await logDecision(sb, buildRecord({
            run_id: null, user_id: input.user_id, conversation_id: input.conversation_id,
            channel: input.channel, intent: "assign_category",
            policy_decision: outcome.reply_kind, metrics, validations: [],
          }));
          return {
            reply: outcome.reply,
            reply_kind: outcome.reply_kind === "receipt" ? "receipt"
              : outcome.reply_kind === "question" ? "question" : "info",
            path: "deterministic_tool", session_id,
          };
        }
      }
    }
  }




  // ---- FastLog (palavra-mágica: registra sem confirmação) ---------------
  const fastLogToken = await loadFastLogToken(sb, input.user_id);
  const fastLog = detectFastLog(input.text, fastLogToken);
  if (fastLog.triggered) {
    let run_id_fl: string | undefined;
    await guard(async () => {
      const { data: run, error } = await sb.from("agent_runs").insert({
        user_id: input.user_id, conversation_id: input.conversation_id,
        prompt_version_id: null, model: "fast_log", status: "running",
        started_at: new Date().toISOString(),
      }).select("id").maybeSingle();
      if (error) throw error;
      run_id_fl = (run as any)?.id as string | undefined;
    }, (m) => metrics.errors.push("runs_insert:" + m), null);
    const started = Date.now();
    let outcome: Awaited<ReturnType<typeof runFastLog>> = { handled: true, reply: "", reply_kind: "info", tool_calls: [] };
    let fastLogError: string | null = null;
    try {
      outcome = await runFastLog(sb, {
        user_id: input.user_id, conversation_id: input.conversation_id, cleanText: fastLog.cleanText,
      });
    } catch (e) {
      fastLogError = String((e as Error).message ?? "fast_log_error").slice(0, 200);
      metrics.errors.push("fast_log:" + fastLogError);
      outcome = { handled: true, reply: "Não consegui registrar direto agora. Tenta de novo em instantes.", reply_kind: "info", tool_calls: [] };
    }
    metrics.path = "fast_log" as any;
    metrics.tool_call_count = outcome.tool_calls?.length ?? 0;
    for (const c of outcome.tool_calls ?? []) metrics.tools.push({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok });
    const body = outcome.reply ?? "";
    const kind: HandleTurnResult["reply_kind"] = outcome.reply_kind === "receipt" ? "receipt"
      : outcome.reply_kind === "question" ? "question" : "info";
    if (run_id_fl) {
      // Sempre encerra o run (try/finally garante que status='running' não fica órfão).
      await guard(async () => {
        const { error: runError } = await sb.from("agent_runs").update({
          status: fastLogError ? "error" : "done",
          ended_at: new Date().toISOString(),
          path: "fast_log", steps: outcome.tool_calls?.length ?? 0,
          latency_ms: Date.now() - started,
          error_sanitized: fastLogError, error_masked: fastLogError,
        }).eq("id", run_id_fl);
        if (runError) throw runError;
        if ((outcome.tool_calls?.length ?? 0) > 0) {
          const { error: callsError } = await sb.from("agent_tool_calls").insert(outcome.tool_calls!.map(c => ({
            run_id: run_id_fl, step_index: c.step_index, tool_name: c.tool_name,
            args: c.args ?? {}, result: c.result ?? null,
            ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
          })));
          if (callsError) throw callsError;
        }
      }, (m) => metrics.errors.push("persist_fast:" + m), null);
    }

    if (input.channel !== "app" && input.to_phone) {
      await enqueueReply(sb, {
        user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone, body,
        idempotency_key: idem, inbound_message_id: input.inbound_message_id,
        source: input.channel === "simulator" ? "simulator" : "whatsapp",
      });
    }
    metrics.stages.total = Date.now() - t0;
    return { reply: body, reply_kind: kind, path: "deterministic_fallback", draft_id: outcome.draft_id, run_id: run_id_fl, session_id };
  }

  // ---- Registro em lote (lista/fatura colada) ----------------------------
  // Precisa vir antes do IntentRouter: a confirmação de um lote é executada
  // em TypeScript (a RPC agent_execute_confirmation só conhece kinds simples).
  const routed = await timeStage(metrics, "intent", async () => routeIntent(input.text));
  let capability = classifyCapability(input.text, routed.intent, interpretSemanticQuery(input.text));
  metrics.capability = capability.name;
  metrics.tool_scope = [...capability.allowed_tools];

  if (routed.intent.kind === "confirm" || routed.intent.kind === "cancel") {
    const bulkPending = await guard(
      () => findBulkPending(sb, input.conversation_id, input.user_id),
      (m) => metrics.errors.push("bulk_lookup:" + m), null,
    );
    if (bulkPending) {
      let body: string;
      if (routed.intent.kind === "cancel") {
        await sb.from("pending_confirmations").update({ status: "cancelled" } as any).eq("id", bulkPending.id);
        body = "Combinado, descartei essa lista de lançamentos.";
      } else {
        const exec = await executeBulkPending(sb, bulkPending);
        body = exec.reply;
      }
      if (input.channel !== "app" && input.to_phone) {
        await enqueueReply(sb, {
          user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone, body,
          idempotency_key: idem, inbound_message_id: input.inbound_message_id,
          source: input.channel === "simulator" ? "simulator" : "whatsapp",
        });
      }
      metrics.stages.total = Date.now() - t0;
      return { reply: body, reply_kind: routed.intent.kind === "cancel" ? "cancelled" : "receipt", path: "deterministic_fallback", session_id };
    }
  } else {
    const bulk = await guard(
      () => tryBulkDraft(sb, {
        user_id: input.user_id,
        conversation_id: input.conversation_id,
        text: input.text,
        source: input.channel === "app" ? "app" : "whatsapp",
      }),
      (m) => metrics.errors.push("bulk_draft:" + m), null,
    );
    if (bulk) {
      if (input.channel !== "app" && input.to_phone) {
        await enqueueReply(sb, {
          user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone, body: bulk.reply,
          idempotency_key: idem, inbound_message_id: input.inbound_message_id,
          source: input.channel === "simulator" ? "simulator" : "whatsapp",
        });
      }
      metrics.stages.total = Date.now() - t0;
      return { reply: bulk.reply, reply_kind: "draft", path: "deterministic_fallback", draft_id: bulk.pending_id ?? undefined, session_id };
    }
  }


  // ---- PolicyEngine (confirm/cancel interception) -------------------------
  const policyReply = await timeStage(metrics, "policy", async () => {
    return await evaluatePolicy(sb, {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      inbound_message_id: input.inbound_message_id,
      intent: routed.intent,
    });
  });

  if (policyReply.kind === "reply") {
    metrics.path = "policy";
    // Auto-recuperação: usuário confirmou mas o LLM anterior alucinou o
    // rascunho (nunca chamou create_transaction_draft). Tenta remontar a
    // partir das últimas mensagens do próprio usuário na conversa.
    if (routed.intent.kind === "confirm" && policyReply.replyKind === "info") {
      const recovered = await guard(async () => {
        const hist = await (await import("./ConversationHistory.ts")).loadHistory(
          sb, input.conversation_id, { limit: 12, excludeMessageId: null });
        const lastAssistant = [...hist].reverse().find(h => h.role !== "user");
        const assistantAskedForEntry = DRAFT_CARD_RX.test(String(lastAssistant?.content ?? ""));
        const userTexts = hist.filter(h => h.role === "user")
          .map(h => String(h.content ?? "").trim()).filter(Boolean);
        const lastUserBefore = userTexts[userTexts.length - 1] ?? "";
        // Trava dura: só remonta rascunho quando o contexto imediato É de
        // lançamento. "Sim" respondendo a pergunta analítica nunca cria despesa.
        if (!assistantAskedForEntry && !hasEntryIntent(lastUserBefore)) {
          metrics.errors.push("confirm_recover:skipped_non_entry_context");
          return null;
        }
        const candidates = userTexts.slice(-4)
          .filter(t => hasEntryIntent(t) && allowsEntryDraft(t) && !/\?\s*$/.test(t));
        // Do mais recente ao mais antigo, sempre mensagem isolada (nunca
        // concatenada): concatenar misturava consultoria com confirmação.
        for (const candidate of [...candidates].reverse()) {
          const fb = await deterministicFallback(sb, { ...input, text: candidate });
          if (fb.kind === "draft") return fb;
        }
        return null;
      }, (m) => metrics.errors.push("confirm_recover:" + m), null as any);
      if (recovered && recovered.kind === "draft") {
        metrics.fallback_used = true;
        // O usuário JÁ confirmou: executa o rascunho reconstruído no mesmo turno.
        let finalReply = recovered.reply;
        let finalKind: "draft" | "receipt" = "draft";
        const executed = await guard(async () => {
          const pending = await findPending(sb, input.conversation_id, input.user_id);
          if (!pending) return null;
          const outcome = await confirmAndBuildReceipt(sb, pending, {
            source_message_id: input.inbound_message_id ?? null,
          });
          return { pending, outcome };
        }, (m) => metrics.errors.push("confirm_recover_exec:" + m), null as any);
        if (executed) {
          const { outcome } = executed as any;
          // Recibo só existe com prova de leitura pós-escrita.
          if (outcome.ok && outcome.proven) {
            finalReply = outcome.reply;
            finalKind = "receipt";
          } else {
            metrics.errors.push("confirm_recover_unproven:" + String(outcome.error ?? "unknown"));
            finalReply = outcome.reply;
          }
        }
        if (input.channel !== "app" && input.to_phone) {
          await enqueueReply(sb, {
            user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone,
            body: finalReply, idempotency_key: idem, inbound_message_id: input.inbound_message_id,
            source: input.channel === "simulator" ? "simulator" : "whatsapp",
          });
        }
        return {
          reply: finalReply, reply_kind: finalKind, path: "deterministic_fallback",
          draft_id: recovered.draft_id, session_id,
        };
      }
    }

    const v = validate(policyReply.body, { expectedKind: policyReply.replyKind, hasDraft: !!policyReply.draft_id });
    metrics.validations = v.reasons.length;
    const body = v.body;
    if (input.channel !== "app" && input.to_phone) {
      await enqueueReply(sb, {
        user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone, body,
        idempotency_key: idem, inbound_message_id: input.inbound_message_id,
        source: input.channel === "simulator" ? "simulator" : "whatsapp",
      });
    }
    metrics.stages.total = Date.now() - t0;
    await logDecision(sb, buildRecord({
      run_id: null, user_id: input.user_id, conversation_id: input.conversation_id,
      channel: input.channel, intent: routed.intent.kind,
      policy_decision: policyReply.replyKind, metrics,
      validations: v.reasons,
    }));
    return {
      reply: body, reply_kind: policyReply.replyKind, path: "deterministic_fallback",
      draft_id: policyReply.draft_id, result: policyReply.result, session_id,
    };
  }

  // ---- EXPECTATIVA — o Nino lembra o que ele perguntou -------------------
  // Se a última fala do Nino foi uma pergunta que espera resposta (lembrete de
  // humor, slot de lançamento), a mensagem atual é lida como resposta a ela.
  const expectationHistory = await guard(
    () => tctx.history(4, input.channel === "app" ? input.inbound_message_id : null),
    (m) => metrics.errors.push("expectation_history:" + m),
    [] as Array<{ role: string; content: string }>,
  );
  const expectation = expectationFromHistory(expectationHistory ?? []);
  const emotionalAnswerExpected = expectation?.kind === "emotional_checkin"
    && !!(parseEmotionFromText(input.text) || String(input.text ?? "").trim().split(/\s+/).length <= 6);

  // ---- CONVERSAR — rota casual (sem motor financeiro) ---------------------
  // "o que você é?", "bom dia", "obrigado", "qual a capital da França": não há
  // número, período nem motor. Responde com persona + identidade canônica, em
  // um único passo, sem tocar no pipeline analítico.
  const conversational = classifyConversational(input.text);
  if (conversational.kind && !emotionalAnswerExpected && !(await tctx.pending())) {

    const firstName = await guard(async () => {
      const { data } = await sb.from("profiles").select("full_name").eq("id", input.user_id).maybeSingle();
      const full = String((data as any)?.full_name ?? "").trim();
      return full ? full.split(/\s+/)[0] : null;
    }, (m) => metrics.errors.push("conv_profile:" + m), null);

    const hourSP = Number(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
    let convReply = conversational.deterministic
      ? deterministicConversationalReply(conversational.kind, { first_name: firstName, hour: hourSP })
      : null;
    if (!convReply) {
      const convHistory = await tctx.history(6, input.channel === "app" ? input.inbound_message_id : null)
        .catch(() => [] as Array<{ role: string; content: string }>);
      convReply = await generateConversationalReply({
        text: input.text, history: convHistory as any, first_name: firstName,
      });
    }

    if (convReply) {
      metrics.path = "conversational";
      metrics.capability = "conversational";
      if (input.channel !== "app" && input.to_phone) {
        await enqueueReply(sb, {
          user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone,
          body: convReply, idempotency_key: idem, inbound_message_id: input.inbound_message_id,
          source: input.channel === "simulator" ? "simulator" : "whatsapp",
        });
      }
      metrics.stages.total = Date.now() - t0;
      await logDecision(sb, buildRecord({
        run_id: null, user_id: input.user_id, conversation_id: input.conversation_id,
        channel: input.channel, intent: `conversational:${conversational.kind}`,
        policy_decision: "info", metrics, validations: [],
      }));
      return { reply: convReply, reply_kind: "info", path: "deterministic_fallback", session_id };
    }
  }


  // Extra decision (for observability + telemetry)
  const decision = decideTurn(routed.intent, {
    hasPendingConfirmation: !!(await tctx.pending()),
    llmConfigured: isLLMConfigured(),
    hasPromptVersion: false, // filled after prompt load
    lastIntent: null,
  });

  // ---- Prompt + agent_runs row -------------------------------------------
  const startedAt = Date.now();
  const prompt = await guard(() => loadActivePrompt(sb),
    (m) => metrics.errors.push("prompt:" + m), null as any);

  let run_id: string | undefined;
  await guard(async () => {
    const { data: run, error } = await sb.from("agent_runs").insert({
      user_id: input.user_id, conversation_id: input.conversation_id,
      prompt_version_id: prompt?.id ?? null, model: prompt?.model ?? "unknown",
      status: "running", started_at: new Date().toISOString(),
      capability: capability.name,
      tool_scope: capability.allowed_tools,
      model_attempts: [],
    }).select("id").maybeSingle();
    if (error) throw error;
    run_id = (run as any)?.id as string | undefined;
  }, (m) => metrics.errors.push("runs_insert:" + m), null);

  const loadedHistory = await tctx.history(12, input.channel === "app" ? input.inbound_message_id : null);
  // No WhatsApp a mensagem já foi persistida antes de entrar no AgentCore. O
  // runtime acrescenta `user_text` ao prompt depois; retire a cópia mais recente
  // para não duplicar o mesmo turno e distorcer a conversa.
  const history = withoutCurrentTurn(loadedHistory, input.text);
  const previousUserText = [...history].reverse().find((entry) =>
    entry.role === "user" && String(entry.content ?? "").trim() !== String(input.text ?? "").trim()
  )?.content;
  capability = resumeDeterministicCapability(input.text, routed.intent, previousUserText) ?? capability;

  // COMPREENDER — plano determinístico do turno (assunto herdado, período
  // resolvido em pt-BR e sub-perguntas). Se a mensagem atual é só complemento
  // ("e em agosto?"), o roteamento passa a ver o assunto completo.
  // Memória conversacional persistente: tópico/período ativos sobrevivem entre
  // mensagens (TTL de 6h) e só entram quando a mensagem atual não traz assunto.
  const memory = await guard(
    () => loadConversationMemory(sb, session_id ?? null),
    (m) => metrics.errors.push("conv_memory:" + m),
    null,
  );
  const turnPlan = buildTurnPlan({ text: input.text, history });
  // Rota determinística da mensagem CRUA é soberana: nenhuma herança de
  // assunto pode transformar "estou me sentindo atento" em pergunta de gasto.
  const rawDeterministic = capability.execution === "deterministic" && !!capability.required_tool;
  const memoryText = rawDeterministic
    ? { text: input.text, used: false }
    : applyMemoryToText(input.text, memory, { followup: turnPlan.followup });
  if (memoryText.used) {
    turnPlan.effective_text = `${turnPlan.effective_text} (assunto: ${memory?.active_category ?? memory?.current_topic})`;
    turnPlan.followup = true;
  }
  if ((turnPlan.followup || turnPlan.composed) && !rawDeterministic) {
    capability = classifyCapability(
      turnPlan.effective_text,
      routeIntent(turnPlan.effective_text).intent,
      interpretSemanticQuery(turnPlan.effective_text),
    );
  }
  if (rawDeterministic) turnPlan.effective_text = input.text;

  // Expectativa emocional pendente força a rota determinística de check-in:
  // "cansado", "atento", "😌" ou "nota 4" são resposta, não assunto novo.
  const awaiting = expectation
    ?? (isExpectationFresh(memory?.awaiting) ? memory?.awaiting ?? null : null);
  if (awaiting?.kind === "emotional_checkin"
    && capability.name !== "emotional_checkin"
    && capability.name !== "emotion_finance"
    && (parseEmotionFromText(input.text) || moodFromShortAnswer(input.text))) {
    capability = {
      ...capability,
      name: "emotional_checkin",
      execution: "deterministic",
      allowed_tools: ["log_emotional_checkin", "get_emotional_checkins"],
      required_tool: "log_emotional_checkin",
      tool_args: {},
      context: {} as typeof capability.context,
      clarification: null,
      reason: "expectation_emotional_checkin",
    };
    turnPlan.effective_text = input.text;
    turnPlan.followup = false;
  }


  // Pergunta composta não é só detectada: ela é EXECUTADA. Roteamos cada
  // sub-pergunta, unimos o escopo de ferramentas e exigimos que todas as
  // ferramentas canônicas envolvidas sejam chamadas no mesmo turno.
  let mandatoryTools: string[] = [];
  if (turnPlan.composed) {
    const subCapabilities = turnPlan.tasks.map((task) =>
      classifyCapability(task, routeIntent(task).intent, interpretSemanticQuery(task))
    );
    const distinct = [...new Set(subCapabilities.map((c) => c.name))];
    if (distinct.length > 1) {
      const tools = new Set<string>(capability.allowed_tools);
      const context: Record<string, boolean> = { ...(capability.context as Record<string, boolean>) };
      for (const sub of subCapabilities) {
        for (const tool of sub.allowed_tools) tools.add(tool);
        for (const [k, v] of Object.entries(sub.context)) if (v) context[k] = true;
        if (sub.required_tool) mandatoryTools.push(sub.required_tool);
      }
      mandatoryTools = [...new Set(mandatoryTools)];
      capability = {
        ...capability,
        name: capability.name,
        execution: "llm_scoped",
        allowed_tools: [...tools],
        required_tool: null,
        context: context as typeof capability.context,
        reason: `composed_multi_capability:${distinct.join("+")}`,
      };
    }
  }
  // Distribuição por estabelecimento precisa de categoria e período explícitos.
  // Cascata determinística de escopo: texto → memória da conversa → meta com
  // teto ultrapassado (fonte oficial de metas) → último resultado do turno
  // anterior. Sem escopo e com referência anafórica, o Nino PERGUNTA — nunca
  // responde o total de todas as categorias como se fosse de uma categoria.
  if (capability.name === "merchant_distribution") {
    const args: Record<string, unknown> = { ...(capability.tool_args ?? {}) };
    if (!args.category_name) {
      const inherited = detectCategory(turnPlan.effective_text) ?? memory?.active_category ?? null;
      if (inherited) args.category_name = inherited;
    }
    let goalScope: Awaited<ReturnType<typeof resolveGoalCategoryScope>> = null;
    if (!args.category_name
      && (mentionsAnaphoricCategory(turnPlan.effective_text) || mentionsGoalAnchor(turnPlan.effective_text))) {
      goalScope = await guard(
        () => resolveGoalCategoryScope(sb, input.user_id),
        (m) => metrics.errors.push("goal_scope:" + m),
        null,
      );
      if (goalScope) {
        args.category_name = goalScope.category_name;
        if (goalScope.category_id) args.category_id = goalScope.category_id;
        if (goalScope.period) { args.from = goalScope.period.from; args.to = goalScope.period.to; }
      }
    }
    if (!args.from && !args.days) {
      args.from = turnPlan.effective_period.from;
      args.to = turnPlan.effective_period.to;
    }
    const needsCategory = mentionsAnaphoricCategory(turnPlan.effective_text);
    capability = {
      ...capability,
      tool_args: args,
      required_tool: !args.category_name && needsCategory ? null : capability.required_tool,
      clarification: !args.category_name && needsCategory ? askForCategory() : capability.clarification,
    };
  }

  metrics.capability = capability.name;
  metrics.tool_scope = [...capability.allowed_tools];


  // ---- GoalPlanner ANTES da execução -------------------------------------
  // O plano deixa de ser só trilha de auditoria: ele é montado com a rota do
  // turno e entra no prompt como contrato. Quando a política de autonomia
  // exige confirmação, o próprio prompt proíbe executar a escrita direto.
  const userExplicitTurn = routed.intent.kind === "confirm" || hasEntryIntent(String(input.text ?? ""));
  const prePlan = capability.required_tool
    ? buildGoalPlan({
      text: turnPlan.effective_text,
      primary_tool: String(capability.required_tool),
      complete: false,
      user_explicit: userExplicitTurn,
      proactive: false,
      amount: null,
    })
    : null;
  if (prePlan && prePlan.steps.length > 0) {
    metrics.formula_versions = { ...(metrics.formula_versions ?? {}), goal_plan: "nino_agent.v1" } as any;
  }

  // Fase 3 — personalize the system prompt with user preferences (best-effort).
  const prefs = await guard(() => tctx.preferences(), (m) => metrics.errors.push("prefs:" + m), null);
  // `nino_efficiency.v2` — prompt por competência: quando o prompt ativo é o
  // canônico (sem override administrativo), monte só os blocos que o escopo de
  // ferramentas do turno pode usar. Havendo override, mantemos o prompt inteiro:
  // regra escrita pelo time não é podada por heurística.
  const activePrompt = prompt?.system_prompt ?? "";
  const scopedBase = activePrompt.startsWith(DEFAULT_SYSTEM_PROMPT)
    ? composeSystemPrompt(blocksForTools(capability.allowed_tools))
      + activePrompt.slice(DEFAULT_SYSTEM_PROMPT.length)
    : activePrompt;
  let systemPrompt = personalizeSystemPrompt(scopedBase, prefs);

  // Observabilidade por bloco: quanto do prompt foi contexto financeiro.
  let contextJson = "";
  let contextChars = 0;

  systemPrompt = `${capabilityPrompt(capability)}\n\n${turnPlanPrompt(turnPlan)}\n\n${systemPrompt}`;
  if (prePlan && prePlan.steps.length > 0) {
    const writeStep = prePlan.steps.find((s) => s.kind === "write");
    systemPrompt =
      `[PLANO DO TURNO]\n` +
      `Sequência acordada: ${prePlan.narration}.\n` +
      (writeStep && !writeStep.ready
        ? `A escrita NÃO pode ser executada direto neste turno: monte o rascunho e peça a confirmação do usuário antes.\n`
        : ``) +
      `\n${systemPrompt}`;
  }
  if (mandatoryTools.length > 1) {
    systemPrompt = `[EXECUÇÃO OBRIGATÓRIA DAS SUB-PERGUNTAS]\n`
      + `Chame TODAS estas ferramentas neste turno antes de responder: ${mandatoryTools.join(", ")}.\n`
      + `Cada sub-pergunta recebe sua própria resposta com número da ferramenta correspondente. `
      + `Não responda parcialmente e não deixe nenhuma sub-pergunta sem número.\n\n${systemPrompt}`;
  }

  // Load only the factual slices required by this capability. This turns the
  // previously decorative FinancialContext360 facade into actual grounding
  // while keeping prompts bounded and identical across App and WhatsApp.
  if (capability.execution === "llm_scoped" && Object.values(capability.context).some(Boolean)) {
    // Medição do bloco de contexto (observabilidade por bloco do prompt).
    const financialContext = await guard(
      () => tctx.snapshot(capability.context),
      (m) => metrics.errors.push("context360:" + m),
      null,
    );
    if (financialContext && Object.keys(financialContext).length) {
      // Orçamento de contexto: campos vazios saem, listas são limitadas e o
      // JSON respeita 4k chars. Nada de corte cego no meio de uma chave.
      const { json: serialized, truncated, chars } = serializeWithinBudget(financialContext);
      contextJson = serialized;
      contextChars = chars;
      metrics.formula_versions = {
        ...(metrics.formula_versions ?? {}),
        context_budget: "context_budget.v1",
      } as any;
      systemPrompt =
        `[CONTEXTO FINANCEIRO CANÔNICO — ${capability.name}]\n${serialized}\n` +
        (truncated ? `(contexto resumido: listas longas foram limitadas — use uma ferramenta para detalhar)\n` : ``) +
        `Os valores acima vieram das mesmas ferramentas canônicas usadas pela Home. ` +
        `Não recalcule nem substitua esses números. Para listas, períodos ou operações não presentes, use uma ferramenta permitida.\n\n` +
        systemPrompt;
    }

  }

  // Camadas de memória medidas separadamente (`context_budget.v2`).
  const memoryPromptChars: { semantic: string; episodic: string } = { semantic: "", episodic: "" };

  const corrections = await guard(() => tctx.memory("correction", 8),
    (m) => metrics.errors.push("corrections:" + m), []);
  if (corrections?.length) {
    const hints = corrections.map((fact: any) => fact.value).filter(Boolean).slice(0, 8);
    // Memória episódica: correções explícitas do usuário, dentro do orçamento.
    const episodic = JSON.stringify(hints).slice(0, LAYER_BUDGET_CHARS.episodic_memory);
    memoryPromptChars.episodic = episodic;
    systemPrompt += `

[CORREÇÕES APRENDIDAS DO PRÓPRIO USUÁRIO]
${episodic}
` +
      `Use essas correções para não repetir uma interpretação rejeitada. Correção explícita do usuário prevalece sobre inferências anteriores.`;
  }

  // Reinforcement anti-alucinação: proibir "registrado/salvo/✅" sem tool call.
  systemPrompt =
    `[REGRA CRÍTICA]\n` +
    `Nunca responda como se um lançamento tivesse sido registrado, salvo, anotado ou confirmado ` +
    `sem ter chamado neste mesmo turno a tool create_transaction_draft (novo) ou ` +
    `confirm_pending_action (rascunho existente). Se pedir confirmação ao usuário, ` +
    `chame OBRIGATORIAMENTE create_transaction_draft antes de perguntar.\n` +
    `PROIBIDO escrever a frase "Responda CONFIRMAR/CANCELAR" ou qualquer resumo do tipo ` +
    `"Despesa de R$X na conta Y — Categoria em DATA" antes de a tool _draft ter retornado com sucesso ` +
    `neste mesmo turno. Se faltar informação, pergunte só o slot faltante — não antecipe o rascunho.\n` +
    `Palavra-mágica do usuário: se a mensagem contiver "${fastLogToken}" no início ou fim, ` +
    `o sistema já registrou direto — não repita o fluxo.\n\n` +
    systemPrompt;

  // Conta única: nunca perguntar algo que já está determinado.
  await guard(async () => {
    const { data: accs } = await sb.from("accounts")
      .select("name").eq("user_id", input.user_id).eq("active", true);
    const names = ((accs as Array<{ name: string }> | null) ?? []).map(a => a.name).filter(Boolean);
    if (names.length === 1) {
      systemPrompt =
        `[CONTAS DO USUÁRIO]\n` +
        `Ele tem apenas uma conta ativa: "${names[0]}". Termos genéricos como "conta corrente" ` +
        `se referem a ela. NUNCA pergunte em qual conta registrar nem sugira outra conta.\n\n` +
        systemPrompt;
    } else if (names.length > 1) {
      systemPrompt =
        `[CONTAS DO USUÁRIO]\n` +
        `Contas ativas: ${names.join(", ")}. Use apenas esses nomes; se precisar perguntar, ofereça essa lista.\n\n` +
        systemPrompt;
    }
  }, (m) => metrics.errors.push("accounts_prompt:" + m), null);

  // A conversa do App e do WhatsApp recebe a mesma situação financeira usada
  // pela Home, Nino e Relatórios. O diagnóstico orienta síntese e continuidade;
  // perguntas factuais continuam exigindo as tools canônicas do turno.
  const diagnosisForPrompt = await guard(async () => {
    const { data, error } = await sb.rpc("nino_diagnosis_context_for_user", { _user_id: input.user_id });
    if (error) throw error;
    return data as any;
  }, (m) => metrics.errors.push("diagnosis_prompt:" + m), null as any);

  if (diagnosisForPrompt?.ok && diagnosisForPrompt?.primary_situation) {
    const primary = diagnosisForPrompt.primary_situation;
    const supporting = (diagnosisForPrompt.supporting_situations ?? []).slice(0, 3).map((s: any) => ({
      situation_type: s.situation_type,
      narrative_role: s.narrative_role,
      headline: s.one_line_summary ?? s.headline,
      cause_summary: s.cause_summary,
      consequence_summary: s.consequence_summary,
      forecast_summary: s.forecast_summary,
      confidence: s.confidence,
    }));
    const compactDiagnosis = {
      contract: diagnosisForPrompt.contract,
      as_of: diagnosisForPrompt.as_of,
      overall_state: diagnosisForPrompt.overall_state,
      primary_situation: {
        situation_type: primary.situation_type,
        narrative_role: primary.narrative_role,
        headline: primary.one_line_summary ?? primary.headline,
        cause_summary: primary.cause_summary,
        consequence_summary: primary.consequence_summary,
        forecast_summary: primary.forecast_summary,
        confidence: primary.confidence,
      },
      primary_action: diagnosisForPrompt.primary_action,
      supporting_situations: supporting,
      narrative: diagnosisForPrompt.narrative,
      anticipations: (diagnosisForPrompt.anticipations ?? []).slice(0, 3).map((s: any) => ({
        headline: s.one_line_summary ?? s.headline,
        impact_amount: s.impact_amount,
        period_end: s.period_end,
        forecast_summary: s.forecast_summary,
      })),
    };
    systemPrompt =
      `[DIAGNÓSTICO FINANCEIRO CANÔNICO DO NINO]\n` +
      `${serializeWithinBudget(compactDiagnosis, { maxChars: 2_500, maxArray: 3, maxDepth: 4 }).json}\n` +

      `Use este diagnóstico para manter a mesma história financeira entre App e WhatsApp. ` +
      `Não recalcule valores, não invente causas e não contradiga as evidências. ` +
      `Quando a pergunta pedir valor, período, lista ou gráfico exato, consulte a tool correspondente.\n\n` +
      systemPrompt;
  }


  // Safety net: if there's a pending confirmation and the parser did not
  // intercept (loose "sim pode" / "manda" wasn't detected), prepend an
  // explicit block so the LLM confirms instead of restarting the flow.
  const pendingForPrompt = await guard(() => tctx.pending(),
    (m) => metrics.errors.push("pending_prompt:" + m), null);
  if (pendingForPrompt) {
    const summary = String((pendingForPrompt as any).summary_text ?? "operação pendente");
    systemPrompt =
      `[PENDÊNCIA ATIVA]\n` +
      `Existe um rascunho aguardando confirmação: ${summary}\n` +
      `Se o usuário confirmar (inclusive frases como "sim pode", "pode criar", "manda ver", "ok"), ` +
      `chame a tool confirm_pending_action com id="${(pendingForPrompt as any).id}".\n` +
      `Se cancelar, chame cancel_pending_action.\n` +
      `Não crie novo rascunho nem inicie nova conversa enquanto houver pendência.\n\n` +
      systemPrompt;
  }

  // Análise composta com escopo e completude (`nino_composite.v1`): pergunta
  // que cruza metas, atingimento e evolução histórica é resolvida por motor
  // canônico único, com truth gates e validação de completude. Se o plano NÃO
  // é reconhecido, o fluxo padrão segue igual. Se o plano é reconhecido e o
  // motor obrigatório falha, respondemos honestamente — nunca uma análise
  // semanticamente diferente vinda do fluxo antigo.
  const analyticalOutcome = (await isEnabled("composite_analysis_v1"))
    ? await guard(
      () => runCompositeAnalysis(sb, {
        user_id: input.user_id,
        conversation_id: input.conversation_id,
        text: turnPlan.effective_text,
        previous_scope: (memory as any)?.last_analysis?.scope ?? null,
        turn_period: turnPlan.effective_period,
        onTelemetry: (t) => {
          (metrics as any).composite_analysis = t;
          if (t.goal_performance_tool_failed) {
            metrics.errors.push("composite_analysis_failed:" + String(t.fallback_reason ?? "unknown"));
          }
        },
      }),
      (m) => metrics.errors.push("composite_analysis:" + m),
      { status: "not_applicable" as const },
    )
    : { status: "not_applicable" as const };

  const analytical = analyticalOutcome?.status === "answered" ? analyticalOutcome : null;
  const analyticalFailed = analyticalOutcome?.status === "failed" ? analyticalOutcome : null;

  if (analytical) {
    await guard(
      () => saveConversationMemory(sb, session_id ?? null, {
        last_analysis: {
          scope: analytical.scope,
          entity_ids: analytical.scope.entity_ids,
          entity_labels: analytical.scope.entity_labels,
          period: { from: analytical.plan.periods.current.from, to: analytical.plan.periods.current.to },
          comparison_period: analytical.plan.periods.comparison,
          state: analytical.interpretation.state,
          engines: analytical.plan.engines.map((e) => e.engine),
        },
      }),
      (m) => metrics.errors.push("composite_analysis_memory:" + m),
      null,
    );
  }

  // Perguntas compostas: executor determinístico real. Cada sub-pergunta chama
  // sua ferramenta canônica e recebe seu próprio bloco com número do motor.
  const composite = (!analyticalFailed && mandatoryTools.length > 1)
    ? await guard(
      () => executeComposite(sb, {
        user_id: input.user_id, conversation_id: input.conversation_id, plan: turnPlan,
      }),
      (m) => metrics.errors.push("composite:" + m),
      null,
    )
    : null;

  // ---- Planner (LLM loop or fallback) ------------------------------------
  const planner = analytical
    ? {
      path: "deterministic_tool" as const,
      errorSanitized: null,
      modelAttempts: [],
      turn: {
        reply: analytical.reply, steps: analytical.toolCalls.length, tokensIn: 0, tokensOut: 0,
        toolCalls: analytical.toolCalls, finish: "stop" as const,
      },
    }
    : analyticalFailed
    ? {
      path: "deterministic_tool" as const,
      errorSanitized: null,
      modelAttempts: [],
      turn: {
        reply: analyticalFailed.reply, steps: analyticalFailed.toolCalls.length, tokensIn: 0, tokensOut: 0,
        toolCalls: analyticalFailed.toolCalls, finish: "stop" as const,
      },
    }
    : composite && composite.answered >= 2

    ? {
      path: "deterministic_tool" as const,
      errorSanitized: null,
      modelAttempts: [],
      turn: {
        reply: composite.reply, steps: composite.toolCalls.length, tokensIn: 0, tokensOut: 0,
        toolCalls: composite.toolCalls, finish: "stop" as const,
      },
    }
    : await timeStage(metrics, "plan", async () => planAction(sb, {
    user_id: input.user_id, conversation_id: input.conversation_id,
    user_text: turnPlan.followup ? turnPlan.effective_text : input.text, hasPrompt: !!prompt,
    // Resolução de continuidade continua com o histórico completo do turno.
    history, capability,
  }, {
    model: prompt?.model ?? "google/gemini-2.5-flash",
    maxSteps: prompt?.max_steps ?? 6,
    temperature: prompt?.temperature ?? 0.2,
    systemPrompt,
    timeoutMs: 25_000,
    // Working memory (`context_budget.v2`): só os últimos turnos relevantes vão
    // ao prompt. Histórico completo nunca é despejado no modelo.
    history: (await isEnabled("context_budget_v2")) ? fitWorkingMemory(history) : history,
  }));

  let path: "llm" | "deterministic_tool" | "deterministic_fallback" = planner.path;
  let reply = "";
  let draft_id: string | undefined;
  let kind: HandleTurnResult["reply_kind"] = "info";
  let errorSanitized: string | null = planner.errorSanitized ?? null;
  const toolCallLog: any[] = [];

  if (planner.turn) {
    const turn = planner.turn;
    reply = turn.reply;
    metrics.tokens_in = turn.tokensIn;
    metrics.tokens_out = turn.tokensOut;
    metrics.llm_calls = turn.llmCalls ?? 0;
    metrics.tool_result_full_chars = turn.toolResultFullChars ?? 0;
    metrics.tool_result_llm_chars = turn.toolResultLlmChars ?? 0;
    metrics.tool_call_count = turn.toolCalls.length;
    toolCallLog.push(...turn.toolCalls);
    for (const c of turn.toolCalls) metrics.tools.push({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok });
    const draftCall = turn.toolCalls.find(c => c.ok && c.tool_name.endsWith("_draft"));
    if (draftCall) {
      draft_id = (draftCall.result as any)?.draft_id;
      kind = "draft";
      // Verdade do sistema acima da prosa do modelo: quando a ferramenta
      // entrega o cartão renderizado, é ele que vai ao usuário. Isso elimina
      // categoria/descrição inventadas e layout quebrado.
      const cardText = (draftCall.result as any)?.card_text;
      if (cardText) reply = String(cardText);
    }

    else if (turn.toolCalls.some(c => c.tool_name === "confirm_pending_action" && c.ok)) {
      const confirmCall = turn.toolCalls.find(c => c.tool_name === "confirm_pending_action" && c.ok);
      draft_id = (confirmCall?.result as any)?.draft_id;
      reply = String((confirmCall?.result as any)?.receipt ?? reply);
      kind = "receipt";
    }
    else if (turn.toolCalls.some(c => c.tool_name === "cancel_pending_action" && c.ok)) kind = "cancelled";
    else kind = "info";

    // Captura provenance de toda ferramenta analítica e artefatos multi-canal.
    for (const c of turn.toolCalls) {
      const genericFormula = c.ok ? (c.result as any)?.formula_version : null;
      if (genericFormula) recordFormulaVersion(metrics, c.tool_name, String(genericFormula));
      if (c.ok && c.tool_name === "generate_chart_artifact") {
        const aid = (c.result as any)?.artifact_id as string | undefined;
        const artifact = (c.result as any)?.artifact;
        if (aid) recordArtifact(metrics, "generated", aid);
        const fv = artifact?.provenance?.formula_version;
        if (fv) recordFormulaVersion(metrics, "generate_chart_artifact", String(fv));
      }
    }
  }

  if (path === "deterministic_fallback") {
    metrics.fallback_used = true;
    try {
      const fb = await timeStage(metrics, "tools", () => deterministicFallback(sb, input));
      reply = fb.reply; draft_id = fb.draft_id;
      kind = fb.kind === "draft" ? "draft" : fb.kind === "question" ? "question" : "info";
      // Inteligência indisponível + pergunta que exigia modelo: texto neutro,
      // nunca "não consegui identificar" (que soa como culpa do usuário) e
      // nunca detalhe de infraestrutura.
      if (/^gateway_(?:402|403)$/.test(String(errorSanitized ?? ""))
        && fb.kind === "info"
        && /^N[aã]o consegui identificar com seguran[çc]a/.test(fb.reply)) {
        reply = USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE;
        kind = "info";
      }
    } catch (e) {
      errorSanitized = errorSanitized ?? String((e as Error).message ?? "fallback_error").slice(0, 200);
      metrics.errors.push("fallback:" + errorSanitized);
      // Em lançamento, erro genérico está proibido: diga o que faltou.
      reply = capability.name === "transaction_entry"
        ? entryFailureMessage(toolCallLog as any)
        : FRIENDLY_ORCHESTRATOR_ERROR;
      kind = "info";
    }
  }

  // Paridade App/WhatsApp: se o usuário pediu um gráfico e o planner não
  // produziu artefato, o Core tenta a geração determinística antes de responder.
  const requestedArtifact = await guard(() => ensureRequestedArtifact({
    sb,
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    text: input.text,
    toolCalls: toolCallLog,
  }), (m) => metrics.errors.push("chart_fallback:" + m), null);
  if (requestedArtifact) {
    toolCallLog.push(requestedArtifact.toolCall);
    metrics.tool_call_count = toolCallLog.length;
    metrics.tools.push({
      name: requestedArtifact.toolCall.tool_name,
      duration_ms: requestedArtifact.toolCall.duration_ms,
      ok: requestedArtifact.toolCall.ok,
    });
    if (requestedArtifact.artifact_id) {
      recordArtifact(metrics, "generated", requestedArtifact.artifact_id);
      if (!/\b(aqui|segue|preparei|gerei|enviei).{0,50}gr[aá]fico\b/i.test(reply)) {
        reply = `${reply}\n\n${requestedArtifact.message}`.trim();
      }
    } else {
      const promisedWithoutArtifact = /\b(aqui|segue|preparei|gerei|enviei).{0,50}gr[aá]fico\b/i.test(reply);
      reply = promisedWithoutArtifact
        ? requestedArtifact.message
        : `${reply}\n\n${requestedArtifact.message}`.trim();
    }
  }

  metrics.path = path;
  metrics.model_attempts = planner.modelAttempts;
  // Verdade de telemetria: `model` é o modelo EFETIVAMENTE usado. Turno sem
  // chamada de LLM (caminho determinístico) não tem modelo — reportar o modelo
  // configurado ali inflaria custo e mascararia a taxa determinística.
  const succeededModel = [...planner.modelAttempts].reverse().find((attempt) => attempt.ok)?.model ?? null;
  const usedLlm = metrics.llm_calls > 0 || planner.modelAttempts.length > 0;
  const effectiveModel = succeededModel ?? (usedLlm ? (prompt?.model ?? "unknown") : "unknown");
  metrics.estimated_cost_usd = usedLlm
    ? estimateCost(effectiveModel, metrics.tokens_in, metrics.tokens_out)
    : 0;
  metrics.model = usedLlm ? effectiveModel : null;
  metrics.route_reason = planner.routeReason ?? null;
  metrics.model_tier = usedLlm ? (planner.modelTier ?? null) : null;

  // ---- GoalPlanner (plano do turno, auditável) ---------------------------
  // Decompõe o pedido em passos ordenados (ler → calcular → confirmar →
  // escrever) usando o registry de capacidades e a política de autonomia.
  // Não executa nada: serve de contrato e de trilha de auditoria.
  const plannedTool = (() => {
    const writeCall = toolCallLog.find((c: any) => /_draft$/.test(String(c.tool_name)));
    if (writeCall) return String(writeCall.tool_name);
    if (capability.required_tool) return String(capability.required_tool);
    const firstOk = toolCallLog.find((c: any) => c.ok);
    return firstOk ? String(firstOk.tool_name) : "";
  })();
  const turnPlanSteps = (() => {
    if (!plannedTool) {
      // Sem ferramenta executada, o plano registrado é o que foi acordado antes
      // da execução — nunca um plano vazio que apagaria a trilha.
      return prePlan
        ? { steps: planToSteps(prePlan), requires_confirmation: prePlan.requires_confirmation, autonomy_mode: prePlan.steps.find((s) => s.kind === "write")?.autonomy?.mode ?? null }
        : { steps: [] as Array<Record<string, unknown>>, requires_confirmation: false, autonomy_mode: null as string | null };
    }
    const plan = buildGoalPlan({
      text: turnPlan.effective_text,
      primary_tool: plannedTool,
      prerequisite_tools: toolCallLog
        .filter((c: any) => c.ok && !/_draft$/.test(String(c.tool_name)))
        .map((c: any) => String(c.tool_name)),
      complete: !!draft_id,
      user_explicit: userExplicitTurn,
      proactive: false,
      amount: Number((toolCallLog.find((c: any) => /_draft$/.test(String(c.tool_name)))?.args as any)?.amount ?? 0) || null,
    });
    const writeStep = plan.steps.find((s) => s.kind === "write");
    return {
      steps: planToSteps(plan),
      requires_confirmation: plan.requires_confirmation,
      autonomy_mode: writeStep?.autonomy?.mode ?? null,
    };
  })();
  metrics.formula_versions = {
    ...(metrics.formula_versions ?? {}),
    goal_plan: "nino_agent.v1",
  } as any;



  // ---- ResponseValidator -------------------------------------------------
  const successfulMutation = toolCallLog.some(c => c.ok && (
    /_draft$/.test(String(c.tool_name)) || c.tool_name === "confirm_pending_action"
  ));
  // Gráfico só quando há intenção visual EXPLÍCITA. "Evolução"/"tendência" são
  // análise textual e não podem exigir artefato em nenhuma camada.
  const chartRequested = hasExplicitChartIntent(String(input.text ?? ""));
  const validated = await timeStage(metrics, "validate", async () => validate(reply, {
    expectedKind: kind, hasDraft: !!draft_id,
    hasSuccessfulMutation: successfulMutation,
    toolCallErrors: toolCallLog.filter(c => !c.ok).length,
    userText: input.text,
    toolCalls: toolCallLog,
    requiredTool: capability.required_tool,
    entryTurn: capability.name === "transaction_entry",
    artifactExpected: chartRequested,
    artifactReady: !!metrics.artifact_id,
  }));
  metrics.validations = validated.reasons.length;
  if (validated.action === "fallback_deterministic" && !metrics.fallback_used) {
    // Validador rejeitou a resposta do modelo: cai uma vez no determinístico.
    //
    // PROIBIDO colar mensagens do usuário aqui. Era exatamente essa colagem que
    // transformava "Passar relatório do mês" em despesa de R$ 8,00 descrita como
    // "ago": o texto colado reinjetava valor, conta e estabelecimento de uma
    // notificação bancária antiga (`nino_provenance.v1`).
    //
    // O único caso de complemento legítimo é o SLOT: o Nino perguntou "em qual
    // conta eu registro?" e a mensagem atual é só a resposta. Aí juntamos a
    // mensagem de lançamento original com o slot — e nada mais.
    try {
      const userTurns = (history ?? []).filter(h => h.role === "user")
        .map(h => String(h.content ?? "").trim()).filter(Boolean);
      const lastAssistant = [...(history ?? [])].reverse().find(h => h.role !== "user");
      const assistantAskedEntrySlot = ENTRY_SLOT_QUESTION_RX.test(String(lastAssistant?.content ?? ""))
        || DRAFT_CARD_RX.test(String(lastAssistant?.content ?? ""));
      const originalEntryText = [...userTurns].reverse()
        .find(t => hasEntryIntent(t) && allowsEntryDraft(t) && !/\?\s*$/.test(t)) ?? null;
      const isSlotAnswer = assistantAskedEntrySlot
        && !!originalEntryText
        && !hasEntryIntent(input.text)
        && String(input.text ?? "").trim().split(/\s+/).length <= 6;
      const recoveredText = isSlotAnswer ? `${originalEntryText} ${input.text}` : input.text;
      const provenance: TextProvenance = isSlotAnswer ? "slot_answer" : "user_current";
      metrics.errors.push(`fallback_provenance:${provenance}`);
      const fb = await deterministicFallback(sb, { ...input, text: recoveredText, provenance });
      reply = fb.reply; draft_id = fb.draft_id;
      kind = fb.kind === "draft" ? "draft" : fb.kind === "question" ? "question" : "info";
      metrics.fallback_used = true;
      path = "deterministic_fallback";
      if (kind !== "draft" && kind !== "question") {
        // Recuperação não encontrou dados suficientes. Se o turno nem era de
        // lançamento, não podemos falar de "rascunho perdido".
        reply = isSlotAnswer || hasEntryIntent(input.text)
          ? "Perdi o rascunho anterior. Pode me mandar tudo em uma frase, ex.: 'gastei 33,89 alimentação Itaú hoje'?"
          : validated.body;
      }
    } catch { reply = validated.body; }

  } else {
    reply = validated.body;
  }

  // ---- Reconciliação de evidência (`nino_evidence.v1`) -------------------
  // Escopo travado nunca é respondido por agregado global, e evidência de outro
  // período não sustenta o número deste turno. A LLM não escolhe entre leituras
  // divergentes: o runtime descarta e, se a resposta usou o valor descartado,
  // ela não sai.
  const inheritedScope = (memory as any)?.last_analysis?.scope ?? null;
  const reconciliation = reconcileEvidence({
    toolCalls: toolCallLog as any[],
    scope: analytical ? analytical.scope : inheritedScope,
    period: turnPlan.effective_period
      ? { from: turnPlan.effective_period.from, to: turnPlan.effective_period.to }
      : null,
  });
  if (reconciliation.rejected.length) {
    metrics.errors.push(
      "evidence_rejected:" + reconciliation.rejected.map((r) => `${r.tool_name}:${r.reason}`).slice(0, 4).join(","),
    );
  }
  if (!analytical && replyUsesRejectedEvidence(reply, reconciliation)) {
    metrics.errors.push("evidence_conflict_blocked");
    reply = EVIDENCE_CONFLICT_REPLY;
  }

  // ---- Truth Gate v2 -----------------------------------------------------
  // Regra absoluta: nenhum valor em reais e nenhum percentual sai daqui sem
  // ferramenta determinística que o sustente. Quando falta prova, o Core tenta
  // resgatar a resposta pelo motor canônico; se não conseguir, admite o limite
  // em vez de inventar número.
  let truth = validateAgainstEvidence(reply, toolCallLog, turnPlan.effective_period);
  const unprovenNumbers = truth.issues.some((i) =>
    i.type === "no_evidence" || i.type === "value_not_in_evidence" || i.type === "percent_not_in_evidence"
  );
  if (unprovenNumbers && kind !== "draft" && kind !== "receipt" && kind !== "question") {
    metrics.errors.push("truth_gate_block:" + truth.issues.map((i) => i.type).join(","));
    metrics.validations = (metrics.validations ?? 0) + truth.issues.length;

    const rescueCapability = capability.required_tool && capability.execution === "deterministic"
      ? capability
      : classifyCapability(
        turnPlan.effective_text,
        routeIntent(turnPlan.effective_text).intent,
        interpretSemanticQuery(turnPlan.effective_text),
      );
    const rescue = rescueCapability.execution === "deterministic" && rescueCapability.required_tool
      ? await guard(
        () => executeDeterministicCapability(sb, {
          user_id: input.user_id,
          conversation_id: input.conversation_id,
          user_text: turnPlan.effective_text,
          capability: rescueCapability,
        }),
        (m) => metrics.errors.push("truth_rescue:" + m),
        null,
      )
      : null;

    if (rescue?.reply && rescue.toolCalls.some((c: any) => c.ok)) {
      for (const c of rescue.toolCalls as any[]) {
        toolCallLog.push({ ...c, step_index: toolCallLog.length + 1 });
        metrics.tools.push({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok });
      }
      metrics.tool_call_count = toolCallLog.length;
      path = "deterministic_tool";
      reply = rescue.reply;
      metrics.errors.push("truth_rescued:" + rescueCapability.required_tool);
    } else if (truth.canonical_headline) {
      reply = truth.canonical_headline;
    } else {
      // A recusa só pede categoria/período quando a pergunta era financeira.
      // Numa conversa que não pedia número, isso saía completamente desconexo.
      const financialAsk =
        /\b(gast|gastei|receit|renda|saldo|categoria|fatura|cart[aã]o|d[ií]vida|meta|invest|or[cç]amento|quanto)\b/i
          .test(String(input.text ?? ""));
      reply = financialAsk
        ? "Não vou te dar número que eu não consiga provar com os seus lançamentos. "
          + "Não consegui fechar essa conta agora — me diga a categoria e o período (ex.: \"alimentação em agosto\") "
          + "que eu calculo direto na sua base."
        : "Me perdi aqui e preferi não responder com número que eu não consiga provar. "
          + "Pode me dizer com outras palavras o que você quer, que eu sigo daí?";
    }

    truth = validateAgainstEvidence(reply, toolCallLog, turnPlan.effective_period);
  } else if (!truth.ok && truth.canonical_headline) {
    metrics.errors.push("truth_gate:" + truth.issues.map((i) => i.type).join(","));
    metrics.validations = (metrics.validations ?? 0) + truth.issues.length;
    reply = truth.canonical_headline;
  } else if (!truth.ok) {
    metrics.errors.push("truth_gate_flagged:" + truth.issues.map((i) => i.type).join(","));
  }
  if (truth.unbacked.length) {
    // Auditoria: todo número sem proveniência fica registrado com o claim exato.
    metrics.errors.push(
      "truth_unbacked:" + truth.unbacked.map((c) => `${c.kind}:${c.value}`).slice(0, 6).join(","),
    );
  }

  // ---- Persist run + tool calls -----------------------------------------
  const latency = Date.now() - startedAt;
  // Observabilidade real do turno: cada estágio tem o seu tempo, e o tempo de
  // ferramenta é a soma medida das chamadas (não um resto de subtração).
  const toolMs = toolCallLog.reduce((acc: number, c: any) => acc + Number(c.duration_ms ?? 0), 0);
  const stageMs = {
    ...metrics.stages,
    total: latency,
    tools_measured: toolMs,
  };
  const historyText = (history ?? []).map((h) => String(h.content ?? "")).join("\n");
  const evidenceChars = metrics.tool_result_llm_chars ?? 0;
  const toolSchemaChars = (capability.allowed_tools ?? []).join(",").length;
  // Context Budget V2: cada camada do prompt é medida e reportada.
  const layerMeasures = measureLayers({
    system_policy: systemPrompt.slice(0, Math.max(0, systemPrompt.length - contextJson.length)),
    user_turn: String(input.text ?? ""),
    working_memory: historyText,
    semantic_memory: memoryPromptChars.semantic,
    episodic_memory: memoryPromptChars.episodic,
    financial_evidence: contextJson,
    tool_schemas: (capability.allowed_tools ?? []).join(","),
  });
  const tokenSplit = {
    prompt_system: estimateTokens(systemPrompt),
    context: estimateTokens(contextJson),
    history: (history ?? []).reduce((acc, h) => acc + estimateTokens(String(h.content ?? "")), 0),
    user_text: estimateTokens(String(input.text ?? "")),
    evidence: estimateTokens("x".repeat(Math.min(evidenceChars, 200_000))),
    tool_schemas: estimateTokens((capability.allowed_tools ?? []).join(",")),
    completion: metrics.tokens_out ?? 0,
    reported_in: metrics.tokens_in ?? 0,
    reported_out: metrics.tokens_out ?? 0,
    layers_total: layerMeasures.total_tokens,
  };
  if (run_id) {
    await guard(async () => {
      const { error: runError } = await sb.from("agent_runs").update({
        status: errorSanitized ? "error" : "done",
        ended_at: new Date().toISOString(),
        path, steps: toolCallLog.length,
        // As colunas são NOT NULL. Turnos determinísticos usam zero; enviar
        // null mantinha o run eternamente em "running" e escondia a falha.
        tokens_in: metrics.tokens_in ?? 0, tokens_out: metrics.tokens_out ?? 0,
        tools_used: toolCallLog.map((c: any) => c.tool_name),
        formula_versions: metrics.formula_versions,
        latency_ms: latency,
        error_sanitized: errorSanitized, error_masked: errorSanitized,
        capability: capability.name,
        tool_scope: capability.allowed_tools,
        model_attempts: planner.modelAttempts,
        channel: metrics.channel ?? null,
        stage_ms: stageMs,
        token_breakdown: tokenSplit,
        context_chars: contextChars || null,
        routing_ms: Math.round(metrics.stages.intent ?? 0) || null,
        history_ms: Math.round(metrics.stages.session ?? 0) || null,
        context_ms: Math.round(metrics.stages.plan ?? 0) || null,
        tool_ms: toolMs || null,
        llm_ms: Math.round(Math.max(0, (metrics.stages.tools ?? 0) - toolMs)) || null,
        persist_ms: Math.round(metrics.stages.persist ?? 0) || null,
        estimated_cost_usd: metrics.estimated_cost_usd ?? null,
        // Eficiência (`nino_efficiency.v1`): responde "quantas chamadas de
        // modelo, quanto resultado de tool foi comprimido e por qual rota".
        llm_calls: metrics.llm_calls ?? 0,
        tool_result_full_chars: metrics.tool_result_full_chars ?? 0,
        tool_result_llm_chars: metrics.tool_result_llm_chars ?? 0,
        route_reason: metrics.route_reason,
        model_tier: metrics.model_tier,
        // Telemetria completa (`nino_efficiency.v2`). `provider_cost_usd` fica
        // NULL de propósito: o gateway não reporta custo real, e custo estimado
        // nunca é apresentado como custo do provedor.
        provider: planner.provider ?? (metrics.model ? String(metrics.model).split("/")[0] : null),
        fallback_attempts: planner.fallbackAttempts ?? 0,
        provider_cost_usd: null,
        compression_ratio: (metrics.tool_result_full_chars ?? 0) > 0
          ? Math.round(((metrics.tool_result_llm_chars ?? 0) / metrics.tool_result_full_chars) * 1000) / 1000
          : null,
        context_layers: { ...layerMeasures, flags: planner.flags ?? null },
        system_prompt_chars: systemPrompt.length,
        history_chars: historyText.length,
        working_memory_chars: layerMeasures.layers.working_memory?.chars ?? 0,
        semantic_memory_chars: layerMeasures.layers.semantic_memory?.chars ?? 0,
        financial_context_chars: contextChars || 0,
        tool_schema_chars: toolSchemaChars,
        evidence_chars: evidenceChars,
        truth_validation_failed: metrics.errors.some((e) => e.startsWith("truth_")),
        clarification_asked: Boolean(capability.clarification),
      }).eq("id", run_id);

      if (runError) throw runError;
      if (toolCallLog.length > 0) {
        const { error: callsError } = await sb.from("agent_tool_calls").insert(toolCallLog.map(c => ({
          run_id, step_index: c.step_index, tool_name: c.tool_name,
          args: c.args ?? {}, result: c.result ?? null,
          ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
        })));
        if (callsError) throw callsError;
      }
    }, (m) => metrics.errors.push("persist:" + m), null);
  }


  // Persiste ponteiros de conversa (tópico/período/intenção) para o próximo turno.
  // A categoria efetivamente usada pelo motor (args ou resultado da ferramenta)
  // tem precedência sobre o que o texto sugeria: sem isso, o follow-up
  // anafórico ("naquela categoria") perdia o assunto.
  const executedCategory = (() => {
    for (const call of [...toolCallLog].reverse()) {
      const fromResult = (call as any)?.result?.category?.name;
      if (typeof fromResult === "string" && fromResult.trim()) return fromResult.trim();
      const fromArgs = (call as any)?.args?.category_name;
      if (typeof fromArgs === "string" && fromArgs.trim()) return fromArgs.trim();
    }
    return null;
  })();
  const resolvedCategory = executedCategory
    ?? detectCategory(turnPlan.effective_text)
    ?? (capability.tool_args?.category_name ? String(capability.tool_args.category_name) : null);
  await guard(() => saveConversationMemory(sb, session_id ?? null, {
    current_topic: resolvedCategory ?? memory?.current_topic ?? capability.name,
    active_category: resolvedCategory ?? memory?.active_category ?? null,

    previous_intent: capability.name,
    active_period: {
      from: turnPlan.effective_period.from,
      to: turnPlan.effective_period.to,
      label: turnPlan.effective_period.label,
    },
    comparison_period: turnPlan.previous_period,
    pending_action: draft_id ?? null,
    // Se o Nino terminou perguntando, ele guarda o que espera ouvir.
    awaiting: detectExpectation(reply) ?? (kind === "question" ? awaiting : null),
    // Oferta analítica do Nino ("quer comparar…? me dá o ok") fica pendente
    // como operação estruturada até o usuário responder.
    pending_conversation_action: detectContinuationOffer(reply)
      ?? (continuationMemory?.pending_conversation_action ?? null),
    // `nino_scope.v2` — escopo de categorias sobrevive ao turno, mesmo quando a
    // resposta veio pelo fluxo antigo. Sem isso "essas categorias" nasce órfão.
    last_analysis: analytical
      ? {
        scope: analytical.scope,
        entity_ids: analytical.scope.entity_ids,
        entity_labels: analytical.scope.entity_labels,
        period: { from: analytical.plan.periods.current.from, to: analytical.plan.periods.current.to },
        comparison_period: analytical.plan.periods.comparison,
        state: analytical.interpretation.state,
        engines: analytical.plan.engines.map((e) => e.engine),
      }
      : (() => {
        const carried = scopeFromToolCalls(toolCallLog as any[]);
        if (!carried) return (memory as any)?.last_analysis ?? null;
        return {
          scope: carried,
          entity_ids: carried.entity_ids,
          entity_labels: carried.entity_labels,
          period: {
            from: turnPlan.effective_period.from,
            to: turnPlan.effective_period.to,
          },
          comparison_period: turnPlan.previous_period,
          state: null,
          engines: [],
        };
      })(),
    last_tool_context: toolCallLog.length
      ? { tool: String(toolCallLog[toolCallLog.length - 1]?.tool_name ?? ""), period: turnPlan.previous_period }
      : (memory?.last_tool_context ?? null),
  }), (m) => metrics.errors.push("conv_memory_save:" + m), null);


  const body = humanizeReply(validateReply(reply));
  await timeStage(metrics, "persist", async () => {
    if (input.channel !== "app" && input.to_phone) {
      await enqueueReply(sb, {
        user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone, body,
        idempotency_key: idem, inbound_message_id: input.inbound_message_id,
        source: input.channel === "simulator" ? "simulator" : "whatsapp",
        artifact_id: metrics.artifact_id,
      });
    }
  });
  metrics.stages.total = Date.now() - t0;

  // ---- Decision log (best-effort) ---------------------------------------
  metrics.intent = routed.intent.kind;
  metrics.model = usedLlm && effectiveModel !== "unknown" ? effectiveModel : null;
  await logDecision(sb, buildRecord({
    run_id: run_id ?? null,
    user_id: input.user_id, conversation_id: input.conversation_id,
    channel: input.channel, intent: routed.intent.kind,
    policy_decision: turnPlanSteps.autonomy_mode ?? decision.label,
    planned_steps: turnPlanSteps.steps,

    tool_calls: toolCallLog,
    validations: validated.reasons,
    metrics, error: errorSanitized,
  }));

  // ---- Turn event (observability unificada, App+WhatsApp) ---------------
  try {
    await sb.from("agent_turn_events").insert({
      run_id: run_id ?? null,
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      channel: input.channel,
      intent: routed.intent.kind,
      tools_used: toolCallLog.map((c: any) => ({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok })),
      formula_versions: metrics.formula_versions,
      stages_ms: metrics.stages,
      tokens_in: metrics.tokens_in || 0,
      tokens_out: metrics.tokens_out || 0,
      estimated_cost_usd: metrics.estimated_cost_usd,
      model: metrics.model,
      fallback_used: metrics.fallback_used,
      artifact_id: metrics.artifact_id,
      artifact_status: metrics.artifact_status,
      error: errorSanitized,
      capability: capability.name,
      tool_scope: capability.allowed_tools,
      model_attempts: planner.modelAttempts,
    });
  } catch (e) {
    console.error("[agent-core] turn_event insert failed", String((e as Error).message).slice(0, 200));
  }

  // ---- Learning loop (Fase 3, best-effort) ------------------------------
  await guard(() => learnFromTurn(sb, {
    user_id: input.user_id, intent: routed.intent.kind,
    policy_decision: decision.label, reply_kind: kind,
    tool_calls: toolCallLog, user_text: input.text,
  }), (m) => metrics.errors.push("learn:" + m), undefined);

  // ---- Aprendizado do consultor (`advisor_learning.v1`) ------------------
  // Vale igualmente para App e WhatsApp: o tópico sai do que o turno de fato
  // executou (tool/categoria/merchant), nunca de palpite sobre a pergunta.
  await guard(() => learnAdvisorInterest(sb, {
    user_id: input.user_id,
    source: input.channel === "app" ? "app" : input.channel === "simulator" ? "simulator" : "whatsapp",
    user_text: input.text,
    capability: capability.name,
    category: resolvedCategory,
    merchant: (capability.tool_args?.merchant as string | undefined) ?? null,
    previous_topic_key: resolveAdvisorTopicKey({
      category: memory?.active_category ?? null,
      capability: memory?.previous_intent ?? null,
    }),
    tool_calls: toolCallLog.map((c: any) => ({ tool_name: String(c.tool_name), ok: !!c.ok })),
    continuation_accepted: continuationAccepted,
    refs: { conversation_id: input.conversation_id, run_id: run_id ?? null },
  }).then(() => undefined), (m) => metrics.errors.push("advisor_learn:" + m), undefined);



  const analyticalCall = toolCallLog.find((c: any) => c.ok && c.tool_name === "get_weekday_spending_pattern");
  const evidence = analyticalCall?.result ? asEvidence(analyticalCall.result as any) : null;
  const envelope = buildChannelEnvelope({
    text: body,
    reply_kind: kind,
    evidence,
    artifact_id: metrics.artifact_id,
    artifact_status: metrics.artifact_status,
  });
  return { reply: body, reply_kind: kind, path, draft_id, run_id, session_id, envelope };
}
