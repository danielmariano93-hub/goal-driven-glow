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
import { loadActivePrompt } from "../prompt.ts";
import { createTurnContext } from "./ContextPipeline.ts";
import { resolveSession, type Channel } from "./SessionManager.ts";
import { routeIntent } from "./IntentRouter.ts";
import { evaluate as evaluatePolicy, decideTurn } from "./PolicyEngine.ts";
import { plan as planAction } from "./ActionPlanner.ts";
import { deterministicFallback } from "./DeterministicFallback.ts";
import { validate, validateReply, FRIENDLY_ORCHESTRATOR_ERROR } from "./ResponseValidator.ts";
import { personalizeSystemPrompt } from "./ResponseGenerator.ts";
import { enqueueReply } from "./OutboundQueue.ts";
import { createMetrics, estimateCost, timeStage, summarize, recordArtifact, recordFormulaVersion } from "./Observability.ts";
import { buildRecord, logDecision } from "./DecisionLogger.ts";
import { guard } from "./ErrorRecovery.ts";
import { learnFromTurn } from "./LearningLoop.ts";
import { isLLMConfigured } from "../llm.ts";
import { detectFastLog, loadFastLogToken, runFastLog } from "./FastLog.ts";

export type HandleTurnInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  channel: Channel;
  to_phone?: string;
};

export type HandleTurnResult = {
  reply: string;
  reply_kind: "receipt" | "draft" | "question" | "info" | "cancelled" | "expired";
  path: "llm" | "deterministic_fallback";
  draft_id?: string;
  run_id?: string;
  result?: unknown;
  session_id?: string;
};

