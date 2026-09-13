// ConversationBrain (`nino_conversation_brain.v1`)
//
// ÚNICA autoridade de significado quando o rollout V2 está ligado.
// O cérebro entende diálogo, continuidade, repair e a intenção de READ/WRITE.
// Ele NÃO calcula dinheiro, NÃO executa tool e NÃO escolhe engine financeira.
// A saída é um Turn Contract pequeno; runtime/IR/engines validam e executam.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { readGatewayUsage, recordAiUsage, recordGatewayCall } from "../../aiUsageLedger.ts";
import { ACTION_KINDS, isActionKind, type ActionIR } from "./ActionIR.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { WriteWorkflow } from "./WriteWorkflowManager.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
export const CONVERSATION_BRAIN_DEADLINE_MS = 12_000;

export const BRAIN_ACTS = [
  "new_request", "follow_up", "repair", "answer", "topic_switch", "conversational",
] as const;
export type BrainAct = typeof BRAIN_ACTS[number];

export const BRAIN_MODES = ["converse", "read", "write", "clarify"] as const;
export type BrainMode = typeof BRAIN_MODES[number];

export type BrainFocus = {
  category: string | null;
  merchant: string | null;
  goal: string | null;
  period_expression: string | null;
};

export type ConversationTurnContract = {
  version: "conversation_turn_contract.v1";
  act: BrainAct;
  mode: BrainMode;
  /** Pergunta/pedido completo após resolver elipse e referência. Nunca contém fatos inventados. */
  canonical_request: string | null;
  /** Follow-up pode herdar foco; tópico novo explícito não. */
  inherit_focus: boolean;
  focus: BrainFocus;
  /** Só existe em WRITE. Ação de domínio; runtime traduz para uma única draft tool. */
  action: ActionIR | null;
  /** Só CONVERSE pode responder sem consultar dado financeiro do usuário. */
  direct_reply: string | null;
  /** Pergunta única quando falta significado/slot indispensável. */
  clarification_question: string | null;
  confidence: number;
};

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

