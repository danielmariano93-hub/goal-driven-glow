// Per-workload AI circuit and budget helpers.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AiWorkload } from "./aiUsageLedger.ts";
import { USER_SAFE_MESSAGES } from "./agent/core/UserSafeError.ts";

export type WorkloadBudgetSnapshot = {
  workload: AiWorkload;
  enabled: boolean;
  circuit_status: "open" | "paused";
  paused_reason: string | null;
  calls_last_hour: number;
  calls_today: number;
  estimated_cost_last_hour: number;
  estimated_cost_today: number;
  max_items_per_run: number;
  max_retries_per_evidence: number;
  allowed: boolean;
  block_reason: string | null;
};

export async function getWorkloadBudget(sb: SupabaseClient, workload: AiWorkload): Promise<WorkloadBudgetSnapshot> {
  const { data, error } = await sb.rpc("ai_workload_budget_snapshot", { _workload: workload });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      workload,
      enabled: false,
      circuit_status: "paused",
      paused_reason: "budget_missing",
      calls_last_hour: 0,
      calls_today: 0,
      estimated_cost_last_hour: 0,
      estimated_cost_today: 0,
      max_items_per_run: 1,
      max_retries_per_evidence: 0,
      allowed: false,
      block_reason: "budget_missing",
    };
  }
  return {
    workload,
    enabled: Boolean(row.enabled),
    circuit_status: row.circuit_status === "paused" ? "paused" : "open",
    paused_reason: row.paused_reason ?? null,
    calls_last_hour: Number(row.calls_last_hour ?? 0),
    calls_today: Number(row.calls_today ?? 0),
    estimated_cost_last_hour: Number(row.estimated_cost_last_hour ?? 0),
    estimated_cost_today: Number(row.estimated_cost_today ?? 0),
    max_items_per_run: Number(row.max_items_per_run ?? 1),
    max_retries_per_evidence: Number(row.max_retries_per_evidence ?? 0),
    allowed: Boolean(row.allowed),
    block_reason: row.block_reason ?? null,
  };
}

export async function pauseWorkloadCircuit(
  sb: SupabaseClient,
  workload: AiWorkload,
  reason: string,
  options: { status?: number | null; requires?: "top_up" | "admin_action" | "rate_limit" | "budget" | "operator_action" | null; resumeAfter?: string | null } = {},
): Promise<void> {
  try {
    await sb.from("ai_workload_circuits").upsert({
      workload,
      status: "paused",
      blocked_status: options.status ?? null,
      requires: options.requires ?? "budget",
      reason,
      user_message: USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE,
      paused_at: new Date().toISOString(),
      resume_after: options.resumeAfter ?? null,
      consecutive_failures: 0,
    }, { onConflict: "workload" });
  } catch (error) {
    console.warn("[ai-workload-budget] pause_failed", workload, String(error).slice(0, 240));
  }
}

export async function ensureWorkloadAllowed(sb: SupabaseClient, workload: AiWorkload): Promise<WorkloadBudgetSnapshot> {
  const snapshot = await getWorkloadBudget(sb, workload);
  if (!snapshot.allowed && snapshot.block_reason?.includes("budget")) {
    await pauseWorkloadCircuit(sb, workload, snapshot.block_reason, { requires: "budget" });
  }
  return snapshot;
}
