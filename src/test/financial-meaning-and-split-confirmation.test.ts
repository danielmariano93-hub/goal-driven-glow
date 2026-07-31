import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeNetWorth, type AccountRow, type DebtRow } from "@/lib/engine/facts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("financial concepts shown to the user", () => {
  it("keeps gross assets separate from liabilities and net worth", () => {
    const accounts: AccountRow[] = [{
      id: "account", name: "Conta", type: "checking", opening_balance: 6715.43, active: true,
    }];
    const debts: DebtRow[] = [{
      id: "debt", name: "Dívida controlada", original_amount: 5000,
      outstanding_balance: 3000, status: "active",
    }];
    const result = computeNetWorth(accounts, [], [{
      id: "investment", name: "Reserva", invested_amount: 2000, current_value: 2000, goal_id: null,
    }], debts);
    expect(result.assets).toBe(8715.43);
    expect(result.owed).toBe(3000);
    expect(result.net).toBe(5715.43);
  });

  it("does not call period result an account balance", () => {
    const reports = read("src/pages/Relatorios.tsx");
    expect(reports).toContain("Resultado do período");
    expect(reports).toContain("Disponível hoje");
    expect(reports).toContain("um resultado negativo não significa que sua conta esteja negativa");
    expect(reports).not.toContain(">Saldo</p>");
  });

  it("keeps actionable highlights in acompanhamento and learned data in a separate surface", () => {
    const context = read("src/pages/NinoContextoV2.tsx");
    const acompanhamento = read("src/pages/AssessorAcompanhamentoV2.tsx");
    expect(acompanhamento).toContain("Highlights para mudar o jogo");
    expect(context).toContain("O que o Nino aprendeu");
    expect(context).not.toContain("Highlights para mudar o jogo");
  });
});

describe("split payment acknowledgement", () => {
  it("delivers terminal messages even after the split becomes settled", () => {
    const worker = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
    expect(worker).toContain('String(expense.status) === "settled" && !terminal');
    expect(worker).toContain('const terminal = ["payment_confirmation", "completed"].includes(kind)');
  });

  it("has a friendly and idempotent payment acknowledgement journey", () => {
    const templates = read("supabase/functions/_shared/agent/messageTemplates.ts");
    const paymentRpc = read("supabase/migrations/20260729110307_3ecb31aa-f9c9-4623-b067-3144d02737ab.sql");
    expect(templates).toContain('payment_confirmation: "Tudo certo');
    expect(paymentRpc).toContain("'payment_confirmation'");
    expect(paymentRpc).toContain("quem já pagou não deve mais receber cobrança");
  });
});
