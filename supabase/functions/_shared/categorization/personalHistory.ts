// Verdade pessoal por histórico (`categorization_truth.v2`).
// -----------------------------------------------------------
// O motor V2 só confia em preferências materializadas por merchant, mas o
// usuário pode ter anos de lançamentos já categorizados sem nenhuma preferência
// gravada (caso Turbi/Lovable/Eventim). Este módulo deriva a categoria dominante
// desses lançamentos CONFIRMADOS e materializa a preferência, mantendo o custo
// baixo: a busca é limitada aos estabelecimentos do documento em questão.
import { normalizedPattern, storageMerchantKey } from "./normalize.ts";
import type { PersonalPreferenceRow } from "./pipeline.ts";

const LOOKBACK_MONTHS = 24;
const MAX_ROWS = 3000;
const MIN_EVIDENCE = 1;
const MIN_SHARE = 0.6;

type TxRow = {
  description: string | null;
  merchant_name: string | null;
  category_id: string | null;
};

export function derivePreferencesFromRows(
  rows: TxRow[],
  wantedKeys: Set<string>,
): PersonalPreferenceRow[] {
  const tally = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.category_id) continue;
    const key = normalizedPattern(row.merchant_name ?? row.description);
    if (!key || (wantedKeys.size > 0 && !wantedKeys.has(key))) continue;
    const byCategory = tally.get(key) ?? new Map<string, number>();
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + 1);
    tally.set(key, byCategory);
  }
  const out: PersonalPreferenceRow[] = [];
  for (const [key, byCategory] of tally) {
    let bestId: string | null = null;
    let bestCount = 0;
    let total = 0;
    for (const [categoryId, count] of byCategory) {
      total += count;
      if (count > bestCount) { bestCount = count; bestId = categoryId; }
    }
    if (!bestId || bestCount < MIN_EVIDENCE) continue;
    if (total > 0 && bestCount / total < MIN_SHARE) continue; // histórico ambíguo: nada de chute
    out.push({ merchant_key: key, category_id: bestId, evidence_count: bestCount });
  }
  return out;
}

/**
 * Busca o histórico confirmado do próprio usuário para os merchants informados,
 * materializa as preferências encontradas e devolve as linhas para uso imediato.
 */
// deno-lint-ignore no-explicit-any
export async function derivePersonalPreferencesFromHistory(
  sb: any,
  userId: string,
  type: "income" | "expense",
  descriptions: Array<string | null | undefined>,
  options: { persist?: boolean } = {},
): Promise<PersonalPreferenceRow[]> {
  const wantedKeys = new Set(
    descriptions.map((d) => normalizedPattern(d)).filter((k): k is string => !!k),
  );
  if (wantedKeys.size === 0) return [];
  const searchTerms = [...new Set(
    descriptions.map((d) => storageMerchantKey(d).split(" ")[0]).filter((t) => t && t.length >= 3),
  )].slice(0, 40);
  if (searchTerms.length === 0) return [];

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - LOOKBACK_MONTHS);
  const sinceISO = since.toISOString().slice(0, 10);

  const filter = searchTerms
    .map((term) => `description.ilike.%${term}%,merchant_name.ilike.%${term}%`)
    .join(",");

  const { data, error } = await sb
    .from("transactions")
    .select("description, merchant_name, category_id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("status", "confirmed")
    .not("category_id", "is", null)
    .gte("occurred_at", sinceISO)
    .or(filter)
    .limit(MAX_ROWS);
  if (error) return [];

  const derived = derivePreferencesFromRows((data ?? []) as TxRow[], wantedKeys);
  if (derived.length === 0) return [];

  if (options.persist !== false) {
    const { data: cats } = await sb
      .from("categories")
      .select("id, slug, name")
      .in("id", derived.map((d) => d.category_id));
    const slugById = new Map<string, string>();
    for (const c of (cats ?? [])) {
      slugById.set(String(c.id), String(c.slug ?? c.name ?? "").toLowerCase());
    }
    const payload = derived
      .filter((d) => d.category_id && slugById.has(String(d.category_id)))
      .map((d) => ({
        user_id: userId,
        merchant_key: d.merchant_key,
        transaction_type: type,
        category_id: d.category_id,
        category_slug: slugById.get(String(d.category_id)) ?? "",
        evidence_count: Math.max(1, Number(d.evidence_count ?? 1)),
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    if (payload.length > 0) {
      await sb.from("user_merchant_preferences")
        .upsert(payload, { onConflict: "user_id,merchant_key,transaction_type" });
    }
  }

  return derived;
}
