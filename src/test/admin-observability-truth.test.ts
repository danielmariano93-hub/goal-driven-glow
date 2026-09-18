import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260918211500_admin_observability_truth.sql", "utf8");
const historyMigration = readFileSync("supabase/migrations/20260918211600_admin_ai_history_truth.sql", "utf8");
const cockpit = readFileSync("src/pages/admin/Cockpit.tsx", "utf8");
const messages = readFileSync("src/lib/admin/messageCenter.ts", "utf8");

describe("admin observability truth", () => {
  it("uses provider ledger for tokens/model latency and agent runs for interactions", () => {
    expect(migration).toContain("admin_ai_ops_snapshot");
    expect(migration).toContain("public.ai_usage_ledger");
    expect(migration).toContain("public.agent_runs");
    expect(migration).toContain("tokens_per_interaction");
    expect(migration).toContain("ai_p95_latency_ms");
    expect(migration).toContain("run_p95_latency_ms");
  });

  it("stops deriving current client activity from stale product_events", () => {
    const evolution = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.admin_v2_daily_evolution"));
    expect(evolution).toContain("activity_source','agent_runs'");
    expect(evolution).not.toContain("event_source='live'");
  });

  it("installs the two admin panels that were missing after cutover", () => {
    expect(migration).toContain("admin_supabase_capacity_snapshot");
    expect(migration).toContain("admin_ai_provider_benchmark");
  });

  it("includes the complete Sao Paulo end date for message queries", () => {
    expect(messages).toContain("23:59:59.999");
    expect(messages).toContain("-03:00");
    expect(messages).toContain("spBoundary(f.to, true)");
  });

  it("puts tokens and latency directly on the overview", () => {
    expect(cockpit).toContain("IA e eficiência");
    expect(cockpit).toContain("Tokens consumidos");
    expect(cockpit).toContain("Tokens / interação");
    expect(cockpit).toContain("Latência IA P50");
    expect(cockpit).toContain("Latência IA P95");
    expect(cockpit).toContain("Tempo total P95");
  });

  it("keeps interaction counts separate from provider calls in detailed history", () => {
    expect(historyMigration).toContain("provider_metric_source','ai_usage_ledger'");
    expect(historyMigration).toContain("interaction_metric_source','agent_runs'");
    expect(historyMigration).toContain("tokens_per_run");
  });
});
