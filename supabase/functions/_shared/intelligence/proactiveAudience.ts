// Bounded audience selector for proactive communications.
// Includes users active outside the assistant so habits, transactions and
// onboarding can trigger communication even without a recent agent_run.
// deno-lint-ignore-file no-explicit-any
type SupabaseClient = any;

export function mergeProactiveAudience(
  sources: Array<Array<{ user_id?: string | null }> | null | undefined>,
  limit = 100,
): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const row of source ?? []) {
      const id = String(row?.user_id ?? "").trim();
      if (id) ids.add(id);
      if (ids.size >= limit) return [...ids];
    }
  }
  return [...ids];
}

export async function selectProactiveUserIds(
  sb: SupabaseClient,
  opts: { limit?: number; activityDays?: number; onboardingDays?: number } = {},
): Promise<string[]> {
  const limit = Math.max(1, Math.min(300, opts.limit ?? 100));
  const activityCutoff = new Date(Date.now() - (opts.activityDays ?? 60) * 86400000).toISOString();
  const onboardingCutoff = new Date(Date.now() - (opts.onboardingDays ?? 45) * 86400000).toISOString();

  const [runs, transactions, recentRegistrations, events] = await Promise.all([
    sb.from("agent_runs").select("user_id").gte("started_at", activityCutoff).limit(1000),
    sb.from("transactions").select("user_id").gte("occurred_at", activityCutoff.slice(0, 10)).limit(1000),
    sb.from("user_pseudonyms").select("user_id").is("detached_at", null)
      .gte("created_at", onboardingCutoff).order("created_at", { ascending: false }).limit(500),
    sb.from("product_events").select("pseudo_id").gte("occurred_at", activityCutoff).limit(1500),
  ]);

  const pseudoIds = Array.from(new Set(((events.data as any[] | null) ?? [])
    .map((row) => String(row.pseudo_id ?? "")).filter(Boolean)));
  let eventUsers: any[] = [];
  if (pseudoIds.length) {
    const mapped = await sb.from("user_pseudonyms").select("user_id")
      .is("detached_at", null).in("pseudo_id", pseudoIds.slice(0, 500));
    eventUsers = (mapped.data as any[] | null) ?? [];
  }

  return mergeProactiveAudience([
    (recentRegistrations.data as any[] | null) ?? [],
    (runs.data as any[] | null) ?? [],
    (transactions.data as any[] | null) ?? [],
    eventUsers,
  ], limit);
}
