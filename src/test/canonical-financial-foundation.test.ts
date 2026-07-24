import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const foundation = readFileSync(
  resolve(root, "supabase/migrations/20260724010707_f322a33f-eeeb-47f2-974d-7b77e0d8fe9b.sql"),
  "utf8",
);
const split = readFileSync(
  resolve(root, "supabase/migrations/20260724010732_80d0d29b-7374-4833-9c2d-16a070d787c5.sql"),
  "utf8",
);
const hardening = readFileSync(
  resolve(root, "supabase/migrations/20260724023000_canonical_finance_and_split_delivery_hardening.sql"),
  "utf8",
);
const splitPage = readFileSync(resolve(root, "src/pages/DivisaoDoRoleNova.tsx"), "utf8");

describe("canonical financial foundation", () => {
  it("keeps transactions as source and creates additive facts, snapshots and rollout controls", () => {
    expect(foundation).toContain("financial_daily_facts");
    expect(foundation).toContain("financial_daily_category_facts");
    expect(foundation).toContain("financial_current_snapshots");
    expect(foundation).toContain("financial_metric_diffs");
    expect(foundation).toContain("financial_backfill_checkpoints");
    expect(foundation).toContain("use_canonical_financial_snapshot");
    expect(foundation).not.toMatch(/\bDELETE\s+FROM\s+public\.transactions\b/i);
    expect(foundation).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("defines one reusable behavioral-consumption formula", () => {
    expect(hardening).toContain("is_behavioral_consumption");
    for (const excluded of [
      "internal_transfer",
      "investment_application",
      "investment_redemption",
      "investment_yield",
      "loan_proceeds",
    ]) {
      expect(hardening).toContain(excluded);
    }
    expect(hardening).toContain("financial_daily.v2");
    expect(hardening).toContain("THEN -t.amount");
  });

  it("ships deterministic premium report templates", () => {
    expect(hardening).toContain("'chart', 'line'");
    expect(hardening).toContain("'curve', 'monotone'");
    expect(hardening).toContain("'weekly_one_page'");
    expect(hardening).toContain("'formula_version', 'financial_daily.v2'");
  });

  it("keeps only migration versions already registered by Lovable", () => {
    expect(existsSync(resolve(root, "supabase/migrations/20260723234500_canonical_financial_foundation.sql"))).toBe(false);
    expect(existsSync(resolve(root, "supabase/migrations/20260723235000_split_delivery_diagnostics.sql"))).toBe(false);
  });
});

describe("split reminder delivery", () => {
  it("uses a bounded dispatch and gives truthful delivery feedback", () => {
    expect(splitPage).toContain("dispatchSplitReminders");
    expect(splitPage).not.toContain(
      'supabase.functions.invoke("split-reminders-dispatch", { body: { owner_only: true } }).catch(() => undefined)',
    );
    expect(splitPage).toContain("continua em segundo plano");
    expect(splitPage).toContain("outbound_failed");
  });

  it("supports new and legacy cron secret names and records missing configuration", () => {
    expect(split).toContain("'meunino_cron_secret','nocontrole_cron_secret'");
    expect(split).toContain("cron_secret_missing");
    expect(split).toContain("split_delivery_diagnosis");
  });

  it("removes the artificial delivery window without weakening queue leases", () => {
    expect(hardening).toContain("A Divisão do Rolê opera 24/7");
    expect(hardening).toContain("FOR UPDATE SKIP LOCKED");
    expect(hardening).toContain("lease_expires_at = now() + interval '2 minutes'");
    expect(hardening).toContain("'reminder', now()");
    expect(hardening).not.toContain("make_timestamptz");
    expect(hardening).not.toContain("local_time < time '08:00'");
    expect(hardening).not.toContain("local_time >= time '22:00'");
  });
});
