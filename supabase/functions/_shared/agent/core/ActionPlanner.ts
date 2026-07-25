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
import { runToolLoop, dedupKey, type ToolRuntimeOptions } from "./ToolRuntime.ts";
import type { ParsedIntent } from "../parser.ts";
import { interpretSemanticQuery, isInterpretationCorrection } from "../../intelligence/semanticQuery.ts";
import { executeWeekdayPattern } from "../../intelligence/weekdayTool.ts";
import { classifyModelTask, loadModelRoute } from "../../intelligence/modelGateway.ts";

export type PlannerResult = {
  path: "llm" | "deterministic_fallback";
  turn?: LLMTurn;
  errorSanitized?: string | null;
};

export async function plan(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    user_text: string;
    hasPrompt: boolean;
    history?: Array<{ role: string; content: string }>;
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
      return { path: "llm", turn, errorSanitized: null };
    } catch (e) {
      return { path: "deterministic_fallback", errorSanitized: sanitizeError(e) };
    }
  }

  if (!args.hasPrompt || !isLLMConfigured()) {
    return { path: "deterministic_fallback", errorSanitized: null };
  }

  const task = classifyModelTask(args.user_text, semantic);
  const route = await loadModelRoute(sb, task, opts.model, opts.maxSteps);
  const primaryOpts: ToolRuntimeOptions = {
    ...opts,
    model: route.primary,
    maxSteps: route.max_steps,
    timeoutMs: route.max_latency_ms,
  };

  try {
    const turn = await runToolLoop(sb, args, primaryOpts);
    return { path: "llm", turn, errorSanitized: null };
  } catch (primaryError) {
    if (route.fallback && route.fallback !== route.primary) {
      try {
        const turn = await runToolLoop(sb, args, { ...primaryOpts, model: route.fallback });
        return { path: "llm", turn, errorSanitized: null };
      } catch (fallbackError) {
        return { path: "deterministic_fallback", errorSanitized: sanitizeError(fallbackError) };
      }
    }
    return { path: "deterministic_fallback", errorSanitized: sanitizeError(primaryError) };
  }
}

export type Step = {
  tool_name: string;
  args: Record<string, unknown>;
  depends_on?: number[];
};

export type Plan = {
  steps: Step[];
  reasoning: string;
};

export function buildDeterministicPlan(intent: ParsedIntent): Plan | null {
  if (intent.kind === "query") {
    if (intent.topic === "summary") return { reasoning: "summary", steps: [{ tool_name: "get_financial_summary", args: {} }] };
    if (intent.topic === "recent") return { reasoning: "recent", steps: [{ tool_name: "list_recent_transactions", args: { limit: 5 } }] };
    if (intent.topic === "before_spending" && intent.amount)
      return { reasoning: "before_spending", steps: [{ tool_name: "run_before_spending", args: { amount: intent.amount } }] };
    return null;
  }
  if (intent.kind === "transaction") {
    return {
      reasoning: "transaction_draft",
      steps: [{ tool_name: "create_transaction_draft", args: {
        type: intent.type, amount: intent.amount,
        account: intent.account_hint ?? "",
        category: intent.category_hint,
        occurred_at: intent.occurred_at,
        description: intent.description,
      } }],
    };
  }
  if (intent.kind === "transfer") {
    return {
      reasoning: "transfer_draft",
      steps: [{ tool_name: "create_transfer_draft", args: {
        amount: intent.amount,
        from_account: intent.from_hint ?? "",
        to_account: intent.to_hint ?? "",
        occurred_at: intent.occurred_at,
      } }],
    };
  }
  if (intent.kind === "goal_contribution" && intent.goal_hint) {
    return {
      reasoning: "goal_contribution_draft",
      steps: [{ tool_name: "add_goal_contribution_draft", args: {
        goal: intent.goal_hint, amount: intent.amount, occurred_at: intent.occurred_at,
      } }],
    };
  }
  return null;
}

export function dedupePlan(p: Plan): Plan {
  const seen = new Set<string>();
  const steps: Step[] = [];
  for (const s of p.steps) {
    const k = dedupKey(s.tool_name, s.args);
    if (seen.has(k)) continue;
    seen.add(k);
    steps.push(s);
  }
  return { ...p, steps };
}
