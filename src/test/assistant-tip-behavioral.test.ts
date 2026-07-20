import { describe, it, expect } from "vitest";
import { buildAssistantFacts } from "@/components/home/AssistantTipCard";
import { pickFallback } from "@/lib/insights/fallbacks";
import type { TransactionRow } from "@/lib/engine/facts";

// Cenário reproduz o mês reconciliado do usuário Daniel Mariano:
// aplicação CDB, resgate, rendimento, crédito de consignado e estorno
// não podem gerar dica "Este mês tá apertado / gastou R$ X a mais".
describe("AssistantTipCard fallback — escopo comportamental", () => {
  const month = "2026-07";
  const base = { account_id: "a1", credit_card_id: null, settles_card_id: null, transfer_group_id: null, description: null, category_id: null } as const;

  const txs: TransactionRow[] = [
    // Rendas comportamentais reais
    { id: "t1", type: "income", amount: 3000, occurred_at: `${month}-05`, status: "confirmed", movement_kind: "transaction", ...base },
    // Gastos reais de consumo
    { id: "t2", type: "expense", amount: 1200, occurred_at: `${month}-08`, status: "confirmed", movement_kind: "transaction", ...base },
    // Estorno (refund abate despesa)
    { id: "t3", type: "income", amount: 60, occurred_at: `${month}-09`, status: "confirmed", movement_kind: "refund", ...base },
    // Ruídos patrimoniais — devem sumir do escopo comportamental
    { id: "t4", type: "expense", amount: 5000, occurred_at: `${month}-10`, status: "confirmed", movement_kind: "investment_application", ...base },
    { id: "t5", type: "income", amount: 5000, occurred_at: `${month}-11`, status: "confirmed", movement_kind: "investment_redemption", ...base },
    { id: "t6", type: "income", amount: 42.5, occurred_at: `${month}-12`, status: "confirmed", movement_kind: "investment_yield", ...base },
    { id: "t7", type: "income", amount: 6135.13, occurred_at: `${month}-14`, status: "confirmed", movement_kind: "loan_proceeds", ...base },
    // Pagamento de fatura de cartão (settles) não conta como despesa comportamental
    { id: "t8", type: "expense", amount: 271.88, occurred_at: `${month}-20`, status: "confirmed", movement_kind: "card_bill_payment", account_id: "a1", credit_card_id: null, settles_card_id: "c1", transfer_group_id: null, description: null, category_id: null },
  ];

  const facts = buildAssistantFacts(txs, [], month);

  it("income considera só rendas reais (não CDB/rendimento/consignado)", () => {
    expect(facts.income_month).toBe(3000);
  });

  it("expense considera só consumo real e desconta estorno", () => {
    expect(facts.expense_month).toBe(1140);
  });

  it("balance é positivo — não vira alerta de déficit", () => {
    expect(facts.balance_month).toBeGreaterThan(0);
  });

  it("fallback NÃO produz alerta 'Este mês tá apertado'", () => {
    const p = pickFallback(facts);
    expect(p.title).not.toBe("Este mês tá apertado");
    expect(p.type).not.toBe("alert");
  });
});
