// Verdade de caixa bancária — contrato P0/P1.
// 1) correção contábil é auditável (nunca DELETE silencioso);
// 2) extrato exige conta resolvida antes de gravar;
// 3) item confirmado sem transação volta para revisão;
// 4) estorno é atribuído à categoria da despesa original.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRefundAttribution,
  computeCategoryBreakdown,
  effectiveCategoryId,
  type CategoryRow,
  type TransactionRow,
} from "@/lib/engine/facts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: over.id ?? crypto.randomUUID(),
  account_id: "acc",
  category_id: null,
  type: "expense",
  status: "confirmed",
  amount: 0,
  occurred_at: "2026-08-03",
  description: null,
  transfer_group_id: null,
  payment_method: "account",
  movement_kind: "transaction",
  ...over,
});

describe("estorno segue a categoria da despesa original", () => {
  const categories: CategoryRow[] = [
    { id: "transporte", name: "Transporte", type: "expense" } as CategoryRow,
    { id: "outros", name: "Outros", type: "expense" } as CategoryRow,
  ];

  const uber = tx({ id: "uber", amount: 31.93, category_id: "transporte", description: "Uber" });
  const estorno = tx({
    id: "estorno",
    type: "income",
    amount: 31.93,
    movement_kind: "refund",
    category_id: "outros",
    refund_of_transaction_id: "uber",
    description: "EST Uber",
  });

  it("atribui a categoria original ao estorno vinculado", () => {
    const attribution = buildRefundAttribution([uber, estorno]);
    expect(effectiveCategoryId(estorno, attribution)).toBe("transporte");
    expect(effectiveCategoryId(uber, attribution)).toBe("transporte");
  });

  it("zera a categoria original quando a despesa é totalmente estornada", () => {
    const rows = computeCategoryBreakdown([uber, estorno], categories, "2026-08", "expense");
    expect(rows.find((r) => r.id === "outros")).toBeUndefined();
    expect(rows.find((r) => r.id === "transporte")).toBeUndefined();
  });

  it("estorno sem vínculo continua na própria categoria (nada é inventado)", () => {
    const solto = { ...estorno, refund_of_transaction_id: null };
    const attribution = buildRefundAttribution([uber, solto]);
    expect(effectiveCategoryId(solto, attribution)).toBe("outros");
  });
});

describe("infraestrutura de correção auditável", () => {
  const migration = read(
    "supabase/migrations/20260810150000_bank_cash_truth_auditable_corrections.sql",
  );

  it("substitui em vez de apagar e registra auditoria", () => {
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'superseded'");
    expect(migration).toContain("public.ledger_corrections");
    expect(migration).toContain("apply_ledger_correction");
    expect(migration).toContain("reason_required");
  });

  it("audita exclusão e devolve o item do documento para revisão", () => {
    expect(migration).toContain("audit_transaction_delete");
    expect(migration).toContain("'hard_delete'");
    expect(migration).toContain("SET status = 'needs_review'");
  });

  it("bloqueia estorno maior que a despesa original", () => {
    expect(migration).toContain("enforce_refund_link_integrity");
    expect(migration).toContain("refund_exceeds_original");
  });

  it("concilia extrato contra o saldo do banco sem lançamento de ajuste", () => {
    expect(migration).toContain("reconcile_account_statement");
    expect(migration).toContain("statement_reconciliation.v1");
    expect(migration).toContain("pending_review");
    expect(migration).not.toContain("Ajuste de diferença");
  });
});

describe("confirmação de extrato é fail-closed", () => {
  const edge = read("supabase/functions/assistant-review-actions/index.ts");

  it("exige conta antes de gravar o extrato", () => {
    expect(edge).toContain("needs_account_selection");
    expect(edge).toContain("Antes de salvar, escolha a conta bancária deste extrato");
  });

  it("detecta item confirmado sem transação e devolve para revisão", () => {
    expect(edge).toContain('.eq("status", "confirmed").is("transaction_id", null)');
    expect(edge).toContain("recovered_orphans");
  });

  it("concilia o extrato depois de gravar", () => {
    expect(edge).toContain("reconcile_account_statement");
  });
});
