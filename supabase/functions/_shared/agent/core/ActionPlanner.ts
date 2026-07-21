// ActionPlanner — decides HOW a turn is executed.
//
// Preserves the Fase 1 API `plan(sb, args, opts)` used by AgentCore (LLM
// loop vs deterministic fallback). Fase 2 adds:
//   • `buildDeterministicPlan` — produces an ordered Step[] plan for
//     confirmed intents so we can bypass the LLM when it adds no value.
//   • `dedupePlan` — deduplicates identical tool calls (stable key).
// Everything remains type-safe and channel-agnostic.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isLLMConfigured, sanitizeError, type LLMTurn } from "../llm.ts";
import { runToolLoop, dedupKey, type ToolRuntimeOptions } from "./ToolRuntime.ts";
import type { ParsedIntent } from "../parser.ts";

// -- Fase 1 planner (LLM vs deterministic fallback) --------------------------
export type PlannerResult = {
  path: "llm" | "deterministic_fallback";
  turn?: LLMTurn;
  errorSanitized?: string | null;
};

export async function plan(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; user_text: string; hasPrompt: boolean },
  opts: ToolRuntimeOptions,
): Promise<PlannerResult> {
  if (!args.hasPrompt || !isLLMConfigured()) {
    return { path: "deterministic_fallback", errorSanitized: null };
  }
  try {
    const turn = await runToolLoop(sb, args, opts);
    return { path: "llm", turn, errorSanitized: null };
  } catch (e) {
    return { path: "deterministic_fallback", errorSanitized: sanitizeError(e) };
  }
}

// -- Fase 2 additions --------------------------------------------------------
export type Step = {
  tool_name: string;
  args: Record<string, unknown>;
  depends_on?: number[];
};

export type Plan = {
  steps: Step[];
  reasoning: string;
};

/** Produces a compact deterministic plan for a well-formed intent. Returns
 *  null when there is no confident deterministic mapping — the caller then
 *  falls back to the LLM planner. */
export function buildDeterministicPlan(intent: ParsedIntent): Plan | null {
  if (intent.kind === "query") {
    if (intent.topic === "summary")           return { reasoning: "summary", steps: [{ tool_name: "get_financial_summary", args: {} }] };
    if (intent.topic === "recent")            return { reasoning: "recent",  steps: [{ tool_name: "list_recent_transactions", args: { limit: 5 } }] };
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

/** Drops later steps with the same (tool_name, args) signature. Order-preserving. */
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
