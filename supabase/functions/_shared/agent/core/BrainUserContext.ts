// Durable, non-financial relationship context for ConversationBrain.
//
// ConversationMemory is intentionally short-lived (topic pointers, 6h TTL).
// This layer brings stable preferences/corrections into a new session without
// ever using memory as a source of volatile financial truth.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recall, type MemoryFact, type MemoryKind } from "./MemoryStore.ts";
import { loadPreferences, type Preferences } from "./PersonalizationEngine.ts";

export const BRAIN_MEMORY_KINDS: readonly MemoryKind[] = [
  "response_preference",
  "advisor_preference",
  "language",
  "alias",
  "correction",
  "context",
  "habit",
];

const VOLATILE_KEY_RX =
  /(^|_)(amount|valor|total|saldo|balance|available|spent|gasto|income|receita|net_worth|patrimonio|fatura|debt|divida|forecast|projection|previsao)(_|$)/i;

/**
 * Relationship memory is useful for continuity, but it is not allowed to grow
 * into a second system prompt. Keep the highest-signal facts and trim verbose
 * free text; financial truth is never sourced from this layer anyway.
 */
function sanitizeMemoryValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeMemoryValue(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 320);
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (VOLATILE_KEY_RX.test(key)) continue;
    const safe = sanitizeMemoryValue(child, depth + 1);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

export function serializeBrainUserContext(
  preferences: Preferences,
  facts: MemoryFact[],
  maxChars = 3_500,
): string {
  const durable = (facts ?? [])
    .filter((fact) =>
      BRAIN_MEMORY_KINDS.includes(fact.kind)
      && (fact.source === "user" || fact.source === "correction" || Number(fact.confidence ?? 0) >= 0.7)
    )
    // Explicit user/correction memory outranks inferred facts, even if an
    // inferred fact was touched more recently. Otherwise a fresh "prefiro..."
    // can fall outside the context window on memory-heavy accounts.
    .sort((a, b) => {
      const priority = (source: string) => source === "correction" ? 3 : source === "user" ? 2 : 1;
      const bySource = priority(b.source) - priority(a.source);
      if (bySource) return bySource;
      const byConfidence = Number(b.confidence ?? 0) - Number(a.confidence ?? 0);
      if (byConfidence) return byConfidence;
      return Date.parse(b.updated_at || b.created_at || "1970-01-01")
        - Date.parse(a.updated_at || a.created_at || "1970-01-01");
    })
    .slice(0, 12)
    .map((fact) => ({
      kind: fact.kind,
      key: fact.key,
      value: sanitizeMemoryValue(fact.value),
      source: fact.source,
      confidence: Number(fact.confidence ?? 0),
    }));

  const basePayload = {
    preferences: {
      tone: preferences.tone,
      verbosity: preferences.verbosity,
      explanation_style: preferences.explanation_style,
      example_style: preferences.example_style,
      suggestion_frequency: preferences.suggestion_frequency,
      technical_level: preferences.technical_level,
    },
  };

  // Never cut a serialized JSON string in the middle. The list is already
  // ordered by signal, so drop the lowest-priority tail until the payload fits.
  const limit = Math.max(500, maxChars);
  let selected = durable;
  let serialized = JSON.stringify({ ...basePayload, durable_memory: selected });
  while (serialized.length > limit && selected.length > 0) {
    selected = selected.slice(0, -1);
    serialized = JSON.stringify({ ...basePayload, durable_memory: selected });
  }

  // Preferences alone are intentionally tiny; this fallback makes the contract
  // total even if a future field unexpectedly grows.
  if (serialized.length > limit) {
    return JSON.stringify({ ...basePayload, durable_memory: [] });
  }
  return serialized;
}

export async function loadBrainUserContext(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const [preferences, facts] = await Promise.all([
      loadPreferences(sb, userId),
      recall(sb, userId, { kind: [...BRAIN_MEMORY_KINDS], limit: 50 }),
    ]);
    return serializeBrainUserContext(preferences, facts);
  } catch (error) {
    console.warn("[brain-user-context] load_failed", String(error).slice(0, 180));
    return null;
  }
}
