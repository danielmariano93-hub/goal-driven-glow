import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntradayBankAnchorAdjustments } from "@/lib/engine/intradayCash";

describe("bank_cash_truth.v2 — same-day live writes", () => {
  const anchor = {
    account_id: "checking",
    balance_date: "2026-09-19",
    balance: 1300.16,
    status: "confirmed",
    anchor_kind: "bank_confirmed",
    anchor_observed_at: "2026-09-19T14:40:01.000Z", // 11:40:01 São Paulo
  };

  it("aplica despesas registradas depois do instante do extrato", () => {
    const adjusted = applyIntradayBankAnchorAdjustments([anchor], [
      {
        id: "extra",
        account_id: "checking",
        type: "expense",
        status: "confirmed",
        amount: 29.70,
        occurred_at: "2026-09-19",
        posted_at: "2026-09-19",
        posted_at_source: "inferred",
        payment_method: "account",
        created_at: "2026-09-19T19:31:36.951Z",
        origin: "agent",
      },
      {
        id: "grill",
        account_id: "checking",
        type: "expense",
        status: "confirmed",
        amount: 55.80,
        occurred_at: "2026-09-19",
        posted_at: "2026-09-19",
        posted_at_source: "inferred",
        payment_method: "account",
        created_at: "2026-09-19T20:57:13.999Z",
        origin: "agent",
      },
    ]);
    expect(adjusted[0].balance).toBe(1214.66);
    expect(adjusted[0].intraday_adjustment).toBe(-85.5);
  });

  it("não usa o horário de importação como horário bancário", () => {
    const adjusted = applyIntradayBankAnchorAdjustments([anchor], [{
      id: "statement-row",
      account_id: "checking",
      type: "expense",
      status: "confirmed",
      amount: 100,
      occurred_at: "2026-09-19",
      posted_at: "2026-09-19",
      posted_at_source: "statement",
      payment_method: "account",
      created_at: "2026-09-19T22:00:00.000Z",
      origin: "import",
    }]);
    expect(adjusted[0].balance).toBe(1300.16);
  });

  it("mantém comportamento conservador quando o instante da âncora é desconhecido", () => {
    const { anchor_observed_at: _ignored, ...dateOnlyAnchor } = anchor;
    const adjusted = applyIntradayBankAnchorAdjustments([dateOnlyAnchor], [{
      id: "live",
      account_id: "checking",
      type: "expense",
      status: "confirmed",
      amount: 50,
      occurred_at: "2026-09-19",
      created_at: "2026-09-19T20:00:00.000Z",
      origin: "agent",
    }]);
    expect(adjusted[0].balance).toBe(1300.16);
  });
});

describe("realtime financial indicators — propagation contract", () => {
  const hook = fs.readFileSync("src/lib/hooks/useFinancialSnapshot.ts", "utf8");
  const sync = fs.readFileSync("src/components/finance/FinancialRealtimeSync.tsx", "utf8");
  const keys = fs.readFileSync("src/lib/db/queryKeys.ts", "utf8");
  const home = fs.readFileSync("supabase/functions/home-snapshot/index.ts", "utf8");
  const pulse = fs.readFileSync("supabase/functions/pulse-compute/index.ts", "utf8");

  it("não serve snapshot antigo após mudança do ledger", () => {
    expect(hook).toContain('normalized.freshness === "stale_recomputing"');
    expect(hook).toContain("invokeHomeSnapshot(period, today, true)");
    expect(hook).toContain("force_refresh: forceRefresh");
  });

  it("propaga a versão do ledger rapidamente para todas as superfícies derivadas", () => {
    expect(sync).toContain('table: "financial_ledger_versions"');
    expect(sync).toContain("}, 400)");
    for (const key of ["qk.home", "qk.pulse", "qk.assistantTip", "qk.insights", "qk.financialSnapshot", "qk.advisorPerformance", "qk.homeSnapshot", "qk.performanceDetail"]) {
      expect(keys).toContain(key);
    }
  });

  it("usa a mesma correção intraday na Home e no Pulso", () => {
    expect(home).toContain("applyIntradayBankAnchorAdjustments");
    expect(home).toContain("anchor_observed_at");
    expect(pulse).toContain("applyIntradayBankAnchorAdjustments");
    expect(pulse).toContain("anchor_observed_at");
  });
});
