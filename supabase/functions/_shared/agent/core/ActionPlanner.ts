// ActionPlanner — decides HOW a turn is executed.
//
// Nino Intelligence Core additions:
//   • semantic analytical routing before the LLM;
//   • deterministic, evidence-backed weekday analysis;
//   • model routing by task with one provider fallback;
//   • existing deterministic plans remain available for operations.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isLLMConfigured, sanitizeError, type LLMTurn } from "../llm.ts";
import { runToolLoop, type ToolRuntimeOptions } from "./ToolRuntime.ts";
import { interpretSemanticQuery, isInterpretationCorrection } from "../../intelligence/semanticQuery.ts";
import { executeWeekdayPattern } from "../../intelligence/weekdayTool.ts";
import { classifyModelTask, loadModelRoute } from "../../intelligence/modelGateway.ts";
import { executeDeterministicCapability } from "./DeterministicAnswers.ts";
import type { CapabilityDecision } from "./CapabilityRouter.ts";

export type PlannerResult = {
  path: "llm" | "deterministic_tool" | "deterministic_fallback";
  turn?: LLMTurn;
  errorSanitized?: string | null;
  modelAttempts: Array<{ model: string; ok: boolean; error?: string | null }>;
};

export async function plan(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    user_text: string;
    hasPrompt: boolean;
    history?: Array<{ role: string; content: string }>;
    capability: CapabilityDecision;
  },
  opts: ToolRuntimeOptions,
): Promise<PlannerResult> {
  const previousAnalyticalQuestion = isInterpretationCorrection(args.user_text)
    ? [...(args.history ?? [])].reverse().find((entry) =>
      entry.role === "user"
      && String(entry.content ?? "").trim() !== String(args.user_text ?? "").trim()
      && interpretSemanticQuery(String(entry.content ?? "")) !== null
    )?.content
    : null;
  const semantic = interpretSemanticQuery(args.user_text, previousAnalyticalQuestion);

  if (semantic?.intent === "weekday_pattern") {
    const started = Date.now();
    try {
      const analytical = await executeWeekdayPattern({ sb, user_id: args.user_id, query: semantic });
      const turn: LLMTurn = {
        reply: analytical.reply,
        steps: 1,
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: [{
          step_index: 1,
          tool_name: "get_weekday_spending_pattern",
          args: semantic,
          result: analytical.result,
          ok: true,
          duration_ms: Date.now() - started,
          error: null,
        }],
        finish: "stop",
      };
      return { path: "deterministic_tool", turn, errorSanitized: null, modelAttempts: [] };
    } catch (e) {
      const error = sanitizeError(e);
      return {
        path: "deterministic_tool",
        errorSanitized: error,
        modelAttempts: [],
        turn: {
          reply: "Não consegui consultar seu histórico comportamental agora. Nenhum dado foi alterado; o motivo técnico foi registrado para diagnóstico.",
          steps: 1,
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: [{
            step_index: 1,
            tool_name: "get_weekday_spending_pattern",
            args: semantic,
            result: null,
            ok: false,
            duration_ms: Date.now() - started,
            error,
          }],
          finish: "tool_error",
        },
      };
    }
  }

  if (args.capability.execution === "deterministic") {
    const turn = await executeDeterministicCapability(sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      user_text: args.user_text,
      capability: args.capability,
    });
    if (turn) {
      return {
        path: "deterministic_tool",
        turn,
        errorSanitized: turn.finish === "tool_error"
          ? turn.toolCalls.find((call) => !call.ok)?.error ?? "deterministic_tool_error"
          : null,
        modelAttempts: [],
      };
    }
  }

  if (!args.hasPrompt || !isLLMConfigured()) {
    return { path: "deterministic_fallback", errorSanitized: null, modelAttempts: [] };
  }

  const task = classifyModelTask(args.user_text, semantic);
  const route = await loadModelRoute(sb, task, opts.model, opts.maxSteps);
  const primaryOpts: ToolRuntimeOptions = {
    ...opts,
    model: route.primary,
    maxSteps: route.max_steps,
    timeoutMs: route.max_latency_ms,
    allowedTools: args.capability.allowed_tools,
    requiredTool: args.capability.required_tool,
  };

  try {
    const turn = await runToolLoop(sb, args, primaryOpts);
    return { path: "llm", turn, errorSanitized: null, modelAttempts: [{ model: route.primary, ok: true }] };
  } catch (primaryError) {
    const primarySanitized = sanitizeError(primaryError);
    if (route.fallback && route.fallback !== route.primary) {
      try {
        const turn = await runToolLoop(sb, args, { ...primaryOpts, model: route.fallback });
        return {
          path: "llm", turn, errorSanitized: null,
          modelAttempts: [
            { model: route.primary, ok: false, error: primarySanitized },
            { model: route.fallback, ok: true },
          ],
        };
      } catch (fallbackError) {
        return {
          path: "deterministic_fallback", errorSanitized: sanitizeError(fallbackError),
          modelAttempts: [
            { model: route.primary, ok: false, error: primarySanitized },
            { model: route.fallback, ok: false, error: sanitizeError(fallbackError) },
          ],
        };
      }
    }
    return {
      path: "deterministic_fallback", errorSanitized: primarySanitized,
      modelAttempts: [{ model: route.primary, ok: false, error: primarySanitized }],
    };
  }
}
