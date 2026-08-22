// MemoryStore — persistent facts learned about the user.
// Everything is scoped by user_id (RLS on service key too, we filter).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type MemoryKind =
  | "favorite_category" | "frequent_merchant" | "recurring_bill"
  | "preferred_card" | "favorite_investment" | "goal"
  | "spending_pattern" | "habit" | "language" | "alias"
  | "correction" | "response_preference" | "context"
  | "behavior_hypothesis" | "decision_log" | "advisor_review"
  | "advisor_preference";

export type MemorySource = "user" | "inferred" | "correction";

export type MemoryRecord = {
  id?: string;
  user_id: string;
  kind: MemoryKind;
  key: string;
  value: Record<string, unknown>;
  confidence?: number;
  source?: MemorySource;
  expires_at?: string | null;
  /** "internal" nunca aparece na tela "O que o Nino sabe sobre mim". */
  visibility?: "user" | "internal";
};

export type MemoryFact = MemoryRecord & {
  id: string;
  confidence: number;
  source: MemorySource;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeKey(k: string): string {
  return String(k ?? "").trim().toLowerCase().slice(0, 120);
}

// ---------------------------------------------------------------------------
// Memória estruturada (`nino_memory.v2`)
//
// Três camadas explícitas. Estado financeiro NÃO é memória: saldo, fatura,
// patrimônio, gastos, receita, metas, dívidas e previsões são sempre relidos
// das fontes canônicas (motores/read models) no turno.
// ---------------------------------------------------------------------------

export type MemoryScope = "semantic" | "episodic";

/** Preferências e fatos estáveis sobre o usuário. */
const SEMANTIC_KINDS: readonly MemoryKind[] = [
  "favorite_category", "frequent_merchant", "preferred_card", "favorite_investment",
  "language", "alias", "response_preference", "advisor_preference", "habit",
  "spending_pattern", "recurring_bill",
];

/** Acontecimentos relevantes da relação/conversa. */
const EPISODIC_KINDS: readonly MemoryKind[] = [
  "correction", "decision_log", "advisor_review", "behavior_hypothesis", "context", "goal",
];

export function scopeOf(kind: MemoryKind): MemoryScope {
  return EPISODIC_KINDS.includes(kind) ? "episodic" : "semantic";
}

export function kindsForScope(scope: MemoryScope): MemoryKind[] {
  return [...(scope === "episodic" ? EPISODIC_KINDS : SEMANTIC_KINDS)];
}

/**
 * Números financeiros nunca viram memória permanente. Se um valor desses
 * aparecer no payload, ele é descartado (o fato fica sem o número e o turno
 * relê a fonte canônica).
 */
const FINANCIAL_VOLATILE_KEYS = new Set([
  "saldo", "balance", "available", "available_today", "net_worth", "patrimonio",
  "patrimônio", "fatura", "invoice_total", "spent", "gasto", "gastos", "income",
  "receita", "revenue", "goal_amount", "debt", "divida", "dívida", "forecast",
  "projection", "previsao", "previsão", "total", "amount_cents", "amount",
]);

export function stripVolatileFinancialState(
  value: Record<string, unknown>,
): { value: Record<string, unknown>; dropped: string[] } {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(value ?? {})) {
    const key = k.toLowerCase();
    const looksFinancial = FINANCIAL_VOLATILE_KEYS.has(key)
      || /(^|_)(saldo|balance|patrimonio|fatura|amount|valor|total)(_|$)/.test(key);
    if (looksFinancial && (typeof v === "number" || typeof v === "bigint")) {
      dropped.push(k);
      continue;
    }
    out[k] = v;
  }
  return { value: out, dropped };
}

export type StructuredFact = {
  user_id: string;
  /** Tipo estruturado: `preference`, `event`, `alias`… */
  type: string;
  topic: string;
  value: unknown;
  kind?: MemoryKind;
  confidence?: number;
  source?: MemorySource;
  visibility?: "user" | "internal";
  expires_at?: string | null;
};

/**
 * Grava um fato ESTRUTURADO (não a conversa inteira). Deduplicação por
 * `kind+key`: o mesmo tópico atualiza o fato existente em vez de criar linhas
 * novas — é isso que impede o crescimento infinito da memória.
 */
export async function rememberStructured(
  sb: SupabaseClient,
  fact: StructuredFact,
): Promise<MemoryFact | null> {
  const kind: MemoryKind = fact.kind
    ?? (fact.type === "preference" ? "response_preference" : "context");
  const payload = stripVolatileFinancialState({
    type: fact.type,
    topic: fact.topic,
    value: fact.value as never,
  } as Record<string, unknown>);
  // O `value` interno também é saneado quando for objeto.
  if (payload.value.value && typeof payload.value.value === "object" && !Array.isArray(payload.value.value)) {
    payload.value.value = stripVolatileFinancialState(
      payload.value.value as Record<string, unknown>,
    ).value;
  }
  return await remember(sb, {
    user_id: fact.user_id,
    kind,
    key: `${fact.type}:${fact.topic}`,
    value: { ...payload.value, scope: scopeOf(kind) },
    confidence: fact.confidence,
    source: fact.source,
    visibility: fact.visibility,
    expires_at: fact.expires_at ?? null,
  });
}


