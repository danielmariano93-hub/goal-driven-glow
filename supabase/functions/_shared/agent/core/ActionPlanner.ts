// ActionPlanner — decides between LLM+tools loop and deterministic fallback.
// Reproduces the branching that lived in runOrchestrator; owned here so
// App and WhatsApp share one decision point.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isLLMConfigured, sanitizeError, type LLMTurn } from "../llm.ts";
import { runToolLoop, type ToolRuntimeOptions } from "./ToolRuntime.ts";

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
