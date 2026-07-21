// DecisionLogger — one row per turn in public.agent_decisions so we can
// reconstruct exactly what the agent decided, executed and returned.
// Persistence is best-effort: logging must never break a live turn.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { TurnMetrics } from "./Observability.ts";

export type DecisionRecord = {
  run_id: string | null;
  user_id: string;
  conversation_id: string;
  channel: string;
  intent: string;
  policy_decision: string;
  planned_steps: unknown[];
  tool_calls: unknown[];
  validations: unknown[];
  fallback_used: boolean;
  error: string | null;
  duration_ms: number;
  metrics: Record<string, unknown>;
};

export async function logDecision(sb: SupabaseClient, rec: DecisionRecord): Promise<void> {
  try {
    await sb.from("agent_decisions").insert({
      run_id: rec.run_id,
      user_id: rec.user_id,
      conversation_id: rec.conversation_id,
      channel: rec.channel,
      intent: rec.intent,
      policy_decision: rec.policy_decision,
      planned_steps: rec.planned_steps ?? [],
      tool_calls: rec.tool_calls ?? [],
      validations: rec.validations ?? [],
      fallback_used: rec.fallback_used,
      error: rec.error,
      duration_ms: rec.duration_ms,
      metrics: rec.metrics ?? {},
    } as any);
  } catch (e) {
    console.error("[decision-logger] insert failed", String((e as Error).message).slice(0, 200));
  }
}

export function buildRecord(args: {
  run_id: string | null;
  user_id: string;
  conversation_id: string;
  channel: string;
  intent: string;
  policy_decision: string;
  planned_steps?: unknown[];
  tool_calls?: unknown[];
  validations?: unknown[];
  metrics: TurnMetrics;
  error?: string | null;
}): DecisionRecord {
  return {
    run_id: args.run_id,
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    channel: args.channel,
    intent: args.intent,
    policy_decision: args.policy_decision,
    planned_steps: args.planned_steps ?? [],
    tool_calls: args.tool_calls ?? args.metrics.tools,
    validations: args.validations ?? [],
    fallback_used: args.metrics.fallback_used,
    error: args.error ?? (args.metrics.errors[0] ?? null),
    duration_ms: args.metrics.stages.total ?? 0,
    metrics: {
      stages_ms: args.metrics.stages,
      tokens_in: args.metrics.tokens_in,
      tokens_out: args.metrics.tokens_out,
      tool_call_count: args.metrics.tool_call_count,
      path: args.metrics.path,
      estimated_cost_usd: args.metrics.estimated_cost_usd,
    },
  };
}
