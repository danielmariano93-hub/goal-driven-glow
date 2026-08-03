// Bounded audience selector for proactive communications.
// Includes users active outside the assistant so habits, transactions and
// onboarding can trigger communication even without a recent agent_run.
// Excludes test/sandbox accounts, accounts pending deletion and users that
// never finished onboarding, and rotates fairly so the same users are not
// always at the head of the queue.
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

/**
 * Rotação justa: nunca escaneado primeiro, depois o escaneado há mais tempo.
 * Determinística e testável sem banco.
 */
export function rotateProactiveAudience(
  candidates: string[],
  lastScan: Map<string, string | null>,
  limit: number,
): string[] {
  return [...candidates]
    .sort((a, b) => {
      const sa = lastScan.get(a) ?? "";
      const sb = lastScan.get(b) ?? "";
      if (sa === sb) return a < b ? -1 : 1;
      return sa < sb ? -1 : 1;
    })
    .slice(0, Math.max(1, limit));
}

export async function selectProactiveUserIds(
  sb: SupabaseClient,
  opts: {
    limit?: number;
    activityDays?: number;
    onboardingDays?: number;
    includeTestUsers?: boolean;
  } = {},
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

  const candidates = mergeProactiveAudience([
    (recentRegistrations.data as any[] | null) ?? [],
    (runs.data as any[] | null) ?? [],
    (transactions.data as any[] | null) ?? [],
    eventUsers,
  ], 300);
  if (candidates.length === 0) return [];

  // ---- Exclusões duras: teste, sandbox, sem onboarding, exclusão em curso ----
  const [profiles, deletions] = await Promise.all([
    sb.from("profiles").select("id,is_test,is_sandbox,onboarding_completed_at").in("id", candidates),
    sb.from("account_deletion_requests").select("user_id,status")
      .in("user_id", candidates)
      .in("status", ["pending", "approved", "processing"]),
  ]);
  const deleting = new Set(((deletions.data as any[] | null) ?? []).map((row) => String(row.user_id)));
  const eligible: string[] = [];
  for (const row of ((profiles.data as any[] | null) ?? [])) {
    const id = String(row.id);
    if (deleting.has(id)) continue;
    if (!opts.includeTestUsers && (row.is_test === true || row.is_sandbox === true)) continue;
    if (!row.onboarding_completed_at) continue;
    eligible.push(id);
  }
  if (eligible.length === 0) return [];

  const { data: scans } = await sb.from("user_profiles_snapshot")
    .select("user_id,last_proactive_scan_at").in("user_id", eligible);
  const lastScan = new Map<string, string | null>();
  for (const row of ((scans as any[] | null) ?? [])) {
    lastScan.set(String(row.user_id), row.last_proactive_scan_at ?? null);
  }
  return rotateProactiveAudience(eligible, lastScan, limit);
}

/** Marca a rodada para a rotação justa da próxima execução. */
export async function markProactiveScan(sb: SupabaseClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const now = new Date();
  await sb.from("user_profiles_snapshot").update({
    last_proactive_scan_at: now.toISOString(),
    next_proactive_scan_at: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
  }).in("user_id", userIds);
}
