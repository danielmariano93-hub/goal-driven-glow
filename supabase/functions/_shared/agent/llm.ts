// Lovable AI Gateway client using the OpenAI-compatible chat/completions
// endpoint with function tools. We drive the loop ourselves so telemetry
// (steps, tool calls, tokens) can be recorded step-by-step in the DB.
//
// This is intentionally a thin fetch-based client — no AI SDK required —
// keeping the Edge Function bundle small.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { openAIToolDefinitions, toolByName, type ToolContext, type ToolResult } from "./tools.ts";
import { todaySaoPaulo, shiftSaoPaulo } from "./parser.ts";

/** Builds a deterministic temporal system message. The LLM MUST use these
 *  values as "now" — never dates from examples, history, or its training. */
function temporalSystemContext(now: Date = new Date()): string {
  const hoje = todaySaoPaulo(now);
  const ontem = shiftSaoPaulo(hoje, -1);
  const anteontem = shiftSaoPaulo(hoje, -2);
  return [
    "CONTEXTO TEMPORAL (fonte da verdade — obrigatório):",
    `- timezone=America/Sao_Paulo`,
    `- hoje=${hoje}`,
    `- ontem=${ontem}`,
    `- anteontem=${anteontem}`,
    "Regras: nunca use datas de exemplos, do histórico antigo ou do seu conhecimento como data atual.",
    "Quando o usuário disser 'hoje', 'ontem' ou 'anteontem', use exatamente os valores acima em occurred_at. Se nenhuma data for citada, use hoje.",
  ].join("\n");
}

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type LLMOptions = {
  model: string;
  maxSteps: number;
  temperature?: number;
  timeoutMs?: number;
  systemPrompt: string;
};

export type LLMTurn = {
  reply: string;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  toolCalls: Array<{
    step_index: number; tool_name: string; args: any; result: any;
    ok: boolean; duration_ms: number; error?: string | null;
  }>;
  finish: "stop" | "length" | "tool_error" | "empty";
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: any[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export function isLLMConfigured(): boolean {
  return !!Deno.env.get("LOVABLE_API_KEY");
}

async function chatCompletion(body: unknown, signal?: AbortSignal) {
  const key = Deno.env.get("LOVABLE_API_KEY")!;
  const resp = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "edge-function",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`gateway_${resp.status}`);
    (err as any).status = resp.status;
    (err as any).body = text.slice(0, 500);
    throw err;
  }
  try { return JSON.parse(text); } catch { throw new Error("gateway_bad_json"); }
}

export async function runAgentTurn(
  toolCtx: ToolContext,
  userText: string,
  opts: LLMOptions & { history?: Array<{ role: "user" | "assistant"; content: string }> },
): Promise<LLMTurn> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  const tools = openAIToolDefinitions();

  const history = (opts.history ?? []).slice(-20).map((m) => ({
    role: m.role, content: String(m.content ?? "").slice(0, 2000),
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    ...history,
    { role: "user", content: userText },
  ];

  const toolCalls: LLMTurn["toolCalls"] = [];
  let tokensIn = 0, tokensOut = 0;
  let stepIndex = 0;
  const maxSteps = Math.max(1, Math.min(8, opts.maxSteps || 6));

  try {
    for (let step = 0; step < maxSteps; step++) {
      const body: any = {
        model: opts.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: opts.temperature ?? 0.2,
      };
      // GPT-5.6 family requires reasoning_effort=none when using function tools
      if (/^openai\/gpt-5\.6/.test(opts.model)) body.reasoning_effort = "none";

      const resp = await chatCompletion(body, controller.signal);
      const choice = resp.choices?.[0];
      const usage = resp.usage ?? {};
      tokensIn += Number(usage.prompt_tokens ?? 0);
      tokensOut += Number(usage.completion_tokens ?? 0);
      const msg = choice?.message ?? {};
      const calls = msg.tool_calls ?? [];

      if (calls.length === 0) {
        const content = String(msg.content ?? "").trim();
        return {
          reply: content || "Certo.",
          steps: step + 1,
          tokensIn, tokensOut,
          toolCalls,
          finish: content ? "stop" : "empty",
        };
      }

      // Assistant turn with tool_calls
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });

      // Execute each tool call sequentially
      for (const c of calls) {
        stepIndex++;
        const name = c.function?.name as string;
        let args: any = {};
        try { args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
        const tool = toolByName(name);
        const started = Date.now();
        let toolResult: ToolResult;
        try {
          toolResult = tool
            ? await tool.execute(toolCtx, args)
            : { ok: false, error: `unknown_tool:${name}` };
        } catch (e) {
          toolResult = { ok: false, error: String((e as Error).message).slice(0, 200) };
        }
        const duration_ms = Date.now() - started;
        toolCalls.push({
          step_index: stepIndex,
          tool_name: name,
          args,
          result: toolResult.ok ? toolResult.result : null,
          ok: toolResult.ok,
          duration_ms,
          error: toolResult.ok ? null : toolResult.error,
        });
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          name,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return { reply: "Estou processando ainda… Pode me contar de novo, de forma direta?", steps: maxSteps, tokensIn, tokensOut, toolCalls, finish: "length" };
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeError(e: unknown): string {
  const s = String((e as any)?.message ?? e ?? "erro").slice(0, 200);
  // Redact any accidental token/api-key patterns
  return s.replace(/[a-zA-Z0-9._-]{24,}/g, "…");
}