function brainTool() {
  return {
    type: "function",
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
          required: ["category", "merchant", "goal", "period_expression"],
          properties: {
            category: { anyOf: [{ type: "string" }, { type: "null" }] },
            merchant: { anyOf: [{ type: "string" }, { type: "null" }] },
            goal: { anyOf: [{ type: "string" }, { type: "null" }] },
            period_expression: { anyOf: [{ type: "string" }, { type: "null" }] },
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

Exemplos:
- contexto: Alimentação + agosto; usuário: "Quais os estabelecimentos?" => follow_up/read, canonical_request="Quais estabelecimentos compõem meus gastos de Alimentação em agosto?", inherit_focus=true.
- Nino: "Quer que eu detalhe essa oportunidade?"; usuário: "Quero" => answer/read, canonical_request=pedido completo da oferta, nunca emotional_checkin.
- usuário: "Cria uma meta de R$ 5.000 até o fim do ano" => write, action=goal.create, slots target_amount=5000 e target_date_expression="fim do ano".
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

function normalizeContract(raw: any): ConversationTurnContract | null {
  if (!raw || !BRAIN_ACTS.includes(String(raw.act) as BrainAct) || !BRAIN_MODES.includes(String(raw.mode) as BrainMode)) {
    return null;
  }
  const action = raw.action && isActionKind(raw.action.action)
    ? { version: "action_ir.v1" as const, action: raw.action.action, slots: (raw.action.slots ?? {}) as Record<string, unknown> }
    : null;
  const mode = raw.mode as BrainMode;
  if (mode === "write" && !action) return null;
  if (mode === "read" && !String(raw.canonical_request ?? "").trim()) return null;
  if (mode === "clarify" && !String(raw.clarification_question ?? "").trim()) return null;
  return {
    version: "conversation_turn_contract.v1",
    act: raw.act as BrainAct,
    mode,
    canonical_request: raw.canonical_request == null ? null : String(raw.canonical_request).trim(),
    inherit_focus: Boolean(raw.inherit_focus),
    focus: {
      category: raw.focus?.category == null ? null : String(raw.focus.category).trim(),
      merchant: raw.focus?.merchant == null ? null : String(raw.focus.merchant).trim(),
      goal: raw.focus?.goal == null ? null : String(raw.focus.goal).trim(),
      period_expression: raw.focus?.period_expression == null ? null : String(raw.focus.period_expression).trim(),
    },
    action,
    direct_reply: raw.direct_reply == null ? null : String(raw.direct_reply).trim(),
    clarification_question: raw.clarification_question == null ? null : String(raw.clarification_question).trim(),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
  };
}

export function dialogueActsFromContract(contract: ConversationTurnContract): string[] {
  if (contract.act === "repair") return ["repair"];
  if (contract.act === "follow_up" || contract.act === "answer") return ["followup"];
  if (contract.mode === "write") return ["write"];
  if (contract.mode === "converse") return ["conversational"];
  return ["new_query"];
}

export async function interpretConversationTurn(input: {
  text: string;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  model: string;
  sb?: SupabaseClient;
  user_id?: string | null;
  run_id?: string | null;
}): Promise<ConversationBrainOutcome> {
  const started = Date.now();
  const fail = (error: string): ConversationBrainOutcome => ({
    contract: null,
    telemetry: { model: input.model, llm_calls: 1, tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - started, ok: false, error },
  });
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return fail("conversation_brain_llm_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONVERSATION_BRAIN_DEADLINE_MS);
  try {
    const user = [
      statePrompt(input.memory, input.workflow),
      compactHistory(input.history) ? `Histórico relevante:\n${compactHistory(input.history)}` : "",
      `Mensagem atual:\n${input.text}`,
      "Emita somente emit_conversation_turn_contract.",
    ].filter(Boolean).join("\n\n");

    const response = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          { role: "developer", content: SYSTEM },
          { role: "user", content: user },
        ],
        tools: [brainTool()],
        tool_choice: { type: "function", name: "emit_conversation_turn_contract" },
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "concise" },
        include: ["reasoning.encrypted_content"],
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: any = null;
    let functionArguments = "";
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "response.function_call_arguments.delta") functionArguments += String(event.delta ?? "");
        if (event.type === "response.function_call_arguments.done" && event.arguments) functionArguments = String(event.arguments);
        if (event.type === "response.completed") body = event.response ?? body;
      } catch { /* SSE parcial */ }
    }

    if (!response.ok || !body) {
      const error = `conversation_brain_gateway_${response.status || "bad_json"}`;
      if (input.sb) await recordAiUsage(input.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
        user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: input.model,
        success: false, http_status: response.status || null, error_code: error,
        latency_ms: Date.now() - started, reason_for_ai_call: "conversation_brain_v1",
      });
      return fail(error);
    }

    const usage = readGatewayUsage(body);
    if (input.sb) await recordGatewayCall(input.sb, {
      workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
      user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: input.model,
      success: true, latency_ms: Date.now() - started, reason_for_ai_call: "conversation_brain_v1",
      metadata: { contract_version: "conversation_turn_contract.v1" },
    }, body);

    const call = (body?.output ?? []).find((item: any) =>
      item?.type === "function_call" && item?.name === "emit_conversation_turn_contract"
    );
    const rawArguments = functionArguments || String(call?.arguments ?? "");
    if (!rawArguments) return fail("conversation_brain_missing_contract");

    let parsed: any;
    try { parsed = JSON.parse(rawArguments); }
    catch { return fail("conversation_brain_invalid_json"); }
    const contract = normalizeContract(parsed);
    if (!contract) return fail("conversation_brain_contract_invalid");

    return {
      contract,
      telemetry: {
        model: input.model, llm_calls: 1,
        tokens_in: usage.input_tokens, tokens_out: usage.output_tokens,
        latency_ms: Date.now() - started, ok: true, error: null,
      },
    };
  } catch (error) {
    const code = (error as { name?: string })?.name === "AbortError"
      ? "conversation_brain_timeout" : "conversation_brain_error";
    if (input.sb) await recordAiUsage(input.sb, {
      workload: "AGENT_CONVERSATION", function_name: "agent-run", operation: "conversation_brain",
      user_id: input.user_id ?? null, run_id: input.run_id ?? null, model: input.model,
      success: false, error_code: code, latency_ms: Date.now() - started,
      reason_for_ai_call: "conversation_brain_v1",
    });
    return fail(code);
  } finally {
    clearTimeout(timeout);
  }
}
