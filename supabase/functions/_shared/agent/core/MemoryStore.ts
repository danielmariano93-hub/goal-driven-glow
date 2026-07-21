// MemoryStore — persistent facts learned about the user.
// Everything is scoped by user_id (RLS on service key too, we filter).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type MemoryKind =
  | "favorite_category" | "frequent_merchant" | "recurring_bill"
  | "preferred_card" | "favorite_investment" | "goal"
  | "spending_pattern" | "habit" | "language" | "alias"
  | "correction" | "response_preference" | "context";

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
    expires_at: rec.expires_at ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data } = await sb.from("agent_memory").upsert(payload, { onConflict: "user_id,kind,key" })
    .select("*").maybeSingle();
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
  await sb.rpc("noop", {}).then(() => null).catch(() => null); // ignore
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
  const { count } = await q.select("id", { count: "exact", head: true });
  return count ?? 0;
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
