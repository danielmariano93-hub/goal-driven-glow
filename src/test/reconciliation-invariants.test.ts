import { describe, it, expect } from "vitest";
import { assertInvariants, reconciliationGate } from "../../supabase/functions/_shared/engine/reconciliation.ts";

function tx(over: Partial<any>): any {
  return {
    id: crypto.randomUUID(), user_id: "u", account_id: "a1", type: "expense", status: "confirmed",
    amount: 100, occurred_at: "2026-07-01", movement_kind: "transaction", payment_method: "account",
    ...over,
  };
}

describe("reconciliation invariants", () => {
  it("aceita conjunto vazio", () => {
    expect(assertInvariants([]).ok).toBe(true);
  });

  it("detecta amount negativo", () => {
    const r = assertInvariants([tx({ amount: -50 })]);
    expect(r.ok).toBe(false);
    expect(r.violations[0].kind).toBe("sign_negative_amount");
  });

  it("transferência balanceada passa", () => {
    const g = "grp1";
    const txs = [
      tx({ type: "expense", amount: 200, transfer_group_id: g, account_id: "a1", movement_kind: "transfer" }),
      tx({ type: "income", amount: 200, transfer_group_id: g, account_id: "a2", movement_kind: "transfer" }),
    ];
    expect(assertInvariants(txs).ok).toBe(true);
  });

  it("transferência desbalanceada quebra invariante", () => {
    const g = "grp2";
    const txs = [
      tx({ type: "expense", amount: 200, transfer_group_id: g, account_id: "a1" }),
      tx({ type: "income", amount: 199, transfer_group_id: g, account_id: "a2" }),
    ];
    const r = assertInvariants(txs);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.kind === "transfer_unbalanced")).toBe(true);
  });

  it("transferência para mesma conta é bloqueada", () => {
    const g = "grp3";
    const txs = [
      tx({ type: "expense", amount: 100, transfer_group_id: g, account_id: "a1" }),
      tx({ type: "income", amount: 100, transfer_group_id: g, account_id: "a1" }),
    ];
    const r = assertInvariants(txs);
    expect(r.violations.some(v => v.kind === "transfer_same_account")).toBe(true);
  });

  it("ciclo de cartão consistente passa", () => {
    const txs = [
      tx({ payment_method: "credit_card", credit_card_id: "c1", amount: 100, competence_date: "2026-07-15", movement_kind: "transaction" }),
      tx({ payment_method: "credit_card", credit_card_id: "c1", amount: 150, competence_date: "2026-07-15", movement_kind: "transaction" }),
      tx({ movement_kind: "card_payment", settles_card_id: "c1", amount: 250, competence_date: "2026-07-15", occurred_at: "2026-07-15" }),
    ];
    expect(assertInvariants(txs).ok).toBe(true);
  });

  it("ciclo de cartão inconsistente aciona violação", () => {
    const txs = [
      tx({ payment_method: "credit_card", credit_card_id: "c1", amount: 100, competence_date: "2026-07-15" }),
      tx({ movement_kind: "card_payment", settles_card_id: "c1", amount: 250, competence_date: "2026-07-15" }),
    ];
    const r = assertInvariants(txs);
    expect(r.violations.some(v => v.kind === "card_cycle_mismatch")).toBe(true);
  });

  it("reembolso maior que original é bloqueado", () => {
    const original = tx({ id: "orig", amount: 100 });
    const refund = tx({ movement_kind: "refund", amount: 150, type: "income", refunds_transaction_id: "orig" });
    const r = assertInvariants([original, refund]);
    expect(r.violations.some(v => v.kind === "refund_exceeds_original")).toBe(true);
  });

  it("gate encapsula violações", () => {
    const r = reconciliationGate([tx({ amount: -1 })]) as { ok: false; error: string; violations: any[] };
    expect(r.ok).toBe(false);
    expect(r.error).toBe("reconciliation_failed");
    expect(r.violations.length).toBeGreaterThan(0);
  });
});
