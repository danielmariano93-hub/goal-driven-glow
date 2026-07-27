// Persists explainable behavioral hypotheses and mirrors approved candidates
// into the canonical agent_memory store.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decay, remember } from "./MemoryStore.ts";
import {
  runBehaviorDetectors,
  type BehaviorHypothesisCandidate,
  type BehaviorTransaction,
  type EmotionalCheckin,
  type RecurringOccurrence,
} from "./BehaviorDetectors.ts";

type ExistingHypothesis = {
  id: string;
  dedup_key: string;
  status: "pending" | "confirmed" | "partial" | "rejected" | "expired";
  user_feedback?: string | null;
};

export type BehaviorRefreshResult = {
  detected: number;
  persisted: number;
  remembered: number;
};

export async function refreshBehaviorHypotheses(
  sb: SupabaseClient,
  user_id: string,
): Promise<BehaviorRefreshResult> {
  await decay(sb, user_id).catch(() => 0);

  const from = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const recurringFrom = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const [txResp, checkinResp, recurringResp] = await Promise.all([
    sb.from("transactions")
      .select("id,amount,description,occurred_at,type,movement_kind")
      .eq("user_id", user_id)
      .gte("occurred_at", from)
      .order("occurred_at", { ascending: true })
      .limit(5000),
    sb.from("emotional_checkins")
      .select("occurred_at,mood,trigger_label")
      .eq("user_id", user_id)
      .gte("occurred_at", from)
      .order("occurred_at", { ascending: true })
      .limit(1000),
    sb.from("recurring_occurrences")
      .select("id,due_date,status,recurring_rules(description,amount)")
      .eq("user_id", user_id)
      .gte("due_date", recurringFrom)
      .order("due_date", { ascending: true })
      .limit(500),
  ]);

  const transactions: BehaviorTransaction[] = ((txResp.data as Record<string, unknown>[] | null) ?? [])
    .map((row) => ({
      id: String(row.id),
      amount: Number(row.amount) || 0,
      description: typeof row.description === "string" ? row.description : null,
      occurred_at: String(row.occurred_at),
      type: String(row.type),
      movement_kind: typeof row.movement_kind === "string" ? row.movement_kind : null,
    }));

  const checkins: EmotionalCheckin[] = ((checkinResp.data as Record<string, unknown>[] | null) ?? [])
    .map((row) => ({
      occurred_at: String(row.occurred_at),
      mood: Number(row.mood) || 0,
      trigger_label: typeof row.trigger_label === "string" ? row.trigger_label : null,
    }));

  const recurring: RecurringOccurrence[] = ((recurringResp.data as Record<string, unknown>[] | null) ?? [])
    .map((row) => {
      const rule = (row.recurring_rules ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        due_date: String(row.due_date),
        status: String(row.status),
        description: typeof rule.description === "string" ? rule.description : "Compromisso",
        amount: Number(rule.amount) || 0,
      };
    });

  const detected = runBehaviorDetectors({ transactions, checkins, recurring });
  if (detected.length === 0) {
    await sb.from("behavior_hypotheses")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());
    return { detected: 0, persisted: 0, remembered: 0 };
  }

  const keys = detected.map((candidate) => candidate.dedup_key);
  const { data: existingRows } = await sb.from("behavior_hypotheses")
    .select("id,dedup_key,status,user_feedback")
    .eq("user_id", user_id)
    .in("dedup_key", keys);
  const existing = new Map(
    ((existingRows as ExistingHypothesis[] | null) ?? []).map((row) => [row.dedup_key, row]),
  );

  let persisted = 0;
  let remembered = 0;
  for (const candidate of detected) {
    const current = existing.get(candidate.dedup_key);
    const effectiveStatus = current?.status === "expired"
      ? "pending"
      : current?.status ?? "pending";
    const payload = {
      user_id,
      kind: candidate.kind,
      title: candidate.title,
      explanation: candidate.explanation,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      dedup_key: candidate.dedup_key,
      status: effectiveStatus,
      user_feedback: current?.user_feedback ?? null,
      expires_at: candidate.expires_at,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from("behavior_hypotheses")
      .upsert(payload, { onConflict: "user_id,dedup_key" });
    if (!error) persisted++;

    if (current?.status !== "rejected") {
      const memory = await remember(sb, {
        user_id,
        kind: "behavior_hypothesis",
        key: candidate.dedup_key,
        value: {
          title: candidate.title,
          explanation: candidate.explanation,
          evidence: candidate.evidence,
          status: effectiveStatus,
        },
        confidence: effectiveStatus === "confirmed" ? 1 : candidate.confidence,
        source: effectiveStatus === "confirmed" || effectiveStatus === "partial"
          ? "correction"
          : "inferred",
        expires_at: candidate.expires_at,
      });
      if (memory) remembered++;

      if (candidate.confidence >= 0.72 && effectiveStatus !== "rejected") {
        await sb.from("pending_proactive_suggestions").upsert({
          user_id,
          kind: candidate.kind,
          severity: candidate.confidence >= 0.85 ? "attention" : "info",
          title: candidate.title,
          body: candidate.explanation,
          action: { route: "/app/nino-contexto" },
          evidence: candidate.evidence,
          channel_ready: "app",
          dedup_key: candidate.dedup_key,
          expires_at: candidate.expires_at,
          status: "pending",
        }, {
          onConflict: "user_id,dedup_key",
          ignoreDuplicates: true,
        });
      }
    }
  }

  await sb.from("behavior_hypotheses")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("user_id", user_id)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  return { detected: detected.length, persisted, remembered };
}

export function summarizeBehaviorCandidate(candidate: BehaviorHypothesisCandidate): string {
  return `${candidate.title}: ${candidate.explanation}`;
}
