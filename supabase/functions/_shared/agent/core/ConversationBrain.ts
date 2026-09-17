// ConversationBrain (`nino_conversation_brain.v1`)
//
// ÚNICA autoridade de significado quando o rollout V2 está ligado.
// O cérebro entende diálogo, continuidade, repair e intenção de READ/WRITE.
// Ele NÃO calcula dinheiro, NÃO executa tool e NÃO escolhe engine financeira.
// A saída é o contrato puro de ConversationTurnContract.ts.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recordAiUsage, recordGatewayCall } from "../../aiUsageLedger.ts";
import { callStructuredFunction } from "../../ai-structured.ts";
import {
  resolveAiProvider, type AiProviderConfig, type AiProviderName,
} from "../../ai-runtime.ts";
import { ACTION_KINDS } from "./ActionIR.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { WriteWorkflow } from "./WriteWorkflowManager.ts";
import { isEnabled } from "./FeatureFlags.ts";
import {
  BRAIN_ACTS, BRAIN_MODES, normalizeConversationTurnContract,
  type ConversationTurnContract,
} from "./ConversationTurnContract.ts";

export { dialogueActsFromContract } from "./ConversationTurnContract.ts";
export type { ConversationTurnContract } from "./ConversationTurnContract.ts";

export const CONVERSATION_BRAIN_DEADLINE_MS = 12_000;

export type ConversationBrainTelemetry = {
  model: string;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
};

export type ConversationBrainOutcome = {
  contract: ConversationTurnContract | null;
  telemetry: ConversationBrainTelemetry;
};

type HistoryTurn = { role: "user" | "assistant"; content: string; created_at?: string };

type ConversationBrainInput = {
  text: string;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  user_context?: string | null;
  model: string;
  sb?: SupabaseClient;
  user_id?: string | null;
  run_id?: string | null;
  conversation_id?: string | null;
  /** Used only by controlled shadow/evaluation paths. Product routing still comes from resolveAiProvider(). */
  provider_override?: AiProviderConfig | null;
};

