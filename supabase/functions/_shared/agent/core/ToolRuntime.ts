// ToolRuntime — canonical tool execution surface.
// - `runToolLoop`     : LLM-driven multi-step loop (unchanged wrapper over
//                       runAgentTurn, so existing telemetry stays uniform).
// - `runTool`         : single-tool call with timeout, retry (transient only),
//                       and standard `ToolExecution` return shape. Used by
//                       ActionPlanner for deterministic plans.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runAgentTurn, type LLMTurn } from "../llm.ts";
import { toolByName, type ToolContext, type ToolResult } from "../tools.ts";
import { lifecycleToolByName } from "./LifecycleTools.ts";
import { recurringLifecycleToolByName } from "./RecurringLifecycleTools.ts";
import { goalLifecycleToolByName } from "./GoalLifecycleTools.ts";
import { undoLifecycleToolByName } from "./UndoLifecycleTools.ts";
import type { HistoryTurn } from "./ConversationHistory.ts";
import { isRetryable } from "./ErrorRecovery.ts";
import type { TurnEvidenceCache } from "./TurnEvidenceCache.ts";

export type ToolRuntimeOptions = {
  model: string;
  maxSteps: number;
  temperature: number;
  systemPrompt: string;
  timeoutMs: number;
  history: HistoryTurn[];
  allowedTools?: readonly string[];
  requiredTool?: string | null;
  evidencePack?: boolean;
  preExecuted?: Array<{
    tool_name: string; args: unknown; result: unknown; ok: boolean;
    duration_ms: number; error?: string | null;
  }>;
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

export type ToolExecution = {
  tool_name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
  error: string | null;
  duration_ms: number;
  retries: number;
};

export type RunToolOptions = {
  timeoutMs?: number;
  maxRetries?: number;
};

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tool_timeout_${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); },
           e => { clearTimeout(t); reject(e); });
  });
}

export async function runTool(
  ctx: ToolContext,
  tool_name: string,
  args: any,
  opts: RunToolOptions = {},
): Promise<ToolExecution> {
  const cache = (ctx as any)?.evidenceCache as TurnEvidenceCache | undefined;
  if (cache) {
    const out = await cache.run(tool_name, args, () => runToolUncached(ctx, tool_name, args, opts));
    return out as ToolExecution;
  }
  return await runToolUncached(ctx, tool_name, args, opts);
}

async function runToolUncached(
  ctx: ToolContext,
  tool_name: string,
  args: any,
  opts: RunToolOptions = {},
): Promise<ToolExecution> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = Math.max(0, opts.maxRetries ?? 1);
  // Lifecycle adapters are intentionally NOT exposed as free-form LLM tools.
  // Frequency-aware recurring adapters run before the legacy lifecycle map so
  // a valid recurring command can never fall back to the older generic shape.
  const tool = toolByName(tool_name)
    ?? recurringLifecycleToolByName(tool_name)
    ?? lifecycleToolByName(tool_name)
    ?? goalLifecycleToolByName(tool_name)
    ?? undoLifecycleToolByName(tool_name);
  const started = Date.now();

  if (!tool) {
    return { tool_name, args, ok: false, result: null,
             error: `unknown_tool:${tool_name}`, duration_ms: 0, retries: 0 };
  }

  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= maxRetries) {
    try {
      const r: ToolResult = await withTimeout(tool.execute(ctx, args), timeoutMs);
      const duration_ms = Date.now() - started;
      if (r.ok) return { tool_name, args, ok: true, result: r.result, error: null, duration_ms, retries: attempt };
      const rError = (r as { error?: string }).error;
      lastErr = new Error(String(rError ?? "tool_error"));
      if (!isRetryable(lastErr) || attempt === maxRetries) {
        return { tool_name, args, ok: false, result: (r as any).result ?? null,
                 error: String(rError ?? "tool_error").slice(0, 200), duration_ms, retries: attempt };
      }
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === maxRetries) {
        return { tool_name, args, ok: false, result: null,
                 error: String((e as Error).message ?? e).slice(0, 200),
                 duration_ms: Date.now() - started, retries: attempt };
      }
    }
    attempt++;
    await new Promise(r => setTimeout(r, 100 * attempt));
  }
  return { tool_name, args, ok: false, result: null,
           error: String((lastErr as any)?.message ?? "tool_error").slice(0, 200),
           duration_ms: Date.now() - started, retries: attempt };
}

export function dedupKey(tool_name: string, args: unknown): string {
  return tool_name + ":" + stableStringify(args);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as any).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}