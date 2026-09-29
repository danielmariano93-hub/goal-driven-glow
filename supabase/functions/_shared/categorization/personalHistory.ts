// Verdade pessoal por histórico (`categorization_truth.v2`).
// -----------------------------------------------------------
// O motor V2 só confia em preferências materializadas por merchant, mas o
// usuário pode ter anos de lançamentos já categorizados sem nenhuma preferência
// gravada (caso Turbi/Lovable/Eventim). Este módulo deriva a categoria dominante
// desses lançamentos CONFIRMADOS e materializa a preferência com a MESMA chave
// que o motor vai consultar (`normalizedPattern` da descrição do item), para que
// a herança funcione mesmo quando o extrato acrescenta sufixos ("01/02", cidade).
import { normalizedPattern } from "./normalize.ts";
import type { PersonalPreferenceRow } from "./pipeline.ts";

const LOOKBACK_MONTHS = 24;
const MAX_ROWS = 3000;
const MIN_SHARE = 0.6;
const MIN_BRAND_LEN = 4;

type TxRow = {
  description: string | null;
  merchant_name: string | null;
  category_id: string | null;
};

/** Marca do estabelecimento: primeiro token relevante da chave normalizada. */
export function brandToken(value: string | null | undefined): string {
  const key = normalizedPattern(value);
  if (!key) return "";
  const token = key.split(/\s+/).find((t) => t.length >= MIN_BRAND_LEN && /[a-z]/.test(t));
  return token ?? "";
}

function sameBrand(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Para cada descrição do documento, encontra a categoria dominante do histórico
 * cuja marca coincide, e devolve a preferência já na chave do documento.
 */
export function derivePreferencesFromRows(
  rows: TxRow[],
  descriptions: Array<string | null | undefined>,
): PersonalPreferenceRow[] {
  const wanted = new Map<string, string>(); // key -> brand
  for (const d of descriptions) {
    const key = normalizedPattern(d);
    const brand = brandToken(d);
    if (key && brand && !wanted.has(key)) wanted.set(key, brand);
  }
  if (wanted.size === 0) return [];

  const historyBrands = rows
    .filter((r) => r.category_id)
    .map((r) => ({
      brand: brandToken(r.merchant_name ?? r.description),
      category_id: r.category_id as string,
    }))
    .filter((r) => r.brand);

  const out: PersonalPreferenceRow[] = [];
  for (const [key, brand] of wanted) {
    const tally = new Map<string, number>();
    for (const row of historyBrands) {
      if (!sameBrand(row.brand, brand)) continue;
      tally.set(row.category_id, (tally.get(row.category_id) ?? 0) + 1);
    }
    let bestId: string | null = null;
    let bestCount = 0;
    let total = 0;
    for (const [categoryId, count] of tally) {
      total += count;
      if (count > bestCount) { bestCount = count; bestId = categoryId; }
    }
    if (!bestId || total === 0) continue;
    if (bestCount / total < MIN_SHARE) continue; // histórico ambíguo: nada de chute
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
  const brands = [...new Set(descriptions.map(brandToken).filter(Boolean))].slice(0, 40);
  if (brands.length === 0) return [];

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - LOOKBACK_MONTHS);
  const sinceISO = since.toISOString().slice(0, 10);

  const filter = brands
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

  const derived = derivePreferencesFromRows((data ?? []) as TxRow[], descriptions);
  if (derived.length === 0) return [];

  if (options.persist !== false) {
    const { data: cats } = await sb
      .from("categories")
      .select("id, slug, name")
      .in("id", [...new Set(derived.map((d) => d.category_id))]);
    const slugById = new Map<string, string>();
    for (const c of (cats ?? [])) {
      slugById.set(String(c.id), String(c.slug ?? c.name ?? "").toLowerCase());
    }
    const payload = derived
      .filter((d) => d.category_id && slugById.get(String(d.category_id)))
      .map((d) => ({
        user_id: userId,
        merchant_key: d.merchant_key,
        transaction_type: type,
        category_id: d.category_id,
        category_slug: slugById.get(String(d.category_id)) ?? "",
        evidence_count: Math.max(1, Number(d.evidence_count ?? 1)),
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      .filter((row) => row.merchant_key.length >= 2);
    if (payload.length > 0) {
      await sb.from("user_merchant_preferences")
        .upsert(payload, { onConflict: "user_id,merchant_key,transaction_type" });
    }
  }

  return derived;
}

/**
 * Fontes em que a PESSOA decidiu (ou o dado veio do extrato/documento dela).
 * Regra, conhecimento global, motor e IA ficam de fora: aprender com a própria
 * inferência reforçaria erro sem nenhuma evidência nova.
 */
const HUMAN_SOURCES = new Set(["user", "personal", "history", "import", "legacy", "document_hint", "alias", ""]);
const EXACT_MIN_COUNT = 2;
const EXACT_MIN_SHARE = 0.8;

export type LearnableRow = {
  description: string | null;
  category_id: string | null;
  category_source?: string | null;
  type: "income" | "expense";
};

export type MaterializedPreference = PersonalPreferenceRow & { transaction_type: "income" | "expense" };

/**
 * Histórico → preferência por estabelecimento/favorecido, na MESMA chave que o
 * motor consulta (`normalizedPattern`). Só vira preferência quando a pessoa
 * categorizou o mesmo nome pelo menos 2 vezes e 80% delas na mesma categoria.
 */
export function materializePreferencesFromHistory(rows: LearnableRow[]): MaterializedPreference[] {
  const tally = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.category_id) continue;
    if (!HUMAN_SOURCES.has(String(row.category_source ?? ""))) continue;
    const key = normalizedPattern(row.description);
    if (!key || key.length < 3) continue;
    const bucket = `${row.type}|${key}`;
    const byCategory = tally.get(bucket) ?? new Map<string, number>();
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + 1);
    tally.set(bucket, byCategory);
  }
  const out: MaterializedPreference[] = [];
  for (const [bucket, byCategory] of tally) {
    const [type, key] = bucket.split("|") as ["income" | "expense", string];
    const total = [...byCategory.values()].reduce((sum, n) => sum + n, 0);
    const [categoryId, count] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count < EXACT_MIN_COUNT || count / total < EXACT_MIN_SHARE) continue;
    out.push({ merchant_key: key, category_id: categoryId, evidence_count: count, transaction_type: type });
  }
  return out;
}
