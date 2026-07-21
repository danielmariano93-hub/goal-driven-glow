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
import type { HistoryTurn } from "./ConversationHistory.ts";
import { isRetryable } from "./ErrorRecovery.ts";

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
  timeoutMs?: number;   // per-attempt timeout (default 10s)
  maxRetries?: number;  // additional attempts on transient error (default 1)
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
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = Math.max(0, opts.maxRetries ?? 1);
  const tool = toolByName(tool_name);
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
      // Tool returned {ok:false}: transient errors get one retry, others bubble up.
      lastErr = new Error(String(r.error ?? "tool_error"));
      if (!isRetryable(lastErr) || attempt === maxRetries) {
        return { tool_name, args, ok: false, result: null,
                 error: String(r.error ?? "tool_error").slice(0, 200), duration_ms, retries: attempt };
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
    await new Promise(r => setTimeout(r, 100 * attempt)); // linear backoff
  }
  return { tool_name, args, ok: false, result: null,
           error: String((lastErr as any)?.message ?? "tool_error").slice(0, 200),
           duration_ms: Date.now() - started, retries: attempt };
}

/** Deterministic dedupe key used by ActionPlanner. */
export function dedupKey(tool_name: string, args: unknown): string {
  return tool_name + ":" + stableStringify(args);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as any).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}
