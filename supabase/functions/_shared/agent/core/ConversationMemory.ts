// ConversationMemory (`nino_brain.v2`) — estado conversacional persistente.
//
// Separado da verdade financeira: aqui vivem apenas PONTEIROS de conversa
// (tópico, intenção, categoria/estabelecimento/período ativos, slots pendentes).
// Nenhum valor financeiro é tratado como fato: quando um número aparece, ele
// vem do resultado da ferramenta canônica e é armazenado apenas como contexto
// da última consulta (`last_tool_context`).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getState, patchState } from "./StateManager.ts";
import type { ConversationExpectation } from "./ConversationExpectation.ts";
import type { PendingConversationAction } from "./ContinuationContract.ts";

export type ConversationMemory = {
  current_topic: string | null;
  previous_intent: string | null;
  active_category: string | null;
  active_merchant: string | null;
  active_period: { from: string; to: string; label?: string | null } | null;
  comparison_period: { from: string; to: string } | null;
  pending_action: string | null;
  pending_slots: string[];
  /** Pergunta que o Nino fez e ainda espera resposta (TTL próprio). */
  awaiting: ConversationExpectation | null;
  /** Análise que o Nino OFERECEU fazer e aguarda um "ok" (nino_continuation.v1). */
  pending_conversation_action: PendingConversationAction | null;
  last_tool_context: { tool: string; period?: { from: string; to: string } | null } | null;
  conversation_summary: string | null;
  updated_at: string;
};

/** Memória conversacional expira em 6h para não contaminar turnos futuros. */
export const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

export function emptyMemory(): ConversationMemory {
  return {
    current_topic: null, previous_intent: null, active_category: null, active_merchant: null,
    active_period: null, comparison_period: null, pending_action: null, pending_slots: [],
    awaiting: null, pending_conversation_action: null,
    last_tool_context: null, conversation_summary: null, updated_at: new Date(0).toISOString(),
  };
}


export function isExpired(memory: ConversationMemory | null, now: Date = new Date()): boolean {
  if (!memory?.updated_at) return true;
  const at = Date.parse(memory.updated_at);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > MEMORY_TTL_MS;
}

export async function loadConversationMemory(
  sb: SupabaseClient,
  sessionId: string | null,
  now: Date = new Date(),
): Promise<ConversationMemory | null> {
  if (!sessionId) return null;
  const state = await getState(sb, sessionId);
  const memory = (state as any)?.conversation as ConversationMemory | undefined;
  if (!memory) return null;
  if (isExpired(memory, now)) return null;
  return { ...emptyMemory(), ...memory };
}

export async function saveConversationMemory(
  sb: SupabaseClient,
  sessionId: string | null,
  patch: Partial<ConversationMemory>,
  now: Date = new Date(),
): Promise<ConversationMemory | null> {
  if (!sessionId) return null;
  const current = (await loadConversationMemory(sb, sessionId, now)) ?? emptyMemory();
  const next: ConversationMemory = {
    ...current,
    ...patch,
    updated_at: now.toISOString(),
  };
  await patchState(sb, sessionId, { conversation: next });
  return next;
}

export async function clearConversationMemory(sb: SupabaseClient, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await patchState(sb, sessionId, { conversation: emptyMemory() });
}

/** Categoria citada explicitamente na mensagem (nomes canônicos do produto). */
const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/\balimenta[cç][aã]o|comida|restaurante|delivery|ifood\b/i, "Alimentação"],
  [/\btransporte|uber|corrida|combust[ií]vel|gasolina|[oô]nibus|metr[oô]\b/i, "Transporte"],
  [/\bmercado|supermercado|feira\b/i, "Mercado"],
  [/\blazer|divers[aã]o|cinema|bar\b/i, "Lazer"],
  [/\bsa[uú]de|farm[aá]cia|m[eé]dico\b/i, "Saúde"],
  [/\bmoradia|aluguel|condom[ií]nio\b/i, "Moradia"],
  [/\bassinaturas?\b/i, "Assinaturas"],
  [/\beduca[cç][aã]o|curso|faculdade\b/i, "Educação"],
  [/\bseguros?\b/i, "Seguros"],
];

export function detectCategory(text: string): string | null {
  for (const [rx, name] of CATEGORY_HINTS) if (rx.test(String(text ?? ""))) return name;
  return null;
}

/** Retomada explícita de assunto: "voltando para alimentação", "sobre transporte". */
const RESUME_RX = /\b(voltando|retomando|sobre|falando de|em rela[cç][aã]o a)\b/i;

export function wantsTopicResume(text: string): boolean {
  return RESUME_RX.test(String(text ?? ""));
}

/**
 * Enriquecimento determinístico do texto do turno com o tópico ativo da
 * memória. Só age quando a mensagem atual não traz assunto próprio (follow-up)
 * ou quando o usuário pede explicitamente para retomar um assunto.
 */
export function applyMemoryToText(
  text: string,
  memory: ConversationMemory | null,
  opts: { followup: boolean },
): { text: string; used: boolean } {
  const raw = String(text ?? "").trim();
  if (!memory) return { text: raw, used: false };
  const ownCategory = detectCategory(raw);
  const resume = wantsTopicResume(raw);
  const shouldInherit = (opts.followup || resume) && !ownCategory;
  if (!shouldInherit) return { text: raw, used: false };
  const topic = memory.active_category ?? memory.current_topic;
  if (!topic) return { text: raw, used: false };
  return { text: `${raw} (assunto: ${topic})`, used: true };
}

