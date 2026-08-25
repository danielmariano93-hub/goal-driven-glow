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
import { buildEvidencePack } from "./core/EvidencePack.ts";
import { recordAiUsage } from "../aiUsageLedger.ts";

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
  /** Capability-scoped registry. Never expose unrelated financial tools. */
  allowedTools?: readonly string[];
  /** Force the first factual lookup when a capability has one canonical tool. */
  requiredTool?: string | null;
  /**
   * `nino_efficiency.v1` — quando ligado, o resultado da tool entra no prompt
   * comprimido semanticamente (EvidencePack) e dentro do orçamento por tool.
   * O resultado completo continua indo para `agent_tool_calls`.
   */
  evidencePack?: boolean;
  /**
   * Ferramenta canônica já executada deterministicamente pelo planner. A
   * evidência entra no prompt pronta e o loop começa sem gastar uma chamada
   * de modelo só para escolher a tool.
   */
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
  /** Telemetria de eficiência (`nino_efficiency.v1`). */
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
  const tools = openAIToolDefinitions(opts.allowedTools);

  // Histórico híbrido (`context_budget.v1`): os 4 turnos recentes vão crus
  // (800 chars) porque é neles que a continuidade vive; o restante entra
  // resumido. Antes, 20 turnos × 2.000 chars respondiam por 2–6k tokens de
  // prompt por passo do loop — e cada passo reenvia tudo.
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

  // Evidência pré-apurada: a tool canônica já rodou deterministicamente, então
  // o modelo recebe os fatos prontos e não gasta um passo para pedi-los.
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

  try {
    for (let step = 0; step < maxSteps; step++) {
      const body: any = {
        model: opts.model,
        messages,
        tools,
        tool_choice: step === 0 && opts.requiredTool && preBlocks.length === 0
          ? { type: "function", function: { name: opts.requiredTool } }
          : "auto",
        temperature: opts.temperature ?? 0.2,
      };
      // GPT-5.6 family requires reasoning_effort=none when using function tools
      if (/^openai\/gpt-5\.6/.test(opts.model)) body.reasoning_effort = "none";

      llmCalls++;
      const callStarted=Date.now();
      let resp: any;
      try {
        resp = await chatCompletion(body, controller.signal);
      } catch (error) {
        const status=Number((error as any)?.status ?? 0) || null;
        await recordAiUsage(toolCtx.sb,{workload:"AGENT_CONVERSATION",function_name:"agent-run",operation:"chat_step",user_id:toolCtx.user_id,model:opts.model,operation_type:"chat",success:false,http_status:status,error_code:status?`gateway_${status}`:"gateway_error",latency_ms:Date.now()-callStarted,batch_size:1,unique_items:1,metadata:{conversation_id:toolCtx.conversation_id,step}});
        throw error;
      }
      const choice = resp.choices?.[0];
      const usage = resp.usage ?? {};
      const stepTokensIn=Number(usage.prompt_tokens ?? 0);
      const stepTokensOut=Number(usage.completion_tokens ?? 0);
      tokensIn += stepTokensIn;
      tokensOut += stepTokensOut;
      await recordAiUsage(toolCtx.sb,{workload:"AGENT_CONVERSATION",function_name:"agent-run",operation:"chat_step",user_id:toolCtx.user_id,model:opts.model,operation_type:"chat",input_tokens:stepTokensIn,output_tokens:stepTokensOut,success:true,latency_ms:Date.now()-callStarted,batch_size:1,unique_items:1,metadata:{conversation_id:toolCtx.conversation_id,step,tool_count:(resp.choices?.[0]?.message?.tool_calls??[]).length}});
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
          error: toolResult.ok ? null : (toolResult as { error?: string }).error,
        });
        // Orçamento de resultado (`nino_efficiency.v1`): o completo vai para
        // auditoria; o modelo recebe só a evidência comprimida.
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
  // Redact any accidental token/api-key patterns
  return s.replace(/[a-zA-Z0-9._-]{24,}/g, "…");
}
