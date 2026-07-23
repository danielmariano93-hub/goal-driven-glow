import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const foundation = readFileSync(
  resolve(root, "supabase/migrations/20260723234500_canonical_financial_foundation.sql"),
  "utf8",
);
const split = readFileSync(
  resolve(root, "supabase/migrations/20260723235000_split_delivery_diagnostics.sql"),
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
    expect(foundation).toContain("is_behavioral_consumption");
    for (const excluded of [
      "transfer",
      "investment_apply",
      "investment_redeem",
      "card_payment",
      "refund",
      "informational",
    ]) {
      expect(foundation).toContain(`'${excluded}'`);
    }
  });

  it("ships deterministic premium report templates", () => {
    expect(foundation).toContain("'chart','line'");
    expect(foundation).toContain("'curve','monotone'");
    expect(foundation).toContain("'weekly_one_page'");
    expect(foundation).toContain("'formula_version','financial_daily.v1'");
  });
});

describe("split reminder delivery", () => {
  it("does not swallow immediate-dispatch failures after creating a split", () => {
    expect(splitPage).toContain("await supabase.functions.invoke");
    expect(splitPage).not.toContain(
      'supabase.functions.invoke("split-reminders-dispatch", { body: { owner_only: true } }).catch(() => undefined)',
    );
    expect(splitPage).toContain("o convite ainda não foi entregue");
  });

  it("supports new and legacy cron secret names and records missing configuration", () => {
    expect(split).toContain("'meunino_cron_secret','nocontrole_cron_secret'");
    expect(split).toContain("cron_secret_missing");
    expect(split).toContain("split_delivery_diagnosis");
  });
});
