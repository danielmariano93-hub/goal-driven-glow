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

function sanitizeMemoryValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeMemoryValue(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.slice(0, 500);
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
  maxChars = 6_000,
): string {
  const durable = (facts ?? [])
    .filter((fact) =>
      BRAIN_MEMORY_KINDS.includes(fact.kind)
      && (fact.source === "user" || fact.source === "correction" || Number(fact.confidence ?? 0) >= 0.7)
    )
    .slice(0, 20)
    .map((fact) => ({
      kind: fact.kind,
      key: fact.key,
      value: sanitizeMemoryValue(fact.value),
      source: fact.source,
      confidence: Number(fact.confidence ?? 0),
    }));

  const payload = {
    preferences: {
      tone: preferences.tone,
      verbosity: preferences.verbosity,
      explanation_style: preferences.explanation_style,
      example_style: preferences.example_style,
      suggestion_frequency: preferences.suggestion_frequency,
      technical_level: preferences.technical_level,
    },
    durable_memory: durable,
  };
  return JSON.stringify(payload).slice(0, Math.max(500, maxChars));
}

export async function loadBrainUserContext(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const [preferences, facts] = await Promise.all([
      loadPreferences(sb, userId),
      recall(sb, userId, { kind: [...BRAIN_MEMORY_KINDS], limit: 20 }),
    ]);
    return serializeBrainUserContext(preferences, facts);
  } catch (error) {
    console.warn("[brain-user-context] load_failed", String(error).slice(0, 180));
    return null;
  }
}
