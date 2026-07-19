import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(`${process.cwd()}/supabase/migrations/20260719230000_complete_split_expense_flow.sql`, "utf8");
const dispatcher = readFileSync(`${process.cwd()}/supabase/functions/split-reminders-dispatch/index.ts`, "utf8");

describe("Divisão do Rolê — contrato integrado", () => {
  it("cria, edita e cancela por RPC transacional", () => {
    expect(migration).toContain("FUNCTION public.split_create_v2");
    expect(migration).toContain("FUNCTION public.split_update");
    expect(migration).toContain("FUNCTION public.split_cancel");
  });

  it("vincula gasto e reembolso sem tratar reembolso como renda comum", () => {
    expect(migration).toContain("split_transaction_role");
    expect(migration).toContain("'original_expense'");
    expect(migration).toContain("'refund'");
    expect(migration).toContain("'reimbursement'");
  });

  it("usa pgcrypto qualificado explicitamente", () => {
    expect(migration).toContain("extensions.gen_random_bytes");
    expect(migration).not.toMatch(/(?<!extensions\.)gen_random_bytes\s*\(/);
  });

  it("possui mensagens do Lucas para todo o ciclo", () => {
    for (const kind of ["invite", "reminder", "due_soon", "overdue", "payment_confirmation", "completed"]) {
      expect(dispatcher).toContain(`case "${kind}"`);
    }
  });
});