export async function remember(sb: SupabaseClient, rec: MemoryRecord): Promise<MemoryFact | null> {
  const key = normalizeKey(rec.key);
  if (!key || !rec.user_id || !rec.kind) return null;
  const source = rec.source ?? "inferred";

  // Never overwrite a `correction` fact by inference.
  const { data: existing } = await sb.from("agent_memory")
    .select("*").eq("user_id", rec.user_id).eq("kind", rec.kind).eq("key", key).maybeSingle();
  if (existing && (existing as any).source === "correction" && source === "inferred") {
    return existing as MemoryFact;
  }

  const payload = {
    user_id: rec.user_id, kind: rec.kind, key,
    value: rec.value ?? {},
    confidence: Math.max(0, Math.min(1, rec.confidence ?? 0.6)),
    source,
    visibility: rec.visibility ?? "user",
    expires_at: rec.expires_at ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data } = await sb.from("agent_memory").upsert(payload, { onConflict: "user_id,kind,key" })
    .select("*").maybeSingle();
  return (data as MemoryFact | null) ?? null;
}

export async function correctFact(
  sb: SupabaseClient,
  args: {
    user_id: string;
    id: string;
    value: Record<string, unknown>;
    expires_at?: string | null;
  },
): Promise<MemoryFact | null> {
  if (!args.user_id || !args.id || !args.value) return null;
  const { data } = await sb.from("agent_memory")
    .update({
      value: args.value,
      source: "correction",
      confidence: 1,
      expires_at: args.expires_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.id)
    .eq("user_id", args.user_id)
    .select("*")
    .maybeSingle();
  return (data as MemoryFact | null) ?? null;
}

export async function recall(
  sb: SupabaseClient,
  user_id: string,
  opts: { kind?: MemoryKind | MemoryKind[]; key?: string; limit?: number } = {},
): Promise<MemoryFact[]> {
  let q = sb.from("agent_memory").select("*").eq("user_id", user_id);
  if (opts.kind) {
    q = Array.isArray(opts.kind) ? q.in("kind", opts.kind) : q.eq("kind", opts.kind);
  }
  if (opts.key) q = q.eq("key", normalizeKey(opts.key));
  q = q.order("last_used_at", { ascending: false, nullsFirst: false }).limit(opts.limit ?? 25);
  const { data } = await q;
  return ((data as MemoryFact[] | null) ?? []).filter(f => !f.expires_at || new Date(f.expires_at).getTime() > Date.now());
}

export async function touch(sb: SupabaseClient, id: string): Promise<void> {
  await sb.from("agent_memory")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
  // best-effort separate increment
  const { data } = await sb.from("agent_memory").select("use_count").eq("id", id).maybeSingle();
  const next = ((data as any)?.use_count ?? 0) + 1;
  await sb.from("agent_memory").update({ use_count: next }).eq("id", id);
}

export async function forget(sb: SupabaseClient, args: { user_id: string; id?: string; kind?: MemoryKind; key?: string }): Promise<number> {
  let q = sb.from("agent_memory").delete().eq("user_id", args.user_id);
  if (args.id) q = q.eq("id", args.id);
  if (args.kind) q = q.eq("kind", args.kind);
  if (args.key) q = q.eq("key", normalizeKey(args.key));
  const { data } = await q.select("id");
  return Array.isArray(data) ? data.length : 0;
}

/** Merges duplicates that map to the same normalized key. Keeps highest confidence. */
export async function consolidate(sb: SupabaseClient, user_id: string): Promise<number> {
  const { data } = await sb.from("agent_memory").select("*").eq("user_id", user_id);
  const rows = (data as MemoryFact[] | null) ?? [];
  const groups = new Map<string, MemoryFact[]>();
  for (const r of rows) {
    const k = `${r.kind}::${normalizeKey(r.key)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  let merged = 0;
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.confidence - a.confidence) || (b.use_count - a.use_count));
    const keep = list[0];
    const toRemove = list.slice(1).map(r => r.id);
    if (toRemove.length > 0) {
      await sb.from("agent_memory").delete().in("id", toRemove);
      merged += toRemove.length;
      // reinforce confidence a bit
      const conf = Math.min(1, keep.confidence + 0.05 * (list.length - 1));
      await sb.from("agent_memory").update({ confidence: conf }).eq("id", keep.id);
    }
  }
  return merged;
}

/** Decays confidence of unused facts and expires very-low-confidence ones. */
export async function decay(sb: SupabaseClient, user_id: string, opts: { minConfidence?: number; days?: number } = {}): Promise<number> {
  const min = opts.minConfidence ?? 0.1;
  const days = opts.days ?? 60;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data } = await sb.from("agent_memory").select("id, confidence, last_used_at, source")
    .eq("user_id", user_id);
  const rows = (data as any[] | null) ?? [];
  let removed = 0;
  for (const r of rows) {
    if (r.source === "correction" || r.source === "user") continue;
    const stale = !r.last_used_at || r.last_used_at < cutoff;
    if (!stale) continue;
    const next = Math.max(0, Number(r.confidence) - 0.1);
    if (next < min) {
      await sb.from("agent_memory").delete().eq("id", r.id);
      removed++;
    } else {
      await sb.from("agent_memory").update({ confidence: next }).eq("id", r.id);
    }
  }
  // hard-expire
  await sb.from("agent_memory").delete().eq("user_id", user_id)
    .not("expires_at", "is", null).lt("expires_at", new Date().toISOString());
  return removed;
}
