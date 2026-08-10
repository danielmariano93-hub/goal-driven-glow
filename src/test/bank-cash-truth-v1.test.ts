import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  balanceAsOfIsConsistent,
  deriveStatementBalanceSemantics,
} from "@/lib/ledger/statementBalance";
import {
  computeAccountBalances,
  cashDateOf,
  hasBankPosting,
  isHardBankAnchor,
  type AccountRow,
  type TransactionRow,
} from "@/lib/engine/facts";

const acc = (id: string, opening = 0): AccountRow => ({
  id, name: id, type: "checking", opening_balance: opening, active: true,
});
const tx = (over: Partial<TransactionRow> & Pick<TransactionRow, "id" | "account_id" | "type" | "amount" | "occurred_at">): TransactionRow => ({
  category_id: null, status: "confirmed", description: null, transfer_group_id: null, ...over,
});

describe("bank_cash_truth.v1 — âncora de saldo", () => {
  it("só ancora com snapshot conferido no banco", () => {
    expect(isHardBankAnchor({ account_id: "a", balance_date: "2026-08-09", balance: 52.63, anchor_kind: "bank_confirmed" })).toBe(true);
    expect(isHardBankAnchor({ account_id: "a", balance_date: "2026-08-09", balance: 589.39, anchor_kind: "inferred_position" })).toBe(false);
    // Legado sem anchor_kind: só vale com proveniência documental.
    expect(isHardBankAnchor({ account_id: "a", balance_date: "2026-08-09", balance: 10, source_document_id: "doc" })).toBe(true);
    expect(isHardBankAnchor({ account_id: "a", balance_date: "2026-08-09", balance: 10 })).toBe(false);
  });

  it("posição inferida não corta o histórico do saldo", () => {
    const accounts = [acc("a", 0)];
    const txs: TransactionRow[] = [
      tx({ id: "1", account_id: "a", type: "income", amount: 100, occurred_at: "2026-08-01" }),
      tx({ id: "2", account_id: "a", type: "expense", amount: 30, occurred_at: "2026-08-05" }),
    ];
    const inferred = computeAccountBalances(accounts, txs, [
      { account_id: "a", balance_date: "2026-08-03", balance: 999, anchor_kind: "inferred_position" },
    ]);
    expect(inferred.a).toBe(70);

    const confirmed = computeAccountBalances(accounts, txs, [
      { account_id: "a", balance_date: "2026-08-03", balance: 100, anchor_kind: "bank_confirmed", source_document_id: "doc" },
    ]);
    expect(confirmed.a).toBe(70);
  });
});

describe("bank_cash_truth.v1 — data de caixa", () => {
  it("posted_at inferido não tem autoridade bancária", () => {
    expect(hasBankPosting({ posted_at: "2026-08-10", posted_at_source: "inferred" })).toBe(false);
    expect(hasBankPosting({ posted_at: "2026-08-10", posted_at_source: "statement" })).toBe(true);
    expect(cashDateOf({ posted_at: "2026-08-10", posted_at_source: "inferred", occurred_at: "2026-08-03" })).toBe("2026-08-03");
    expect(cashDateOf({ posted_at: "2026-08-10", posted_at_source: "statement", occurred_at: "2026-08-03" })).toBe("2026-08-10");
  });
});

describe("bank_cash_truth.v1 — semântica de saldo do extrato", () => {
  it("saldo do cabeçalho vale no fim do período, não na data declarada", () => {
    const s = deriveStatementBalanceSemantics({
      closing_balance: 52.63,
      balance_date: "2026-08-03",
      period_start: "2026-08-01",
      period_end: "2026-08-09",
      item_dates: ["2026-08-03", "2026-08-08", "2026-08-09"],
    });
    expect(s.balance_source).toBe("header_current");
    expect(s.balance_as_of).toBe("2026-08-09");
  });

  it("saldo do dia posterior aos movimentos mantém a data declarada", () => {
    const s = deriveStatementBalanceSemantics({
      closing_balance: 52.63,
      balance_date: "2026-08-09",
      period_start: "2026-08-01",
      period_end: "2026-08-09",
      item_dates: ["2026-08-03", "2026-08-09"],
    });
    expect(s.balance_source).toBe("day_line");
    expect(s.balance_as_of).toBe("2026-08-09");
  });

  it("sem saldo informado não cria âncora", () => {
    const s = deriveStatementBalanceSemantics({
      closing_balance: null, balance_date: null, period_start: null, period_end: null, item_dates: [],
    });
    expect(s.balance_source).toBeNull();
    expect(s.balance_as_of).toBeNull();
  });

  it("guard impede conciliar antes dos movimentos", () => {
    expect(balanceAsOfIsConsistent("2026-08-03", "2026-08-09")).toBe(false);
    expect(balanceAsOfIsConsistent("2026-08-09", "2026-08-09")).toBe(true);
    expect(balanceAsOfIsConsistent(null, "2026-08-09")).toBe(false);
  });

  it("mantém o módulo espelhado nas edge functions", () => {
    const app = fs.readFileSync("src/lib/ledger/statementBalance.ts", "utf8");
    const edge = fs.readFileSync("supabase/functions/_shared/ledger/statementBalance.ts", "utf8");
    expect(edge).toBe(app);
  });
});

describe("bank_cash_truth.v1 — ingestão e dedupe", () => {
  it("extrato preserva linhas idênticas e grava identidade de linha", () => {
    const src = fs.readFileSync("supabase/functions/assistant-ingest-document/index.ts", "utf8");
    expect(src).toContain("const collapseIdenticalLines = documentKind !== \"statement\"");
    expect(src).toContain("source_line_index: globalIdx");
    expect(src).toContain("line_fingerprint");
    expect(src).toContain("deriveStatementBalanceSemantics");
    expect(src).toContain("buildMerchantResolver");
  });

  it("dedupe usa identidade econômica e ignora supersedidos", () => {
    const src = fs.readFileSync("supabase/functions/_shared/import/dedupe.ts", "utf8");
    expect(src).toContain("MerchantResolver");
    expect(src).toContain("!== \"superseded\"");
  });
});
