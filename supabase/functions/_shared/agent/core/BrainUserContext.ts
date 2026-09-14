// BrainUserContext — bounded relationship context for Conversation Brain.
//
// This is NOT a financial truth source. It carries only stable/non-numeric cues
// (preferences, corrections, aliases, habits, recurring subjects and goal names)
// so the Brain can resolve references naturally. Balances, amounts, totals and
// projections must always be re-read from canonical engines.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recall, type MemoryFact, type MemoryKind } from "./MemoryStore.ts";

const CONTEXT_KINDS: MemoryKind[] = [
  "response_preference", "advisor_preference", "correction", "alias", "language",
  "habit", "spending_pattern", "favorite_category", "frequent_merchant", "preferred_card",
  "goal", "context",
];

const MAX_FACTS = 12;
const MAX_CHARS = 2400;

function stringsOnly(value: unknown, depth = 0): string[] {
  if (depth > 2 || value == null) return [];
  if (typeof value === "string") {
    const clean = value.replace(/\s+/g, " ").trim();
    // Never inject strings that are effectively monetary facts.
    if (!clean || /(?:r\$|\$)\s*\d|\b\d+[.,]\d{2}\b/i.test(clean)) return [];
    return [clean.slice(0, 220)];
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((item) => stringsOnly(item, depth + 1)).slice(0, 8);
  if (typeof value === "object") {
    const out: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/amount|saldo|balance|total|income|expense|gasto|receita|fatura|patrim|debt|divida|forecast|projection|valor/i.test(key)) continue;
      out.push(...stringsOnly(nested, depth + 1));
    }
    return out.slice(0, 8);
  }
  return [];
}

function factLine(fact: MemoryFact): string | null {
  const values = stringsOnly(fact.value).filter((v) => v.toLowerCase() !== fact.key.toLowerCase());
  const details = values.length ? ` — ${values.slice(0, 3).join("; ")}` : "";
  const key = String(fact.key ?? "").replace(/\s+/g, " ").trim();
  if (!key) return null;
  return `- ${fact.kind}: ${key}${details}`.slice(0, 420);
}

/**
 * Loads a tiny, relevance-biased advisor context. It is intentionally bounded
 * so it cannot become a second memory system or dominate the current turn.
 */
export async function loadBrainUserContext(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const [facts, goals] = await Promise.all([
      recall(sb, userId, { kind: CONTEXT_KINDS, limit: 30 }),
      sb.from("goals").select("name,status").eq("user_id", userId).limit(8),
    ]);

    const active = facts
      .filter((fact) => !fact.expires_at || new Date(fact.expires_at).getTime() > Date.now())
      .sort((a, b) => {
        const userSource = (x: MemoryFact) => x.source === "correction" ? 3 : x.source === "user" ? 2 : 1;
        return userSource(b) - userSource(a)
          || Number(b.confidence ?? 0) - Number(a.confidence ?? 0)
          || String(b.last_used_at ?? b.updated_at).localeCompare(String(a.last_used_at ?? a.updated_at));
      })
      .slice(0, MAX_FACTS);

    const lines = active.map(factLine).filter((line): line is string => Boolean(line));
    const goalNames = ((goals.data ?? []) as any[])
      .filter((goal) => goal?.name && String(goal.status ?? "active") !== "archived")
      .map((goal) => String(goal.name).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 6);
    if (goalNames.length) lines.push(`- metas referenciáveis por nome: ${goalNames.join(", ")}`);
    if (!lines.length) return null;

    const header = "Contexto persistente do relacionamento (não usar como fonte de números):\n";
    return (header + lines.join("\n")).slice(0, MAX_CHARS);
  } catch (error) {
    console.error("brain_user_context_load_failed", error);
    return null;
  }
}
