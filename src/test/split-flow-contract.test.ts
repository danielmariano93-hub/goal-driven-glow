import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(`${process.cwd()}/supabase/migrations/20260719230000_complete_split_expense_flow.sql`, "utf8");
const repairMigration = readFileSync(`${process.cwd()}/supabase/migrations/20260719214538_858fe9fa-6493-496c-9140-d5de3f142e45.sql`, "utf8");
const dispatcher = readFileSync(`${process.cwd()}/supabase/functions/split-reminders-dispatch/index.ts`, "utf8");

describe("Divisão do Rolê — contrato integrado", () => {
  it("cria, edita e cancela por RPC transacional", () => {
    expect(migration).toContain("FUNCTION public.split_create_v2");
    expect(migration).toContain("FUNCTION public.split_update");
    expect(migration).toContain("FUNCTION public.split_cancel");
    expect(repairMigration).toContain("FUNCTION public.split_create_v2");
    expect(repairMigration).toContain("FUNCTION public.split_update");
    expect(repairMigration).toContain("FUNCTION public.split_cancel");
  });

  it("vincula gasto e reembolso sem tratar reembolso como renda comum", () => {
    expect(migration).toContain("split_transaction_role");
    expect(migration).toContain("'original_expense'");
    expect(migration).toContain("'refund'");
    expect(migration).toContain("'reimbursement'");
    expect(repairMigration).toContain("financial_link_repaired");
    expect(repairMigration).toContain("shared_expense_id = se.id");
  });

  it("recria lançamento original ausente e cancela também por shared_expense_id", () => {
    expect(repairMigration).toContain("linked_transaction_id IS DISTINCT FROM tx_id");
    expect(repairMigration).toContain("t.shared_expense_id = p_id");
    expect(repairMigration).toContain("DELETE FROM public.transactions");
  });

  it("usa split_enqueue_message para lembretes idempotentes", () => {
    expect(repairMigration).toContain("public.split_enqueue_message(p_shared_expense_id, p.id, 'reminder', send_at)");
    expect(repairMigration).not.toContain("INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status)\n      VALUES");
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
