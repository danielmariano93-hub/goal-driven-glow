// ToolRuntime — canonical LLM-tools loop wrapper.
// Thin adapter around runAgentTurn so AgentCore has a stable seam and
// telemetry stays uniform across channels.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runAgentTurn, type LLMTurn } from "../llm.ts";
import type { HistoryTurn } from "./ConversationHistory.ts";

export type ToolRuntimeOptions = {
  model: string;
  maxSteps: number;
  temperature: number;
  systemPrompt: string;
  timeoutMs: number;
  history: HistoryTurn[];
};

export async function runToolLoop(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; user_text: string },
  opts: ToolRuntimeOptions,
): Promise<LLMTurn> {
  return await runAgentTurn(
    { sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text },
    args.user_text,
    opts,
  );
}
