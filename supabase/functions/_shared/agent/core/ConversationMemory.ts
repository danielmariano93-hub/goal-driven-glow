// ConversationMemory (`nino_brain.v3`) — persistent conversational pointers.
//
// Memory is context, never financial truth. For period continuity, evidence-
// backed execution context outranks the generic active_period pointer; this
// prevents a stale/incorrect display period from poisoning the next turn.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getState, patchState } from "./StateManager.ts";
import type { ConversationExpectation } from "./ConversationExpectation.ts";
import type { PendingConversationAction } from "./ContinuationContract.ts";
import type { ReferenceObject } from "./ConversationReferenceStore.ts";

export type ConversationPeriod = { from: string; to: string; label?: string | null };

export type ConversationMemory = {
  current_topic: string | null;
  active_topic_id: string | null;
  previous_intent: string | null;
  active_category: string | null;
  active_merchant: string | null;
  active_period: ConversationPeriod | null;
  comparison_period: { from: string; to: string } | null;
  pending_action: string | null;
  pending_slots: string[];
  awaiting: ConversationExpectation | null;
  pending_conversation_action: PendingConversationAction | null;
  last_tool_context: { tool: string; period?: { from: string; to: string } | null } | null;
  last_analysis: {
    scope: unknown;
    entity_ids: string[];
    entity_labels: string[];
    period: { from: string; to: string } | null;
    comparison_period: { from: string; to: string } | null;
    state: string | null;
    engines: string[];
  } | null;
  conversation_summary: string | null;
  references: ReferenceObject[];
  updated_at: string;
};

export const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

export function emptyMemory(): ConversationMemory {
  return {
    current_topic: null, active_topic_id: null, previous_intent: null, active_category: null, active_merchant: null,
    active_period: null, comparison_period: null, pending_action: null, pending_slots: [],
    awaiting: null, pending_conversation_action: null,
    last_tool_context: null, last_analysis: null, conversation_summary: null, references: [], updated_at: new Date(0).toISOString(),
  };
}

export function isExpired(memory: ConversationMemory | null, now: Date = new Date()): boolean {
  if (!memory?.updated_at) return true;
  const at = Date.parse(memory.updated_at);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > MEMORY_TTL_MS;
}

function validPeriod(period: { from?: string | null; to?: string | null } | null | undefined): period is { from: string; to: string } {
  if (!period?.from || !period?.to) return false;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(period.from) || !/^20\d{2}-\d{2}-\d{2}$/.test(period.to)) return false;
  return period.from <= period.to;
}

export type TrustedMemoryPeriod = {
  period: ConversationPeriod | null;
  source: "last_analysis" | "last_tool_context" | "active_period" | "none";
  evidence_backed: boolean;
};

/**
 * Structured precedence for temporal continuity:
 * executed analysis > executed tool context > generic conversational pointer.
 * The current user turn still outranks all of these in SemanticInterpreterV3.
 */
export function trustedActivePeriod(memory: ConversationMemory | null | undefined): TrustedMemoryPeriod {
  if (!memory) return { period: null, source: "none", evidence_backed: false };
  if (validPeriod(memory.last_analysis?.period)) {
    return {
      period: { ...memory.last_analysis!.period!, label: memory.active_period?.label ?? null },
      source: "last_analysis",
      evidence_backed: true,
    };
  }
  if (validPeriod(memory.last_tool_context?.period)) {
    return {
      period: { ...memory.last_tool_context!.period!, label: memory.active_period?.label ?? null },
      source: "last_tool_context",
      evidence_backed: true,
    };
  }
  if (validPeriod(memory.active_period)) {
    return { period: memory.active_period, source: "active_period", evidence_backed: false };
  }
  return { period: null, source: "none", evidence_backed: false };
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

const RESUME_RX = /\b(voltando|retomando|sobre|falando de|em rela[cç][aã]o a)\b/i;

export function wantsTopicResume(text: string): boolean {
  return RESUME_RX.test(String(text ?? ""));
}

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