export async function handleTurn(input: HandleTurnInput): Promise<HandleTurnResult> {
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

  // ---- FastLog (palavra-mágica: registra sem confirmação) ---------------
  const fastLogToken = await loadFastLogToken(sb, input.user_id);
  const fastLog = detectFastLog(input.text, fastLogToken);
  if (fastLog.triggered) {
    let run_id_fl: string | undefined;
    await guard(async () => {
      const { data: run } = await sb.from("agent_runs").insert({
        user_id: input.user_id, conversation_id: input.conversation_id,
        prompt_version_id: null, model: "fast_log", status: "running",
        started_at: new Date().toISOString(),
      }).select("id").maybeSingle();
      run_id_fl = (run as any)?.id as string | undefined;
    }, (m) => metrics.errors.push("runs_insert:" + m), null);
    const started = Date.now();
    const outcome = await runFastLog(sb, {
      user_id: input.user_id, conversation_id: input.conversation_id, cleanText: fastLog.cleanText,
    });
    metrics.path = "fast_log" as any;
    metrics.tool_call_count = outcome.tool_calls?.length ?? 0;
    for (const c of outcome.tool_calls ?? []) metrics.tools.push({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok });
    const body = outcome.reply ?? "";
    const kind: HandleTurnResult["reply_kind"] = outcome.reply_kind === "receipt" ? "receipt"
      : outcome.reply_kind === "question" ? "question" : "info";
    if (run_id_fl) {
      await guard(async () => {
        await sb.from("agent_runs").update({
          status: "done", ended_at: new Date().toISOString(),
          path: "fast_log", steps: outcome.tool_calls?.length ?? 0,
          latency_ms: Date.now() - started,
        }).eq("id", run_id_fl);
        if ((outcome.tool_calls?.length ?? 0) > 0) {
          await sb.from("agent_tool_calls").insert(outcome.tool_calls!.map(c => ({
            run_id: run_id_fl, step_index: c.step_index, tool_name: c.tool_name,
            args: c.args ?? {}, result: c.result ?? null,
            ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
          })));
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
    console.log("[agent-core] fast_log", JSON.stringify(summarize(metrics)));
    return { reply: body, reply_kind: kind, path: "deterministic_fallback", draft_id: outcome.draft_id, run_id: run_id_fl, session_id };
  }

  // ---- IntentRouter -------------------------------------------------------
  const routed = await timeStage(metrics, "intent", async () => routeIntent(input.text));

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
        const lastUserTexts = hist.filter(h => h.role === "user")
          .slice(-4).map(h => String(h.content ?? "").trim()).filter(Boolean);
        const recoveredText = [...lastUserTexts, input.text].join(". ");
        const fb = await deterministicFallback(sb, { ...input, text: recoveredText });
        return fb;
      }, (m) => metrics.errors.push("confirm_recover:" + m), null as any);
      if (recovered && recovered.kind === "draft") {
        metrics.fallback_used = true;
        if (input.channel !== "app" && input.to_phone) {
          await enqueueReply(sb, {
            user_id: input.user_id, conversation_id: input.conversation_id, to_phone: input.to_phone,
            body: recovered.reply, idempotency_key: idem, inbound_message_id: input.inbound_message_id,
            source: input.channel === "simulator" ? "simulator" : "whatsapp",
          });
        }
        return {
          reply: recovered.reply, reply_kind: "draft", path: "deterministic_fallback",
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
    const { data: run } = await sb.from("agent_runs").insert({
      user_id: input.user_id, conversation_id: input.conversation_id,
      prompt_version_id: prompt?.id ?? null, model: prompt?.model ?? "unknown",
      status: "running", started_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    run_id = (run as any)?.id as string | undefined;
  }, (m) => metrics.errors.push("runs_insert:" + m), null);

  const history = await tctx.history(12, input.channel === "app" ? input.inbound_message_id : null);

  // Fase 3 — personalize the system prompt with user preferences (best-effort).
  const prefs = await guard(() => tctx.preferences(), (m) => metrics.errors.push("prefs:" + m), null);
  let systemPrompt = personalizeSystemPrompt(prompt?.system_prompt ?? "", prefs);

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

  // ---- Planner (LLM loop or fallback) ------------------------------------
  const planner = await timeStage(metrics, "plan", () => planAction(sb, {
    user_id: input.user_id, conversation_id: input.conversation_id,
    user_text: input.text, hasPrompt: !!prompt,
  }, {
    model: prompt?.model ?? "google/gemini-2.5-flash",
    maxSteps: prompt?.max_steps ?? 6,
    temperature: prompt?.temperature ?? 0.2,
    systemPrompt,
    timeoutMs: 25_000,
    history,
  }));

  let path: "llm" | "deterministic_fallback" = planner.path;
  let reply = "";
  let draft_id: string | undefined;
  let kind: HandleTurnResult["reply_kind"] = "info";
  let errorSanitized: string | null = planner.errorSanitized ?? null;
  const toolCallLog: any[] = [];

  if (planner.path === "llm" && planner.turn) {
    const turn = planner.turn;
    reply = turn.reply;
    metrics.tokens_in = turn.tokensIn;
    metrics.tokens_out = turn.tokensOut;
    metrics.tool_call_count = turn.toolCalls.length;
    toolCallLog.push(...turn.toolCalls);
    for (const c of turn.toolCalls) metrics.tools.push({ name: c.tool_name, duration_ms: c.duration_ms, ok: c.ok });
    const draftCall = turn.toolCalls.find(c => c.ok && c.tool_name.endsWith("_draft"));
    if (draftCall) { draft_id = (draftCall.result as any)?.draft_id; kind = "draft"; }
    else if (turn.toolCalls.some(c => c.tool_name === "confirm_pending_action" && c.ok)) {
      const confirmCall = turn.toolCalls.find(c => c.tool_name === "confirm_pending_action" && c.ok);
      draft_id = (confirmCall?.result as any)?.draft_id;
      reply = String((confirmCall?.result as any)?.receipt ?? reply);
      kind = "receipt";
    }
    else if (turn.toolCalls.some(c => c.tool_name === "cancel_pending_action" && c.ok)) kind = "cancelled";
    else kind = "info";

    // Captura artifact_id de generate_chart_artifact para entrega multi-canal
    for (const c of turn.toolCalls) {
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
    } catch (e) {
      errorSanitized = errorSanitized ?? String((e as Error).message ?? "fallback_error").slice(0, 200);
      metrics.errors.push("fallback:" + errorSanitized);
      reply = FRIENDLY_ORCHESTRATOR_ERROR; kind = "info";
    }
  }

  metrics.path = path;
  metrics.estimated_cost_usd = estimateCost(prompt?.model ?? "unknown", metrics.tokens_in, metrics.tokens_out);

  // ---- ResponseValidator -------------------------------------------------
  const successfulMutation = toolCallLog.some(c => c.ok && (
    /_draft$/.test(String(c.tool_name)) || c.tool_name === "confirm_pending_action"
  ));
  const validated = await timeStage(metrics, "validate", async () => validate(reply, {
    expectedKind: kind, hasDraft: !!draft_id,
    hasSuccessfulMutation: successfulMutation,
    toolCallErrors: toolCallLog.filter(c => !c.ok).length,
  }));
  metrics.validations = validated.reasons.length;
  if (validated.action === "fallback_deterministic" && !metrics.fallback_used) {
    // If validator rejects an LLM reply, drop to deterministic fallback once.
    // Concatena os últimos turnos do usuário para não perder contexto quando
    // a mensagem atual é só o slot que faltava (ex.: "Alimentação").
    try {
      const lastUserTexts = (history ?? []).filter(h => h.role === "user")
        .slice(-4).map(h => String(h.content ?? "").trim()).filter(Boolean);
      const recoveredText = lastUserTexts.length > 0
        ? [...lastUserTexts, input.text].join(". ")
        : input.text;
      const fb = await deterministicFallback(sb, { ...input, text: recoveredText });
      reply = fb.reply; draft_id = fb.draft_id;
      kind = fb.kind === "draft" ? "draft" : fb.kind === "question" ? "question" : "info";
      metrics.fallback_used = true;
      path = "deterministic_fallback";
      if (kind !== "draft" && kind !== "question") {
        // Recuperação não encontrou dados suficientes: pede a frase completa
        // em vez de devolver o erro genérico.
        reply = "Perdi o rascunho anterior. Pode me mandar tudo em uma frase, ex.: 'gastei 33,89 alimentação Itaú hoje'?";
      }
    } catch { reply = validated.body; }
  } else {
    reply = validated.body;
  }

  // ---- Persist run + tool calls -----------------------------------------
  const latency = Date.now() - startedAt;
  if (run_id) {
    await guard(async () => {
      await sb.from("agent_runs").update({
        status: errorSanitized ? "error" : "done",
        ended_at: new Date().toISOString(),
        path, steps: toolCallLog.length,
        tokens_in: metrics.tokens_in || null, tokens_out: metrics.tokens_out || null,
        latency_ms: latency,
        error_sanitized: errorSanitized, error_masked: errorSanitized,
      }).eq("id", run_id);
      if (toolCallLog.length > 0) {
        await sb.from("agent_tool_calls").insert(toolCallLog.map(c => ({
          run_id, step_index: c.step_index, tool_name: c.tool_name,
          args: c.args ?? {}, result: c.result ?? null,
          ok: c.ok, duration_ms: c.duration_ms, error: c.error ?? null,
        })));
      }
    }, (m) => metrics.errors.push("persist:" + m), null);
  }

  const body = validateReply(reply);
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
  metrics.model = prompt?.model ?? null;
  await logDecision(sb, buildRecord({
    run_id: run_id ?? null,
    user_id: input.user_id, conversation_id: input.conversation_id,
    channel: input.channel, intent: routed.intent.kind,
    policy_decision: decision.label,
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
    });
  } catch (e) {
    console.error("[agent-core] turn_event insert failed", String((e as Error).message).slice(0, 200));
  }
  console.log("[agent-core] turn", JSON.stringify(summarize(metrics)));

  // ---- Learning loop (Fase 3, best-effort) ------------------------------
  await guard(() => learnFromTurn(sb, {
    user_id: input.user_id, intent: routed.intent.kind,
    policy_decision: decision.label, reply_kind: kind,
    tool_calls: toolCallLog, user_text: input.text,
  }), (m) => metrics.errors.push("learn:" + m), undefined);

  return { reply: body, reply_kind: kind, path, draft_id, run_id, session_id };
}
