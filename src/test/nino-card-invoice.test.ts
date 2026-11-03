// "Quanto vem na fatura de novembro?" respondia o gasto total do mês: agora é a fatura da competência.
import { describe, expect, it, vi } from "vitest";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";
import { FINANCIAL_METRICS } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";

vi.mock("../../supabase/functions/_shared/agent/core/handlers/TransactionWindowLoader.ts", () => ({ loadTransactionsForCompetenceWindow: async () => [] }));
vi.mock("../../supabase/functions/_shared/finance-core/ninoClock.ts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()), today: () => "2026-11-03",
}));
import { get_card_invoice } from "../../supabase/functions/_shared/agent/cardInvoiceTool";

const ir = (filters: unknown[] = [], period = { from: "2026-11-01", to: "2026-11-30", label: "novembro de 2026" }) => ({
  version: "financial_query_ir.v2", intent: "lookup",
  queries: [{ id: "q1", metric: "card_invoice", operation: "value", filters, group_by: [], limit: null, depends_on: [] }],
  period, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null,
});

function sb(data: Record<string, Array<Record<string, unknown>>>) {
  return {
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, gte: () => q, lte: () => q, lt: () => q, order: () => q, limit: () => q, then: (r: any) => r({ data: data[table] ?? [], error: null }) };
      return q;
    },
  } as never;
}
const ctx = (data: Record<string, Array<Record<string, unknown>>>) => ({ sb: sb(data), user_id: "u1", conversation_id: "c" }) as never;
const CARDS = [{ id: "c1", name: "Nubank", closing_day: 20, due_day: 27 }, { id: "c2", name: "Itaú", closing_day: 5, due_day: 12 }];

describe("fatura do cartão por competência", () => {
  it("o IR mapeia para a ferramenta com o mês da pergunta (e o cartão, se nomeado)", () => {
    expect(FINANCIAL_METRICS).toContain("card_invoice");
    const all = capabilityFromFinancialIR(ir() as never);
    expect(all.mapped_tools).toEqual(["get_card_invoice"]);
    expect(all.capability?.tool_args).toEqual({ month: "2026-11" });
    const one = capabilityFromFinancialIR(ir([{ field: "card", op: "eq", value: "Nubank" }]) as never);
    expect(one.capability?.tool_args).toEqual({ month: "2026-11", card: "Nubank" });
  });

  it("fatura oficial importada vence a reconstrução e mostra o vencimento", async () => {
    const out = await get_card_invoice(ctx({
      credit_cards: CARDS,
      credit_card_statements: [{ id: "s1", credit_card_id: "c1", competence_month: "2026-11-01", due_date: "2026-11-27", stated_total: 1500, paid_amount: 0, outstanding_amount: 1500, status: "closed" }],
    }), { month: "2026-11", card: "Nubank" });
    const r = (out as any).result;
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ card: "Nubank", amount: 1500, source: "official", due_date: "2026-11-27" });
    expect(semanticBlockText("get_card_invoice", r)).toMatch(/fatura de novembro de 2026 do Nubank está em \*R\$\s1\.500,00\* \(fatura oficial, vence em 27\/11\)/);
  });

  it("sem fatura oficial, reconstrói por parcelas contratadas da competência e diz que é estimativa", async () => {
    const out = await get_card_invoice(ctx({
      credit_cards: CARDS,
      credit_card_installments: [
        { id: "i1", credit_card_id: "c1", competence_month: "2026-11-01", amount: 300, status: "open" },
        { id: "i2", credit_card_id: "c1", competence_month: "2026-12-01", amount: 999, status: "open" },
      ],
    }), { month: "2026-11" });
    const r = (out as any).result;
    const nubank = r.cards.find((c: any) => c.card === "Nubank");
    expect(nubank).toMatchObject({ amount: 300, source: "estimated" });
    expect(r.total).toBe(300);
    expect(semanticBlockText("get_card_invoice", r)).toContain("estimativa");
  });

  it("cartão que não existe não vira outro: responde que não achou", async () => {
    const out = await get_card_invoice(ctx({ credit_cards: CARDS }), { month: "2026-11", card: "Santander" });
    expect(semanticBlockText("get_card_invoice", (out as any).result)).toContain("Não encontrei um cartão chamado “Santander”");
  });

  it("sem cartões cadastrados, diz isso", async () => {
    const out = await get_card_invoice(ctx({}), { month: "2026-11" });
    expect(semanticBlockText("get_card_invoice", (out as any).result)).toContain("ainda não tem cartão");
  });
});

import { get_future_installments } from "../../supabase/functions/_shared/agent/tools";

describe("parcelas que faltam num estabelecimento", () => {
  const DATA = {
    credit_cards: [{ id: "c1", name: "Nubank" }],
    credit_card_purchases: [{ id: "p1", merchant: "JIM.COM", merchant_canonical: "jim com" }, { id: "p2", merchant: "Turbi", merchant_canonical: "turbi" }],
    credit_card_installments: [
      { id: "i1", credit_card_id: "c1", purchase_id: "p1", installment_number: 5, amount: 100, competence_month: "2026-12-01", status: "open" },
      { id: "i2", credit_card_id: "c1", purchase_id: "p1", installment_number: 6, amount: 100, competence_month: "2027-01-01", status: "open" },
      { id: "i3", credit_card_id: "c1", purchase_id: "p2", installment_number: 2, amount: 500, competence_month: "2026-12-01", status: "open" },
    ],
  };
  it("filtra pelo estabelecimento e confirma o filtro aplicado", async () => {
    const out = await get_future_installments({ sb: sb(DATA), user_id: "u1", conversation_id: "c" } as never, { months: 24, merchant: "jim.com" });
    const r = (out as any).result;
    expect(r.total).toBe(200);
    expect(r.count).toBe(2);
    expect(r.merchant_filter).toEqual({ requested: "jim.com", applied: true, matched_purchases: 1 });
    expect(semanticBlockText("get_future_installments", r)).toMatch(/Ainda faltam \*R\$\s200,00\* no jim\.com, em 2 parcelas/);
  });
  it("estabelecimento sem compra parcelada responde isso, sem inventar", async () => {
    const out = await get_future_installments({ sb: sb(DATA), user_id: "u1", conversation_id: "c" } as never, { merchant: "Zara" });
    expect(semanticBlockText("get_future_installments", (out as any).result)).toContain("Não encontrei compras parceladas no Zara");
  });
  it("o IR com filtro merchant mapeia para a ferramenta", () => {
    const q = ir([{ field: "merchant", op: "eq", value: "JIM.COM" }]) as any;
    q.queries[0].metric = "future_installments";
    expect(capabilityFromFinancialIR(q).capability?.tool_args).toEqual({ months: 24, merchant: "JIM.COM" });
  });
});
