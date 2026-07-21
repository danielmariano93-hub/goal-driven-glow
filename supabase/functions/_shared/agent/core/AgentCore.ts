// AgentCore.handleTurn — single entry point shared by App and WhatsApp.
// Pipeline: SessionManager → IntentRouter → PolicyEngine → ActionPlanner
//           → ToolRuntime (or DeterministicFallback) → ResponseValidator
//           → Persistence.
// Behavior is intentionally the same as the previous runOrchestrator; the
// only channel-dependent step is whether the reply is enqueued into
// outbound_messages (WhatsApp/simulator) or returned to the caller (App).
// deno-lint-ignore-file no-explicit-any
import { service } from "./service.ts";
import { loadActivePrompt } from "../prompt.ts";
import { loadHistory } from "./ConversationHistory.ts";
import { resolveSession, type Channel } from "./SessionManager.ts";
import { routeIntent } from "./IntentRouter.ts";
import { evaluate as evaluatePolicy } from "./PolicyEngine.ts";
import { plan as planAction } from "./ActionPlanner.ts";
import { deterministicFallback } from "./DeterministicFallback.ts";
import { validateReply, FRIENDLY_ORCHESTRATOR_ERROR } from "./ResponseValidator.ts";
import { enqueueReply } from "./OutboundQueue.ts";

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

  // Dedupe by inbound_message_id (WhatsApp retries hit here first)
  if (input.channel !== "app") {
    const { data: existing } = await sb.from("outbound_messages")
      .select("body").eq("inbound_message_id", input.inbound_message_id).maybeSingle();
    if (existing) {
      return { reply: existing.body as string, reply_kind: "info", path: "deterministic_fallback" };
    }
  }

  const idem = `run:${input.inbound_message_id}`;

  // SessionManager — best-effort; failures don't block the turn.
  let session_id: string | undefined;
  try {
    const s = await resolveSession(sb, {
      user_id: input.user_id, channel: input.channel, conversation_id: input.conversation_id,
    });
    session_id = s.id;
  } catch (_e) { /* stay stateless */ }

  // IntentRouter + PolicyEngine (confirm/cancel interception)
  const routed = routeIntent(input.text);
  const decision = await evaluatePolicy(sb, {
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    inbound_message_id: input.inbound_message_id,
    intent: routed.intent,
  });

  if (decision.kind === "reply") {
    const body = validateReply(decision.body);
    if (input.channel !== "app" && input.to_phone) {
      await enqueueReply(sb, {
        user_id: input.user_id, to_phone: input.to_phone, body,
        idempotency_key: idem, inbound_message_id: input.inbound_message_id,
        source: input.channel === "simulator" ? "simulator" : "whatsapp",
      });
    }
    return {
      reply: body,
      reply_kind: decision.replyKind,
      path: "deterministic_fallback",
      draft_id: decision.draft_id,
      result: decision.result,
      session_id,
    };
  }

  // ----- Guarded LLM/fallback run -----
  const startedAt = Date.now();
  let prompt: Awaited<ReturnType<typeof loadActivePrompt>> | null = null;
  try { prompt = await loadActivePrompt(sb); }
  catch (e) { console.error("[core] loadActivePrompt failed", String((e as Error).message).slice(0, 200)); }

  let run_id: string | undefined;
  try {
    const { data: run } = await sb.from("agent_runs").insert({
      user_id: input.user_id, conversation_id: input.conversation_id,
      prompt_version_id: prompt?.id ?? null, model: prompt?.model ?? "unknown",
      status: "running", started_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    run_id = (run as any)?.id as string | undefined;
  } catch (e) {
    console.error("[core] agent_runs insert failed", String((e as Error).message).slice(0, 200));
  }

  const history = await loadHistory(sb, input.conversation_id, {
    limit: 12,
    excludeMessageId: input.channel === "app" ? input.inbound_message_id : null,
  });

  const planner = await planAction(sb, {
    user_id: input.user_id, conversation_id: input.conversation_id,
    user_text: input.text, hasPrompt: !!prompt,
  }, {
    model: prompt?.model ?? "google/gemini-2.5-flash",
    maxSteps: prompt?.max_steps ?? 6,
    temperature: prompt?.temperature ?? 0.2,
    systemPrompt: prompt?.system_prompt ?? "",
    timeoutMs: 25_000,
    history,
  });

  let path: "llm" | "deterministic_fallback" = planner.path;
  let reply = "";
  let draft_id: string | undefined;
  let kind: HandleTurnResult["reply_kind"] = "info";
  let tokensIn = 0, tokensOut = 0, steps = 0;
  let errorSanitized: string | null = planner.errorSanitized ?? null;
  const toolCallLog: any[] = [];

  if (planner.path === "llm" && planner.turn) {
    const turn = planner.turn;
    reply = turn.reply;
    tokensIn = turn.tokensIn; tokensOut = turn.tokensOut; steps = turn.steps;
    toolCallLog.push(...turn.toolCalls);
    const draftCall = turn.toolCalls.find(c => c.ok && c.tool_name.endsWith("_draft"));
    if (draftCall) { draft_id = (draftCall.result as any)?.draft_id; kind = "draft"; }
    else if (turn.toolCalls.some(c => c.tool_name === "cancel_pending_action" && c.ok)) kind = "cancelled";
    else kind = "info";
  }

  if (path === "deterministic_fallback") {
    try {
      const fb = await deterministicFallback(sb, input);
      reply = fb.reply; draft_id = fb.draft_id;
      kind = fb.kind === "draft" ? "draft" : fb.kind === "question" ? "question" : "info";
    } catch (e) {
      errorSanitized = errorSanitized ?? String((e as Error).message ?? "fallback_error").slice(0, 200);
      reply = FRIENDLY_ORCHESTRATOR_ERROR; kind = "info";
    }
  }

  const latency = Date.now() - startedAt;

  if (run_id) {
    try {
      await sb.from("agent_runs").update({
        status: errorSanitized ? "error" : "done",
        ended_at: new Date().toISOString(),
        path, steps,
        tokens_in: tokensIn || null, tokens_out: tokensOut || null,
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
    } catch (e) {
      console.error("[core] run persistence failed", String((e as Error).message).slice(0, 200));
    }
  }

  const body = validateReply(reply);
  if (input.channel !== "app" && input.to_phone) {
    await enqueueReply(sb, {
      user_id: input.user_id, to_phone: input.to_phone, body,
      idempotency_key: idem, inbound_message_id: input.inbound_message_id,
      source: input.channel === "simulator" ? "simulator" : "whatsapp",
    });
  }

  return { reply: body, reply_kind: kind, path, draft_id, run_id, session_id };
}
