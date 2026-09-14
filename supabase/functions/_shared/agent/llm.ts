// Provider-neutral OpenAI-compatible chat/completions client with function tools.
// We drive the loop ourselves so telemetry (steps, tool calls, tokens) can be
// recorded step-by-step in the DB while the provider remains swappable.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { openAIToolDefinitions, toolByName, type ToolContext, type ToolResult } from "./tools.ts";
import { interpret, todaySaoPaulo, shiftSaoPaulo } from "./parser.ts";
import { buildEvidencePack } from "./core/EvidencePack.ts";
import { recordAiUsage } from "../aiUsageLedger.ts";
import { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../ai-runtime.ts";
import { isWriteTool } from "./core/TurnEvidenceCache.ts";
import {
  isDraftCompatibleWithIntent, isDraftWriteTool, scopeToolsToWriteIntent,
} from "./core/WriteIntentContract.ts";

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

export type LLMOptions = {
  model: string;
  maxSteps: number;
  temperature?: number;
  timeoutMs?: number;
  systemPrompt: string;
  allowedTools?: readonly string[];
  requiredTool?: string | null;
  evidencePack?: boolean;
  preExecuted?: Array<{
    tool_name: string; args: any; result: any; ok: boolean;
    duration_ms: number; error?: string | null;
  }>;
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
  llmCalls?: number;
  toolResultFullChars?: number;
  toolResultLlmChars?: number;
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: any[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export function isLLMConfigured(): boolean {
  return resolveAiProvider() !== null;
}

async function chatCompletion(body: any, signal?: AbortSignal) {
  const provider = resolveAiProvider();
  if (!provider) throw new Error("llm_not_configured");
  const requestBody = { ...body, model: normalizeAiModel(String(body?.model ?? ""), provider) };
  const resp = await fetch(aiEndpoint(provider, "chat/completions"), {
    method: "POST",
    headers: aiJsonHeaders(provider),
    body: JSON.stringify(requestBody),
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

  const parsedIntent = interpret(userText);
  const scopedAllowedTools = scopeToolsToWriteIntent(opts.allowedTools, parsedIntent);
  const tools = openAIToolDefinitions(scopedAllowedTools);

  const raw = (opts.history ?? []).slice(-20);
  const recent = raw.slice(-4).map((m) => ({
    role: m.role, content: String(m.content ?? "").slice(0, 800),
  }));
  const older = raw.slice(0, Math.max(0, raw.length - 4)).map((m) => ({
    role: m.role, content: String(m.content ?? "").replace(/\s+/g, " ").slice(0, 180),
  }));
  const history = older.length
    ? [
      {
        role: "system" as const,
        content: "[RESUMO DA CONVERSA ANTERIOR]\n" +
          older.map((m) => `${m.role === "user" ? "Usuário" : "Nino"}: ${m.content}`).join("\n"),
      },
      ...recent,
    ]
    : recent;

  const toolCalls: LLMTurn["toolCalls"] = [];
  let fullChars = 0, llmChars = 0, llmCalls = 0;
  let stepIndex = 0;

  const preBlocks: string[] = [];
  for (const pre of opts.preExecuted ?? []) {
    stepIndex++;
    toolCalls.push({
      step_index: stepIndex, tool_name: pre.tool_name, args: pre.args,
      result: pre.ok ? pre.result : null, ok: pre.ok,
      duration_ms: pre.duration_ms, error: pre.error ?? null,
    });
    const pack = buildEvidencePack(
      pre.tool_name,
      pre.ok ? { ok: true, result: pre.result } : { ok: false, error: pre.error ?? "tool_error" },
    );
    fullChars += pack.full_chars;
    llmChars += pack.llm_chars;
    preBlocks.push(`${pre.tool_name}: ${pack.json}`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "system", content: temporalSystemContext() },
    ...history,
    ...(preBlocks.length
      ? [{
        role: "system" as const,
        content: "EVIDÊNCIA JÁ APURADA (motor determinístico — use exatamente estes números, "
          + "não recalcule e não chame a mesma ferramenta de novo):\n" + preBlocks.join("\n"),
      }]
      : []),
    { role: "user", content: userText },
  ];

  let tokensIn = 0, tokensOut = 0;
  const maxSteps = Math.max(1, Math.min(8, opts.maxSteps || 6));
  const forcedReadTool = opts.requiredTool && !isWriteTool(opts.requiredTool)
    ? opts.requiredTool
    : null;

  try {
    for (let step = 0; step < maxSteps; step++) {
      const body: any = {
        model: opts.model,
        messages,
        tools,
        tool_choice: step === 0 && forcedReadTool && preBlocks.length === 0
          ? { type: "function", function: { name: forcedReadTool } }
          : "auto",
        temperature: opts.temperature ?? 0.2,
      };
      if (/^(?:openai\/)?gpt-5\.6/.test(opts.model)) body.reasoning_effort = "none";

      llmCalls++;
      const callStarted = Date.now();
      let resp: any;
      try {
        resp = await chatCompletion(body, controller.signal);
      } catch (error) {
        const status = Number((error as any)?.status ?? 0) || null;
        await recordAiUsage(toolCtx.sb, {
          workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "chat_step",
          user_id: toolCtx.user_id, model: opts.model, operation_type: "chat", success: false,
          http_status: status, error_code: status ? `gateway_${status}` : "gateway_error",
          latency_ms: Date.now() - callStarted, batch_size: 1, unique_items: 1,
          metadata: { conversation_id: toolCtx.conversation_id, step },
        });
        throw error;
      }
      const choice = resp.choices?.[0];
      const usage = resp.usage ?? {};
      const stepTokensIn = Number(usage.prompt_tokens ?? 0);
      const stepTokensOut = Number(usage.completion_tokens ?? 0);
      tokensIn += stepTokensIn;
      tokensOut += stepTokensOut;
      await recordAiUsage(toolCtx.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "chat_step",
        user_id: toolCtx.user_id, model: opts.model, operation_type: "chat",
        input_tokens: stepTokensIn, output_tokens: stepTokensOut, success: true,
        latency_ms: Date.now() - callStarted, batch_size: 1, unique_items: 1,
        metadata: { conversation_id: toolCtx.conversation_id, step, tool_count: (resp.choices?.[0]?.message?.tool_calls ?? []).length },
      });
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
          llmCalls,
          toolResultFullChars: fullChars,
          toolResultLlmChars: llmChars,
        };
      }

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });

      for (const c of calls) {
        stepIndex++;
        const name = c.function?.name as string;
        let args: any = {};
        try { args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
        const tool = toolByName(name);
        const started = Date.now();
        let toolResult: ToolResult;
        const successfulDraftAlreadyExists = toolCalls.some(
          (call) => call.ok && isDraftWriteTool(call.tool_name),
        );

        if (isDraftWriteTool(name) && !isDraftCompatibleWithIntent(name, parsedIntent)) {
          toolResult = { ok: false, error: `write_contract_violation:${name}` };
        } else if (isDraftWriteTool(name) && successfulDraftAlreadyExists) {
          toolResult = { ok: false, error: `write_contract_violation:multiple_drafts` };
        } else {
          try {
            toolResult = tool
              ? await tool.execute(toolCtx, args)
              : { ok: false, error: `unknown_tool:${name}` };
          } catch (e) {
            toolResult = { ok: false, error: String((e as Error).message).slice(0, 200) };
          }
        }
        const duration_ms = Date.now() - started;
        toolCalls.push({
          step_index: stepIndex,
          tool_name: name,
          args,
          result: toolResult.ok ? toolResult.result : null,
          ok: toolResult.ok,
          duration_ms,
          error: toolResult.ok ? null : (toolResult as { error?: string }).error,
        });
        const fullSerialized = JSON.stringify(toolResult);
        let contentForModel = fullSerialized;
        if (opts.evidencePack !== false) {
          const pack = buildEvidencePack(name, toolResult);
          contentForModel = pack.json;
          fullChars += pack.full_chars;
          llmChars += pack.llm_chars;
        } else {
          fullChars += fullSerialized.length;
          llmChars += fullSerialized.length;
        }
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          name,
          content: contentForModel,
        });
      }
    }

    return {
      reply: "Estou processando ainda… Pode me contar de novo, de forma direta?",
      steps: maxSteps, tokensIn, tokensOut, toolCalls, finish: "length",
      llmCalls, toolResultFullChars: fullChars, toolResultLlmChars: llmChars,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeError(e: unknown): string {
  const s = String((e as any)?.message ?? e ?? "erro").slice(0, 200);
  return s.replace(/[a-zA-Z0-9._-]{24,}/g, "…");
}
