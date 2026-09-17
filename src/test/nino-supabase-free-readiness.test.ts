import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260917130000_supabase_free_readiness_guards.sql",
  "utf8",
);
const cleanup = readFileSync(
  "supabase/scripts/supabase_free_readiness_cleanup.sql",
  "utf8",
);
const board = readFileSync("src/components/admin/SupabaseCapacityBoard.tsx", "utf8");
const page = readFileSync("src/pages/admin/CustoLatencia.tsx", "utf8");

describe("Supabase Free readiness", () => {
  it("stops repeated diagnosis evidence and synthetic status events", () => {
    expect(migration).toContain("nino_diag_evidence_dedupe_guard");
    expect(migration).toContain("NEW.status = 'observed'");
    expect(migration).toContain("OLD.status = 'observed'");
  });

  it("reuses an identical live diagnosis snapshot during the same day", () => {
    expect(migration).toContain("v_current.as_of IS NOT DISTINCT FROM _as_of");
    expect(migration).toContain("v_current.payload IS NOT DISTINCT FROM v_payload");
    expect(migration).toContain("RETURN v_current.id");
  });

  it("keeps cron history bounded without slowing product schedulers", () => {
    expect(migration).toContain("nino-cron-history-retention-7d");
    expect(migration).toContain("DELETE FROM cron.job_run_details");
    expect(migration).not.toContain("nino-intelligence-30m',\n    '0 */2");
  });

  it("preserves a compact audit before deleting legacy category retry noise", () => {
    expect(cleanup).toContain("category_decision_legacy_compaction");
    expect(cleanup).toContain("2026-08-25 16:54:00+00");
    expect(cleanup).toContain("category_classification_attempts");
    expect(cleanup).toContain("transactions t WHERE t.category_decision_id=d.id");
  });

  it("adds capacity visibility to the existing admin cost tab", () => {
    expect(migration).toContain("admin_supabase_capacity_snapshot");
    expect(migration).toContain("public._require_perm('cockpit.read')");
    expect(board).toContain("Capacidade Supabase");
    expect(page).toContain("SupabaseCapacityBoard");
  });
});
