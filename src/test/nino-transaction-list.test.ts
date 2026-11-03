// "Liste meus gastos" devolvia ranking de categorias: agora lista os lançamentos do período.
import { describe, expect, it, vi } from "vitest";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";

const rows: Array<Record<string, unknown>> = [
  { id: "1", type: "expense", status: "confirmed", amount: 40, occurred_at: "2026-10-30", competence_date: "2026-10-30", description: "Mercado Extra", category_id: "c1", movement_kind: "transaction", payment_method: "account" },
  { id: "2", type: "expense", status: "confirmed", amount: 120, occurred_at: "2026-10-12", competence_date: "2026-10-12", description: "Restaurante", category_id: "c2", movement_kind: "transaction", payment_method: "credit_card" },
  // não são gasto real: transferência e pagamento de fatura
  { id: "3", type: "expense", status: "confirmed", amount: 999, occurred_at: "2026-10-15", competence_date: "2026-10-15", description: "Pagamento fatura", category_id: null, movement_kind: "card_payment", settles_card_id: "c9", payment_method: "account" },
  { id: "4", type: "transfer", status: "confirmed", amount: 500, occurred_at: "2026-10-16", competence_date: "2026-10-16", description: "TED", category_id: null, movement_kind: "transaction", transfer_group_id: "g1" },
  { id: "5", type: "income", status: "confirmed", amount: 5000, occurred_at: "2026-10-05", competence_date: "2026-10-05", description: "Salário", category_id: null, movement_kind: "transaction" },
];
vi.mock("../../supabase/functions/_shared/agent/core/handlers/TransactionWindowLoader.ts", () => ({ loadTransactionsForCompetenceWindow: async () => rows }));
vi.mock("../../supabase/functions/_shared/finance-core/ninoClock.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), today: () => "2026-11-03" }));
import { list_period_transactions } from "../../supabase/functions/_shared/agent/transactionListTool";

const sb = { from: () => { const q: any = { select: () => q, or: () => q, then: (r: any) => r({ data: [{ id: "c1", name: "Mercado" }, { id: "c2", name: "Restaurante" }], error: null }) }; return q; } } as never;
const ctx = { sb, user_id: "u1", conversation_id: "c" } as never;

describe("listagem de lançamentos do período", () => {
  it("lista só gastos reais, do mais recente ao mais antigo, com total", async () => {
    const out = await list_period_transactions(ctx, { from: "2026-10-01", to: "2026-10-31" });
    const r = (out as any).result;
    expect(r.count).toBe(2);
    expect(r.total).toBe(160);
    expect(r.items.map((i: any) => i.description)).toEqual(["Mercado Extra", "Restaurante"]);
    const text = semanticBlockText("list_period_transactions", r)!;
    expect(text).toMatch(/2 gastos em 01\/10 a 31\/10, somando \*R\$\s160,00\*/);
    expect(text).toMatch(/• 30\/10 · Mercado Extra \(Mercado\): \*R\$\s40,00\*/);
    expect(text).not.toContain("fatura");
    expect(text).not.toContain("TED");
  });
  it("filtro de categoria é confirmado; categoria inexistente não vira outra", async () => {
    const ok = await list_period_transactions(ctx, { from: "2026-10-01", to: "2026-10-31", category: "Mercado" });
    expect((ok as any).result.items).toHaveLength(1);
    expect((ok as any).result.category_filter).toEqual({ requested: "Mercado", applied: true });
    const none = await list_period_transactions(ctx, { from: "2026-10-01", to: "2026-10-31", category: "Viagem" });
    expect(semanticBlockText("list_period_transactions", (none as any).result)).toContain("Não encontrei a categoria “Viagem”");
  });
  it("entradas também, e período vazio diz isso", async () => {
    const inc = await list_period_transactions(ctx, { from: "2026-10-01", to: "2026-10-31", kind: "income" });
    expect((inc as any).result.total).toBe(5000);
    const empty = await list_period_transactions(ctx, { from: "2026-09-01", to: "2026-09-30", merchant: "inexistente" });
    expect(semanticBlockText("list_period_transactions", (empty as any).result)).toContain("Não encontrei gastos");
  });
  it("o IR mapeia metric=transaction_list com período e filtros", () => {
    const ir: any = {
      version: "financial_query_ir.v2", intent: "lookup",
      queries: [{ id: "q1", metric: "transaction_list", operation: "value", filters: [{ field: "category", op: "eq", value: "Mercado" }], group_by: [], limit: null, depends_on: [] }],
      period: { from: "2026-10-01", to: "2026-10-31", label: "outubro" }, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null,
    };
    const cap = capabilityFromFinancialIR(ir);
    expect(cap.mapped_tools).toEqual(["list_period_transactions"]);
    expect(cap.capability?.tool_args).toEqual({ from: "2026-10-01", to: "2026-10-31", category: "Mercado" });
  });
});
