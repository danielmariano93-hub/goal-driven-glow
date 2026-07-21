// ProactiveEngine — scans a user and creates pending_proactive_suggestions.
// Does NOT dispatch messages. NotificationDispatcher.ts is the plug point.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadProfile } from "./UserProfile.ts";
import { runAllDetectors, rank, type Insight, type DetectorCtx } from "./InsightsEngine.ts";

export type ProactiveSuggestion = {
  id?: string;
  user_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  action?: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  channel_ready: "app" | "whatsapp" | "both";
  dedup_key: string;
  expires_at?: string | null;
};

export async function scanUser(sb: SupabaseClient, user_id: string): Promise<ProactiveSuggestion[]> {
  const profile = await loadProfile(sb, user_id);

  const [txResp, goalsResp, recResp] = await Promise.all([
    sb.from("transactions").select("id, amount, description, category_id, occurred_at, type, movement_kind")
      .eq("user_id", user_id)
      .gte("occurred_at", new Date(Date.now() - 45 * 86400000).toISOString())
      .limit(1000),
    sb.from("goals").select("id, name, target_amount, target_date").eq("user_id", user_id),
    sb.from("recurring_occurrences")
      .select("id, due_date, status, recurring_rules(description, amount)")
      .eq("user_id", user_id)
      .gte("due_date", new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10))
      .lte("due_date", new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10))
      .limit(50),
  ]);

  // Goal contributions (sum per goal)
  const goalIds = ((goalsResp.data as any[] | null) ?? []).map(g => g.id);
  let contribByGoal = new Map<string, number>();
  if (goalIds.length > 0) {
    const { data: contribs } = await sb.from("goal_contributions")
      .select("goal_id, amount").in("goal_id", goalIds);
    for (const c of (contribs as any[] | null) ?? []) {
      contribByGoal.set(c.goal_id, (contribByGoal.get(c.goal_id) ?? 0) + Number(c.amount || 0));
    }
  }

  const ctx: DetectorCtx = {
    transactions: ((txResp.data as any[] | null) ?? []).map(t => ({
      id: t.id, amount: Number(t.amount) || 0, description: t.description,
      category_id: t.category_id, occurred_at: t.occurred_at, type: t.type, movement_kind: t.movement_kind,
    })),
    goals: ((goalsResp.data as any[] | null) ?? []).map(g => ({
      id: g.id, name: g.name, target: Number(g.target_amount) || 0,
      current: contribByGoal.get(g.id) ?? 0, deadline: g.target_date,
    })),
    bills: ((recResp.data as any[] | null) ?? []).map(r => ({
      id: r.id, name: r.recurring_rules?.description ?? "Conta", due_date: r.due_date,
      amount: Number(r.recurring_rules?.amount) || 0, paid: r.status === "paid",
    })),
  };

  // Cooldowns: fetch already-open suggestions to avoid duplicates.
  const { data: openSug } = await sb.from("pending_proactive_suggestions")
    .select("dedup_key").eq("user_id", user_id).eq("status", "pending");
  ctx.cooldowns = new Set(((openSug as any[]) ?? []).map(s => s.dedup_key));

  const insights: Insight[] = rank(runAllDetectors(profile, ctx), ctx);

  const suggestions: ProactiveSuggestion[] = insights.slice(0, 8).map(i => ({
    user_id, kind: i.kind, severity: i.severity, title: i.title, body: i.body,
    action: i.action ?? null, evidence: i.evidence,
    channel_ready: i.severity === "critical" ? "both" : "app",
    dedup_key: i.dedup_key,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }));

  if (suggestions.length > 0) {
    await sb.from("pending_proactive_suggestions").upsert(suggestions, { onConflict: "user_id,dedup_key" });
  }
  return suggestions;
}