function brainTool() {
  return {
    name: "emit_conversation_turn_contract",
    description: "Emite o contrato semântico único do turno. Não executa nenhuma ação.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "act", "mode", "canonical_request", "inherit_focus", "focus", "action",
        "direct_reply", "clarification_question", "confidence",
      ],
      properties: {
        act: { type: "string", enum: [...BRAIN_ACTS] },
        mode: { type: "string", enum: [...BRAIN_MODES] },
        canonical_request: { anyOf: [{ type: "string" }, { type: "null" }] },
        inherit_focus: { type: "boolean" },
        focus: {
          type: "object", additionalProperties: false,
          required: ["category", "merchant", "goal", "period_expression", "period_expressions"],
          properties: {
            category: { anyOf: [{ type: "string" }, { type: "null" }] },
            merchant: { anyOf: [{ type: "string" }, { type: "null" }] },
            goal: { anyOf: [{ type: "string" }, { type: "null" }] },
            period_expression: { anyOf: [{ type: "string" }, { type: "null" }] },
            period_expressions: { type: "array", items: { type: "string" } },
          },
        },
        action: {
          anyOf: [
            { type: "null" },
            {
              type: "object", additionalProperties: false,
              required: ["action", "slots"],
              properties: {
                action: { type: "string", enum: [...ACTION_KINDS] },
                slots: { type: "object", additionalProperties: true },
              },
            },
          ],
        },
        direct_reply: { anyOf: [{ type: "string" }, { type: "null" }] },
        clarification_question: { anyOf: [{ type: "string" }, { type: "null" }] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  } as const;
}

const SYSTEM = `Você é o Conversation Brain do Nino. Você é a ÚNICA autoridade sobre o significado conversacional do turno.
Sua saída é apenas emit_conversation_turn_contract. Você NÃO consulta banco, NÃO calcula dinheiro, NÃO executa tools e NÃO inventa fatos financeiros.

Responsabilidades:
- entender linguagem natural, continuidade, elipse, referência, repair e mudança de assunto;
- decidir se o turno é converse, read, write ou clarify;
- reconstruir canonical_request preservando exatamente o que o usuário quis dizer;
- em write, emitir UMA action de domínio + slots ditos pelo usuário/contexto persistido.

Regras obrigatórias:
1. Resposta curta nunca é classificada no vácuo. "quero", "sim", "isso", "pode" responde primeiro à pergunta/oferta mais recente do Nino ou ao workflow aberto.
2. Follow-up herda foco: "e mês passado?", "quais os estabelecimentos?", "por quê?", "qual deles?" preservam assunto/entidades anteriores salvo override explícito.
3. "não foi isso", "não era isso", "você entendeu errado" = repair. Não é cancelamento automático.
4. Tópico novo exige sinal explícito: pergunta completa nova, domínio/entidade nova, ou "esquece isso/outra coisa".
5. WRITE ambíguo nunca herda silenciosamente uma ação diferente. Se não sabe qual ação, mode=clarify.
6. Em WRITE, action é de domínio; não mencione nomes de functions/tools. Nunca emita duas actions.
7. Em READ, canonical_request deve ser completo o bastante para o Financial IR preservar métrica, filtros, período e granularidade. Não invente datas: mantenha expressões humanas ("mês passado", "últimos 3 meses", "por mês").
8. direct_reply só pode ser usado em mode=converse quando a resposta NÃO depende de saldo, gastos, metas, faturas ou qualquer fato pessoal. Máximo 4 linhas, pt-BR natural.
9. Se faltar informação indispensável para entender o pedido, mode=clarify e faça UMA pergunta curta.
10. Não transforme conselho/hipótese em escrita. "E se eu gastar..." é READ/consulta; "registra/cria/ajusta" é WRITE.
11. Se act=follow_up ou act=answer, inherit_focus=true. Se act=topic_switch, inherit_focus=false.
12. focus.period_expressions lista TODAS as expressões temporais do pedido, na ordem dita ("julho", "agosto"; "março", "abril", "maio"). Um período só => lista com um item. Nunca converta em datas: quem resolve intervalo é o backend.
13. UserContext é contexto de relacionamento (preferências, assuntos recentes, metas citadas). Use para entender referências. Ele NUNCA é fonte de número: valor, saldo e total sempre vêm do motor financeiro.

Exemplos:
- contexto: Alimentação + agosto; usuário: "Quais os estabelecimentos?" => follow_up/read, canonical_request="Quais estabelecimentos compõem meus gastos de Alimentação em agosto?", inherit_focus=true.
- Nino: "Quer que eu detalhe essa oportunidade?"; usuário: "Quero" => answer/read, canonical_request=pedido completo da oferta, nunca emotional_checkin.
- usuário: "Cria uma meta de R$ 5.000 até o fim do ano" => write, action=goal.create, slots target_amount=5000 e target_date_expression="fim do ano".
- usuário: "Quanto gastei em alimentação no mês de julho e agosto?" => new_request/read, focus.category="Alimentação", focus.period_expressions=["julho","agosto"].
- usuário: "Não foi isso que eu pedi" => repair; preserve o foco anterior e corrija a interpretação, não cancele por conta própria.`;

function compactHistory(history: HistoryTurn[]): string {
  return history.slice(-8).map((h) => {
    const who = h.role === "user" ? "Usuário" : "Nino";
    const at = h.created_at ? ` [${h.created_at}]` : "";
    return `${who}${at}: ${String(h.content ?? "").replace(/\s+/g, " ").slice(0, 700)}`;
  }).join("\n");
}

function statePrompt(memory: ConversationMemory | null, workflow: WriteWorkflow | null): string {
  const state = memory ? {
    current_topic: memory.current_topic,
    active_category: memory.active_category,
    active_merchant: memory.active_merchant,
    active_period: memory.active_period,
    comparison_period: memory.comparison_period,
    awaiting: memory.awaiting,
    pending_conversation_action: memory.pending_conversation_action,
    last_analysis: memory.last_analysis,
  } : null;
  const openWrite = workflow ? {
    kind: workflow.kind,
    slots: workflow.slots,
    asked_slot: workflow.asked_slot,
    turns: workflow.turns,
  } : null;
  return `ConversationState:\n${JSON.stringify({ state, open_write_workflow: openWrite })}`;
}

function env(name: string): string {
  return String((globalThis as any).Deno?.env?.get(name) ?? "").trim();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function actionKind(contract: ConversationTurnContract | null): string | null {
  return contract?.action?.action ?? null;
}

async function writeProviderShadowRow(sb: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  try {
    await sb.from("ai_provider_shadow_evaluations").insert(row);
  } catch (error) {
    console.warn("[ai-provider-shadow] telemetry insert failed", error);
  }
}

async function runProviderShadow(args: {
  input: ConversationBrainInput;
  official_contract: ConversationTurnContract;
  official_telemetry: ConversationBrainTelemetry;
  official_provider: AiProviderName;
}): Promise<void> {
  if (!args.input.sb || !args.input.user_id) return;
  if (!await isEnabled("ai_provider_shadow_v1", args.input.user_id)) return;

  const requestedProvider = env("NINO_SHADOW_AI_PROVIDER").toLowerCase();
  const requestedModel = env("NINO_SHADOW_AI_MODEL");
  const baseRow = {
    user_id: args.input.user_id,
    conversation_id: args.input.conversation_id ?? null,
    official_provider: args.official_provider,
    official_model: args.official_telemetry.model,
    official_act: args.official_contract.act,
    official_mode: args.official_contract.mode,
    official_canonical_request: args.official_contract.canonical_request,
    official_focus: args.official_contract.focus,
    official_action: args.official_contract.action,
    official_confidence: args.official_contract.confidence,
    official_latency_ms: args.official_telemetry.latency_ms,
  };

  if (!requestedProvider || !requestedModel || !["groq", "openrouter"].includes(requestedProvider)) {
    await writeProviderShadowRow(args.input.sb, {
      ...baseRow,
      shadow_provider: requestedProvider || "unconfigured",
      shadow_model: requestedModel || "unconfigured",
      status: requestedProvider && requestedModel ? "shadow_error" : "not_configured",
      error_code: requestedProvider && requestedModel ? "unsupported_shadow_provider" : "shadow_provider_not_configured",
    });
    return;
  }

  const shadowProvider = resolveAiProvider(undefined, {
    provider: requestedProvider as AiProviderName,
    model: requestedModel,
  });
  if (!shadowProvider) {
    await writeProviderShadowRow(args.input.sb, {
      ...baseRow,
      shadow_provider: requestedProvider,
      shadow_model: requestedModel,
      status: "not_configured",
      error_code: "shadow_provider_key_missing",
    });
    return;
  }

  const shadow = await interpretConversationTurn({
    text: args.input.text,
    history: args.input.history,
    memory: args.input.memory,
    workflow: args.input.workflow,
    user_context: args.input.user_context,
    model: requestedModel,
    provider_override: shadowProvider,
  });
  const candidate = shadow.contract;

  await writeProviderShadowRow(args.input.sb, {
    ...baseRow,
    shadow_provider: shadowProvider.provider,
    shadow_model: shadow.telemetry.model || requestedModel,
    shadow_act: candidate?.act ?? null,
    shadow_mode: candidate?.mode ?? null,
    shadow_canonical_request: candidate?.canonical_request ?? null,
    shadow_focus: candidate?.focus ?? {},
    shadow_action: candidate?.action ?? null,
    shadow_confidence: candidate?.confidence ?? null,
    same_act: candidate ? candidate.act === args.official_contract.act : null,
    same_mode: candidate ? candidate.mode === args.official_contract.mode : null,
    same_canonical_request: candidate
      ? normalizeText(candidate.canonical_request) === normalizeText(args.official_contract.canonical_request)
      : null,
    same_focus: candidate ? stableJson(candidate.focus) === stableJson(args.official_contract.focus) : null,
    same_action_kind: candidate ? actionKind(candidate) === actionKind(args.official_contract) : null,
    shadow_latency_ms: shadow.telemetry.latency_ms,
    shadow_tokens_in: shadow.telemetry.tokens_in,
    shadow_tokens_out: shadow.telemetry.tokens_out,
    status: candidate ? "ok" : "shadow_error",
    error_code: shadow.telemetry.error ?? null,
  });
}

function scheduleProviderShadow(args: {
  input: ConversationBrainInput;
  official_contract: ConversationTurnContract;
  official_telemetry: ConversationBrainTelemetry;
  official_provider: AiProviderName;
}): void {
  const work = runProviderShadow(args).catch((error) => {
    console.warn("[ai-provider-shadow] evaluation failed", error);
  });
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") edgeRuntime.waitUntil(work);
  else work.catch(() => undefined);
}

export async function interpretConversationTurn(input: ConversationBrainInput): Promise<ConversationBrainOutcome> {
  const started = Date.now();
  const fail = (error: string): ConversationBrainOutcome => ({
    contract: null,
    telemetry: {
      model: input.model, llm_calls: 1, tokens_in: 0, tokens_out: 0,
      latency_ms: Date.now() - started, ok: false, error,
    },
  });

  const provider = input.provider_override ?? resolveAiProvider();
  if (!provider) return fail("conversation_brain_llm_not_configured");
  let requestModel = input.model;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONVERSATION_BRAIN_DEADLINE_MS);
  try {
    const historyText = compactHistory(input.history);
    const user = [
      statePrompt(input.memory, input.workflow),
      input.user_context ? `UserContext:\n${input.user_context}` : "",
      historyText ? `Histórico relevante:\n${historyText}` : "",
      `Mensagem atual:\n${input.text}`,
      "Emita somente emit_conversation_turn_contract.",
    ].filter(Boolean).join("\n\n");

    const structured = await callStructuredFunction({
      provider,
      model: input.model,
      system: SYSTEM,
      user,
      tool: brainTool(),
      signal: controller.signal,
      temperature: 0,
      reasoning_effort: "low",
    });
    requestModel = structured.model;

    if (!structured.ok) {
      const error = structured.error_code === "structured_call_timeout"
        ? "conversation_brain_timeout"
        : structured.status
          ? `conversation_brain_gateway_${structured.status}`
          : "conversation_brain_gateway_error";
      if (input.sb) await recordAiUsage(input.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
        user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: structured.model,
        provider: structured.provider, success: false, http_status: structured.status,
        error_code: error, latency_ms: structured.latency_ms,
        reason_for_ai_call: "conversation_brain_v1",
        metadata: {
          provider: structured.provider,
          transport: "chat_completions_structured",
          upstream_error: structured.error_detail,
        },
      });
      return fail(error);
    }

    if (input.sb) await recordGatewayCall(input.sb, {
      workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
      user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: structured.model,
      provider: structured.provider, success: true, latency_ms: structured.latency_ms,
      reason_for_ai_call: "conversation_brain_v1",
      metadata: {
        contract_version: "conversation_turn_contract.v1",
        provider: structured.provider,
        transport: "chat_completions_structured",
      },
    }, structured.body);

    const rawArguments = structured.arguments;

    let parsed: unknown;
    try { parsed = JSON.parse(rawArguments); }
    catch { return fail("conversation_brain_invalid_json"); }
    const contract = normalizeConversationTurnContract(parsed);
    if (!contract) return fail("conversation_brain_contract_invalid");

    const telemetry: ConversationBrainTelemetry = {
      model: requestModel, llm_calls: 1,
      tokens_in: structured.input_tokens, tokens_out: structured.output_tokens,
      latency_ms: structured.latency_ms, ok: true, error: null,
    };

    if (!input.provider_override && input.sb && input.user_id) {
      scheduleProviderShadow({ input, official_contract: contract, official_telemetry: telemetry, official_provider: provider.provider });
    }

    return { contract, telemetry };
  } catch (error) {
    const code = (error as { name?: string })?.name === "AbortError"
      ? "conversation_brain_timeout" : "conversation_brain_error";
    if (input.sb) await recordAiUsage(input.sb, {
      workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
      user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: requestModel,
      success: false, error_code: code, latency_ms: Date.now() - started,
      reason_for_ai_call: "conversation_brain_v1",
      metadata: { provider: provider.provider },
    });
    return fail(code);
  } finally {
    clearTimeout(timeout);
  }
}
