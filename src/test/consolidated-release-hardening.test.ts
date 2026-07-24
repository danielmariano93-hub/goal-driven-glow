import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  byCategory,
  filterCanonicalReportTransactions,
  groupByMonth,
  type ReportTxn,
} from "@/lib/reports/aggregations";
import { dispatchSplitReminders } from "@/lib/split/dispatch";
import { supabase } from "@/integrations/supabase/client";

function txn(overrides: Partial<ReportTxn> = {}): ReportTxn {
  return {
    id: "t",
    account_id: "a",
    type: "expense",
    status: "confirmed",
    amount: 100,
    occurred_at: "2026-07-24",
    category_name: "Alimentação",
    movement_kind: "transaction",
    ...overrides,
  };
}

describe("canonical reports", () => {
  it("uses only confirmed behavioral movements and nets refunds", () => {
    const rows = [
      txn({ id: "expense", amount: 200 }),
      txn({ id: "refund", type: "income", movement_kind: "refund", amount: 50 }),
      txn({ id: "planned", status: "planned", amount: 999 }),
      txn({ id: "investment", movement_kind: "investment_application", amount: 400 }),
      txn({ id: "bill", settles_card_id: "card", amount: 300 }),
      txn({ id: "loan", type: "income", movement_kind: "loan_proceeds", amount: 1_000 }),
      txn({ id: "income", type: "income", amount: 500, category_name: "Salário" }),
    ];

    const canonical = filterCanonicalReportTransactions(rows);
    expect(canonical.map((row) => row.id)).toEqual(["expense", "refund", "income"]);
    expect(groupByMonth(canonical)).toEqual([
      { ym: "2026-07", income: 500, expense: 150, net: 350 },
    ]);
    expect(byCategory(canonical)).toEqual([
      {
        category: "Alimentação",
        total: 150,
        count: 1,
        average: 150,
        percentOfExpenses: 100,
        rank: 1,
      },
    ]);
  });
});

describe("split dispatch UX", () => {
  it("reports target delivery states and keeps retries idempotent per job", () => {
    const dispatcher = readFileSync(
      resolve(process.cwd(), "supabase/functions/split-reminders-dispatch/index.ts"),
      "utf8",
    );
    expect(dispatcher).toContain("outbound_sent");
    expect(dispatcher).toContain("outbound_pending");
    expect(dispatcher).toContain("outbound_failed");
    expect(dispatcher).toContain("${j.id}");
    expect(dispatcher).not.toContain("${dayKey}");
  });

  it("stops blocking the screen when the backend is slow", async () => {
    vi.spyOn(supabase.functions, "invoke").mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    await expect(dispatchSplitReminders(1)).resolves.toEqual({ status: "timeout" });
  });
});
