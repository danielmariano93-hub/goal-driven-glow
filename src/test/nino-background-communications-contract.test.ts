import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260918214500_restore_background_communications.sql",
  "utf8",
);
const deliveryRepair = readFileSync(
  "supabase/migrations/20260919233000_repair_proactive_delivery_contract.sql",
  "utf8",
);
const schemaContract = readFileSync(
  "supabase/functions/_shared/intelligence/schemaContract.ts",
  "utf8",
);

describe("Nino background communication contract", () => {
  it("lets internal cron reach handlers that authenticate x-cron-secret themselves", () => {
    expect(config).toMatch(/\[functions\.insights-generate\][\s\S]*?verify_jwt = false/);
    expect(config).toMatch(/\[functions\.financial-reports-generate\][\s\S]*?verify_jwt = false/);
  });

  it("restores the proactive preference columns required by production dispatch", () => {
    expect(migration).toContain("max_proactive_per_day smallint not null default 1");
    expect(migration).toContain("muted_proactive_kinds text[] not null default '{}'::text[]");
  });

  it("restores the proactive delivery fields used by dispatch, learning and timing", () => {
    for (const column of [
      "interacted_at",
      "action_taken",
      "block_context",
      "false_positive",
      "user_feedback",
    ]) {
      expect(deliveryRepair).toContain(`add column if not exists ${column}`);
      expect(schemaContract).toContain(`\"${column}\"`);
    }
    expect(deliveryRepair).toContain("notify pgrst, 'reload schema'");
  });

  it("does not build an invalid Bearer header in the insights cron wrapper", () => {
    const fn = migration.slice(migration.indexOf("create or replace function public.insights_generate_tick"));
    expect(fn).toContain("'x-cron-secret',secret_value");
    expect(fn).not.toContain("app.settings.anon_key");
    expect(fn).not.toContain("'Authorization','Bearer '");
  });

  it("keeps category coverage gates only where categories are materially required", () => {
    for (const detector of [
      "small_spend_acceleration",
      "card_cycle_acceleration",
      "expected_recurring_payment",
      "upcoming_cash_pressure",
    ]) {
      expect(migration).toContain(`'${detector}'`);
    }
    expect(migration).toContain("set min_coverage = 0");
    expect(migration).not.toContain("'weekday_spending_risk',\n  'weekend_spending_risk'");
  });
});
