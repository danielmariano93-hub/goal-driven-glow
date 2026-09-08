import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEqualInstallments, equalInstallmentAmounts, installmentState, installmentLabel,
  monthlyDueDates, summarizeReceivables, validateInstallments, type ReceivableRow,
} from "@/lib/split/installments";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const row = (over: Partial<ReceivableRow>): ReceivableRow => ({
  installment_id: over.installment_id ?? "i1",
  shared_expense_id: "s1",
  participant_id: over.participant_id ?? "p1",
  participant_name: "Ana",
  installment_number: over.installment_number ?? 1,
  total_installments: over.total_installments ?? 3,
  amount: over.amount ?? 150,
  paid_amount: over.paid_amount ?? 0,
  balance_due: over.balance_due ?? (over.amount ?? 150) - (over.paid_amount ?? 0),
  due_date: over.due_date ?? "2026-10-10",
  settlement_status: over.settlement_status ?? "pending",
  state: over.state ?? "pending",
});

describe("parcelas da Divisão do Rolê", () => {
  it("divide em centavos sem perder nem criar dinheiro", () => {
    const parts = equalInstallmentAmounts(100, 3);
    expect(parts.reduce((s, v) => s + Math.round(v * 100), 0)).toBe(10000);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it("gera vencimentos mensais com clamp de fim de mês", () => {
    expect(monthlyDueDates("2026-01-31", 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("fecha exatamente com o total da pessoa", () => {
    const drafts = buildEqualInstallments(300, 3, "2026-10-10");
    expect(validateInstallments(300, drafts).ok).toBe(true);
    expect(validateInstallments(299, drafts).ok).toBe(false);
  });

  it("classifica pago, parcial, atrasado e pendente pela data civil", () => {
    const today = "2026-11-01";
    expect(installmentState({ amount: 150, paid_amount: 150, due_date: "2026-10-10" }, today)).toBe("paid");
    expect(installmentState({ amount: 150, paid_amount: 0, due_date: "2026-10-10" }, today)).toBe("overdue");
    expect(installmentState({ amount: 150, paid_amount: 50, due_date: "2026-12-10" }, today)).toBe("partial");
    expect(installmentState({ amount: 150, paid_amount: 0, due_date: "2026-12-10" }, today)).toBe("pending");
    expect(installmentState({ amount: 150, paid_amount: 0, settlement_status: "cancelled" }, today)).toBe("cancelled");
  });

  it("resume recebíveis separando recebido, pendente e atrasado", () => {
    const summary = summarizeReceivables([
      row({ installment_id: "a", amount: 150, paid_amount: 150, balance_due: 0, state: "paid", settlement_status: "paid" }),
      row({ installment_id: "b", installment_number: 2, amount: 150, paid_amount: 100, balance_due: 50, state: "overdue", due_date: "2026-10-10" }),
      row({ installment_id: "c", installment_number: 3, amount: 150, paid_amount: 0, balance_due: 150, state: "pending", due_date: "2026-12-10" }),
      row({ installment_id: "d", installment_number: 4, amount: 90, paid_amount: 0, balance_due: 90, state: "cancelled", settlement_status: "cancelled" }),
    ], "2026-11-01");
    expect(summary.total).toBe(450);
    expect(summary.received).toBe(250);
    expect(summary.overdue).toBe(50);
    expect(summary.pending).toBe(150);
    expect(summary.nextDueDate).toBe("2026-10-10");
    expect(summary.paidCount).toBe(1);
  });

  it("nomeia a parcela para o usuário", () => {
    expect(installmentLabel(2, 3)).toBe("2ª parcela de 3");
    expect(installmentLabel(1, 1)).toBe("parcela única");
  });
});

describe("cobrança parcelada ponta a ponta", () => {
  it("revalida a parcela antes de enviar e suprime paga/cancelada/sem saldo", () => {
    const worker = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
    expect(worker).toContain("split_receivables_v1");
    expect(worker).toContain('suppression = "already_paid"');
    expect(worker).toContain('suppression = "cancelled"');
    expect(worker).toContain('suppression = "no_balance_due"');
    expect(worker).toContain("message_suppressed");
    expect(worker).toContain('installment_id ?? "single"');
  });

  it("fala de parcela e saldo real nas mensagens do WhatsApp", () => {
    const templates = read("supabase/functions/_shared/agent/messageTemplates.ts");
    expect(templates).toContain("{{installment_label}}");
    expect(templates).toContain("{{partial_sentence}}");
    expect(templates).toContain("*");
  });

  it("cria e edita a divisão pelas RPCs parceladas", () => {
    const form = read("src/pages/DivisaoDoRoleNova.tsx");
    expect(form).toContain("split_create_v3");
    expect(form).toContain("split_update_v3");
    expect(form).toContain("split_apply_installments");
    expect(form).not.toContain('supabase.rpc("split_create_v2"');
  });

  it("mostra parcelas e recebe por parcela no detalhe", () => {
    const detail = read("src/pages/DivisaoDoRoleDetalhe.tsx");
    expect(detail).toContain("split_receivables_v1");
    expect(detail).toContain("split_add_installment_payment");
    expect(detail).toContain("summarizeReceivables");
    expect(detail).toContain("Próximo vencimento");
  });
  it("o Nino lê recebíveis parcelados da fonte única", () => {
    const tools = read("supabase/functions/_shared/agent/tools.ts");
    const router = read("supabase/functions/_shared/agent/core/CapabilityRouter.ts");
    const registry = read("supabase/functions/_shared/agent/core/CapabilityRegistry.ts");
    expect(tools).toContain("list_split_receivables");
    expect(tools).toContain('from("split_receivables_v1")');
    expect(router).toContain("list_split_receivables");
    expect(registry).toContain("sharing.receivables");
  });
});
