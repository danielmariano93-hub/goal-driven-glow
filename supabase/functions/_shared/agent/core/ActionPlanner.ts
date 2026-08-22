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
import { classifyModelTask, loadModelRoute, tierForTask } from "../../intelligence/modelGateway.ts";
import { executeDeterministicCapability } from "./DeterministicAnswers.ts";
import { expandedToolsFor, type CapabilityDecision } from "./CapabilityRouter.ts";
import { aiBlockReply, getAiBlock, pauseAiCircuit } from "../../aiCircuit.ts";
import { runTool } from "./ToolRuntime.ts";
import { flagSnapshot } from "./FeatureFlags.ts";

/** Flags de eficiência consultadas por turno (`nino_efficiency.v2`). */
const EFFICIENCY_FLAGS = [
  "evidence_pack_v1", "deterministic_first_v2", "progressive_tools_v1", "model_routing_v2",
] as const;

/**
 * Leituras canônicas seguras de pré-executar sem argumentos do modelo
 * (`nino_efficiency.v1`). Rodando a tool ANTES da primeira chamada, o loop
 * economiza uma ida ao modelo só para escolher a ferramenta e a evidência
 * chega comprimida.
 */
const PREEXECUTABLE_READS = new Set([
  "get_financial_snapshot", "get_debt_status", "get_net_worth", "get_goals_overview",
  "get_commitments_agenda", "list_recent_transactions", "get_daily_insights",
  "get_future_installments", "list_investments", "get_spending_highlights",
  "forecast_month_close",
]);

export type PlannerResult = {
  path: "llm" | "deterministic_tool" | "deterministic_fallback";
  turn?: LLMTurn;
  errorSanitized?: string | null;
  modelAttempts: Array<{ model: string; ok: boolean; error?: string | null }>;
  /** Eficiência (`nino_efficiency.v1`) — por que esta rota e qual tier. */
  routeReason?: string | null;
  modelTier?: string | null;
  /** Telemetria completa (`nino_efficiency.v2`). */
  provider?: string | null;
  fallbackAttempts?: number;
  flags?: Record<string, boolean>;
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

  // Flags granulares: cada otimização pode ser desligada isoladamente sem
  // derrubar as outras (`nino_efficiency.v2`).
  const flags = await flagSnapshot(EFFICIENCY_FLAGS);

  if (args.capability.execution === "deterministic" && flags.deterministic_first_v2) {
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
        routeReason: "deterministic_first_v2",
        flags,
      };
    }
  }

  if (!args.hasPrompt || !isLLMConfigured()) {
    return { path: "deterministic_fallback", errorSanitized: null, modelAttempts: [], flags };
  }

  const existingBlock = await getAiBlock(sb);
  if (existingBlock) {
    return {
      path: "llm",
      errorSanitized: `gateway_${existingBlock.status}`,
      modelAttempts: [],
      turn: { reply: aiBlockReply(existingBlock), steps: 0, tokensIn: 0, tokensOut: 0, toolCalls: [], finish: "tool_error" },
      flags,
    };
  }

  const task = classifyModelTask(args.user_text, semantic);
  // `model_routing_v2` off → rota legada do prompt configurado, sem tiers.
  const route = flags.model_routing_v2
    ? await loadModelRoute(sb, task, opts.model, opts.maxSteps)
    : {
      task, primary: opts.model, fallback: null,
      max_latency_ms: opts.timeoutMs, max_steps: opts.maxSteps,
      reason: "model_routing_v2:off",
    };
  const tier = flags.model_routing_v2 ? tierForTask(task) : null;
  const provider = String(route.primary).split("/")[0] || null;
  // Pré-execução determinística da ferramenta canônica.
  const requiredTool = args.capability.required_tool;
  const toolArgs = args.capability.tool_args;
  let preExecuted: ToolRuntimeOptions["preExecuted"];
  if (requiredTool && (toolArgs || PREEXECUTABLE_READS.has(requiredTool))) {
    const exec = await runTool(
      { sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text } as any,
      requiredTool,
      toolArgs ?? {},
      { timeoutMs: Math.min(10_000, route.max_latency_ms), maxRetries: 1 },
    );
    preExecuted = [{
      tool_name: exec.tool_name, args: exec.args, result: exec.result,
      ok: exec.ok, duration_ms: exec.duration_ms, error: exec.error,
    }];
  }

  const primaryOpts: ToolRuntimeOptions = {
    ...opts,
    model: route.primary,
    maxSteps: route.max_steps,
    timeoutMs: route.max_latency_ms,
    allowedTools: args.capability.allowed_tools,
    requiredTool: args.capability.required_tool,
    evidencePack: flags.evidence_pack_v1,
    preExecuted,
  };


  try {
    let turn = await runToolLoop(sb, args, primaryOpts);
    // Progressive tool disclosure: o núcleo enxuto não concluiu (loop esgotado
    // ou resposta vazia). Só então o escopo ampliado entra, uma única vez.
    const expanded = expandedToolsFor(args.capability.name);
    if (expanded && (turn.finish === "length" || turn.finish === "empty")) {
      turn = await runToolLoop(sb, args, {
        ...primaryOpts,
        allowedTools: expanded,
        maxSteps: Math.min(3, route.max_steps + 1),
      });
      return {
        path: "llm", turn, errorSanitized: null,
        modelAttempts: [
          { model: route.primary, ok: false, error: `scope_expanded:${turn.finish}` },
          { model: route.primary, ok: true },
        ],
        routeReason: `${route.reason}+scope_expanded`, modelTier: tier,
      };
    }
    return {
      path: "llm", turn, errorSanitized: null,
      modelAttempts: [{ model: route.primary, ok: true }],
      routeReason: route.reason, modelTier: tier,
    };
  } catch (primaryError) {
    const primarySanitized = sanitizeError(primaryError);
    const primaryStatus = Number((primaryError as { status?: number })?.status ?? 0);
    if (primaryStatus === 402 || primaryStatus === 403) {
      const block = await pauseAiCircuit(sb, primaryStatus, String((primaryError as { body?: string })?.body ?? ""));
      return {
        path: "llm", errorSanitized: primarySanitized,
        modelAttempts: [{ model: route.primary, ok: false, error: primarySanitized }],
        turn: { reply: aiBlockReply(block ?? { status: primaryStatus, requires: null, message: "" }), steps: 0, tokensIn: 0, tokensOut: 0, toolCalls: [], finish: "tool_error" },
      };
    }
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
