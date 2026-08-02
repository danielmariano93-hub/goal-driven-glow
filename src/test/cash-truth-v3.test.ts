import { describe, it, expect } from "vitest";
import {
  cashDateOf,
  computeAccountBalances,
  computeTotalCash,
  EXCLUDED_MOVEMENT_KINDS,
  isExternalTransfer,
  type AccountRow,
  type TransactionRow,
  type AccountBalanceSnapshotRow,
} from "@/lib/engine/facts";

const acc: AccountRow[] = [
  { id: "acc-1", name: "Itaú", type: "checking", opening_balance: 0 } as unknown as AccountRow,
];

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: over.id ?? crypto.randomUUID(),
  account_id: "acc-1",
  category_id: null,
  type: "expense",
  status: "confirmed",
  amount: 100,
  occurred_at: "2026-08-01",
  description: "x",
  transfer_group_id: null,
  payment_method: "account",
  ...over,
} as TransactionRow);

describe("finance_contract.v3 — verdade de caixa bancária", () => {
  it("cashDateOf prioriza data bancária, depois competência, depois econômica", () => {
    expect(cashDateOf({ posted_at: "2026-08-03", competence_date: "2026-08-25", occurred_at: "2026-08-01" })).toBe("2026-08-03");
    expect(cashDateOf({ posted_at: null, competence_date: "2026-08-25", occurred_at: "2026-08-01" })).toBe("2026-08-25");
    expect(cashDateOf({ posted_at: null, competence_date: null, occurred_at: "2026-08-01" })).toBe("2026-08-01");
  });

  it("ignora snapshots pending_review e superseded; usa só o confirmado <= asOf", () => {
    const snaps: AccountBalanceSnapshotRow[] = [
      { id: "s1", account_id: "acc-1", balance_date: "2026-07-20", balance: 39.97, status: "confirmed" } as AccountBalanceSnapshotRow,
      { id: "s2", account_id: "acc-1", balance_date: "2026-07-20", balance: 49.91, status: "pending_review" } as AccountBalanceSnapshotRow,
      { id: "s3", account_id: "acc-1", balance_date: "2026-07-21", balance: 999, status: "superseded" } as AccountBalanceSnapshotRow,
    ];
    const bal = computeAccountBalances(acc, [], snaps, { asOf: "2026-07-31" });
    expect(bal["acc-1"]).toBe(39.97);
  });

  it("movimento processado depois do corte conta pela data bancária, não pela econômica", () => {
    const snaps: AccountBalanceSnapshotRow[] = [
      { id: "s1", account_id: "acc-1", balance_date: "2026-08-02", balance: 589.39, status: "confirmed" } as AccountBalanceSnapshotRow,
    ];
    const rows = [
      // consumo de 01/08 processado no banco em 03/08
      tx({ id: "t1", amount: 334.46, occurred_at: "2026-08-01", posted_at: "2026-08-03", posted_at_source: "statement" }),
    ];
    // Em 02/08 o dinheiro ainda não saiu.
    expect(computeTotalCash(acc, rows, snaps, { asOf: "2026-08-02" })).toBe(589.39);
    // Em 03/08 sai.
    expect(computeTotalCash(acc, rows, snaps, { asOf: "2026-08-03" })).toBe(254.93);
  });

  it("transferências externas afetam caixa e ficam fora do resultado comportamental", () => {
    const rows = [
      tx({ id: "a", type: "income", amount: 600, movement_kind: "external_transfer_in", occurred_at: "2026-07-11", posted_at: "2026-07-13" }),
      tx({ id: "b", type: "income", amount: 600, movement_kind: "external_transfer_in", occurred_at: "2026-07-11", posted_at: "2026-07-13" }),
      tx({ id: "c", type: "expense", amount: 1200, movement_kind: "external_transfer_out", occurred_at: "2026-07-11", posted_at: "2026-07-13" }),
    ];
    expect(computeTotalCash(acc, rows, [])).toBe(0);
    expect(rows.every(isExternalTransfer)).toBe(true);
    expect(EXCLUDED_MOVEMENT_KINDS.has("external_transfer_in")).toBe(true);
    expect(EXCLUDED_MOVEMENT_KINDS.has("external_transfer_out")).toBe(true);
  });

  it("lançamentos planned nunca afetam o caixa", () => {
    const rows = [tx({ id: "p", amount: 135.31, status: "planned", type: "income" })];
    expect(computeTotalCash(acc, rows, [])).toBe(0);
  });
});
