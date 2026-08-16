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
import { tryBulkDraft, findBulkPending, executeBulkPending } from "./BulkEntry.ts";

import { buildChannelEnvelope } from "../../intelligence/channelEnvelope.ts";
import { asEvidence } from "../../intelligence/evidence.ts";
import { ensureRequestedArtifact } from "../../intelligence/chartFallback.ts";
import { interpretSemanticQuery } from "../../intelligence/semanticQuery.ts";
import { capabilityPrompt, classifyCapability, resumeDeterministicCapability } from "./CapabilityRouter.ts";
import { humanizeReply } from "./ReplyHumanizer.ts";
import { buildTurnPlan, turnPlanPrompt } from "./ConversationOrchestrator.ts";
import { validateAgainstEvidence } from "./TruthValidator.ts";

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
  return { ...result, reply: humanizeReply(result.reply) };
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

  const history = await tctx.history(12, input.channel === "app" ? input.inbound_message_id : null);
  const previousUserText = [...history].reverse().find((entry) =>
    entry.role === "user" && String(entry.content ?? "").trim() !== String(input.text ?? "").trim()
  )?.content;
  capability = resumeDeterministicCapability(input.text, routed.intent, previousUserText) ?? capability;

  // COMPREENDER — plano determinístico do turno (assunto herdado, período
  // resolvido em pt-BR e sub-perguntas). Se a mensagem atual é só complemento
  // ("e em agosto?"), o roteamento passa a ver o assunto completo.
  const turnPlan = buildTurnPlan({ text: input.text, history });
  if (turnPlan.followup || turnPlan.composed) {
    capability = classifyCapability(
      turnPlan.effective_text,
      routeIntent(turnPlan.effective_text).intent,
      interpretSemanticQuery(turnPlan.effective_text),
    );
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
  metrics.capability = capability.name;
  metrics.tool_scope = [...capability.allowed_tools];


  // Fase 3 — personalize the system prompt with user preferences (best-effort).
  const prefs = await guard(() => tctx.preferences(), (m) => metrics.errors.push("prefs:" + m), null);
  let systemPrompt = personalizeSystemPrompt(prompt?.system_prompt ?? "", prefs);
  systemPrompt = `${capabilityPrompt(capability)}\n\n${turnPlanPrompt(turnPlan)}\n\n${systemPrompt}`;
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
    const financialContext = await guard(
      () => tctx.snapshot(capability.context),
      (m) => metrics.errors.push("context360:" + m),
      null,
    );
    if (financialContext && Object.keys(financialContext).length) {
      const serialized = JSON.stringify(financialContext).slice(0, 14_000);
      systemPrompt =
        `[CONTEXTO FINANCEIRO CANÔNICO — ${capability.name}]\n${serialized}\n` +
        `Os valores acima vieram das mesmas ferramentas canônicas usadas pela Home. ` +
        `Não recalcule nem substitua esses números. Para listas, períodos ou operações não presentes, use uma ferramenta permitida.\n\n` +
        systemPrompt;
    }
  }

  const corrections = await guard(() => tctx.memory("correction", 8),
    (m) => metrics.errors.push("corrections:" + m), []);
  if (corrections?.length) {
    const hints = corrections.map((fact: any) => fact.value).filter(Boolean).slice(0, 8);
    systemPrompt += `

[CORREÇÕES APRENDIDAS DO PRÓPRIO USUÁRIO]
${JSON.stringify(hints)}
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
      `${JSON.stringify(compactDiagnosis)}\n` +
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

  // ---- Planner (LLM loop or fallback) ------------------------------------
  const planner = await timeStage(metrics, "plan", () => planAction(sb, {
    user_id: input.user_id, conversation_id: input.conversation_id,
    user_text: turnPlan.followup ? turnPlan.effective_text : input.text, hasPrompt: !!prompt,
    history, capability,
  }, {
    model: prompt?.model ?? "google/gemini-2.5-flash",
    maxSteps: prompt?.max_steps ?? 6,
    temperature: prompt?.temperature ?? 0.2,
    systemPrompt,
    timeoutMs: 25_000,
    history,
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
    } catch (e) {
      errorSanitized = errorSanitized ?? String((e as Error).message ?? "fallback_error").slice(0, 200);
      metrics.errors.push("fallback:" + errorSanitized);
      reply = FRIENDLY_ORCHESTRATOR_ERROR; kind = "info";
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
  const effectiveModel = [...planner.modelAttempts].reverse().find((attempt) => attempt.ok)?.model
    ?? prompt?.model ?? "unknown";
  metrics.estimated_cost_usd = estimateCost(effectiveModel, metrics.tokens_in, metrics.tokens_out);

  // ---- ResponseValidator -------------------------------------------------
  const successfulMutation = toolCallLog.some(c => c.ok && (
    /_draft$/.test(String(c.tool_name)) || c.tool_name === "confirm_pending_action"
  ));
  const chartRequested = /\b(gr[aá]fico|chart|visualiza|em\s+barras?|em\s+linha|em\s+pizza|evolu[çc][aã]o|tend[eê]ncia|dia\s+a\s+dia|por\s+dia)\b/i.test(String(input.text ?? ""));
  const validated = await timeStage(metrics, "validate", async () => validate(reply, {
    expectedKind: kind, hasDraft: !!draft_id,
    hasSuccessfulMutation: successfulMutation,
    toolCallErrors: toolCallLog.filter(c => !c.ok).length,
    userText: input.text,
    toolCalls: toolCallLog,
    requiredTool: capability.required_tool,
    artifactExpected: chartRequested,
    artifactReady: !!metrics.artifact_id,
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

  // CALCULAR → CONVERSAR: gate factual. A resposta jamais contradiz os motores.
  const truth = validateAgainstEvidence(reply, toolCallLog, turnPlan.effective_period);
  if (!truth.ok && truth.canonical_headline) {
    metrics.errors.push("truth_gate:" + truth.issues.map((i) => i.type).join(","));
    metrics.validations = (metrics.validations ?? 0) + truth.issues.length;
    reply = truth.canonical_headline;
  } else if (!truth.ok) {
    metrics.errors.push("truth_gate_flagged:" + truth.issues.map((i) => i.type).join(","));
  }

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
  metrics.model = effectiveModel === "unknown" ? null : effectiveModel;
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
