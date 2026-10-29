/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures parciais de Supabase/IR */
// Executor genérico no runtime (`nino_generic_aggregate.v1`): ferramenta,
// texto determinístico, evidência e checagem pedido-vs-executado.
import { describe, expect, it } from "vitest";
import { analyze_spending } from "../../supabase/functions/_shared/agent/tools.ts";
import { spending_aggregate } from "../../supabase/functions/_shared/agent/engineToolsImpl.ts";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter.ts";
import { executedIRFrom } from "../../supabase/functions/_shared/agent/core/ExecutedIRBridge.ts";
import { planPreservation } from "../../supabase/functions/_shared/agent/core/SemanticPreservation.ts";

let n = 0;
const tx = (over: Record<string, unknown>) => ({
  id: `t${++n}`, account_id: "acc1", category_id: "cat-lazer", type: "expense", status: "confirmed",
  amount: 100, occurred_at: "2026-09-10", description: "THALES BAR", payment_method: "credit_card",
  credit_card_id: "card1", movement_kind: "transaction", competence_date: null,
  refund_of_transaction_id: null, ...over,
} as any);

function fakeSb(rows: any[]) {
  const tables: Record<string, any[]> = {
    transactions: rows,
    credit_cards: [{ id: "card1", name: "Nubank" }, { id: "card2", name: "Itaú" }],
    accounts: [{ id: "acc1", name: "Conta Itaú" }],
    categories: [
      { id: "cat-lazer", name: "Lazer", user_id: null, type: "expense" },
      { id: "cat-transp", name: "Transporte", user_id: null, type: "expense" },
    ],
    merchant_aliases: [],
  };
  return {
    from: (table: string) => {
      const data = tables[table] ?? [];
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, in: () => q, or: () => q, is: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: data.slice(a, b + 1), error: null }),
        then: (res: any) => Promise.resolve({ data, error: null }).then(res),
      };
      return q;
    },
  };
}

const rows = [
  tx({ amount: 100, description: "THALES BAR", category_id: "cat-lazer" }),
  tx({ amount: 30, description: "THALES BAR", category_id: "cat-transp", credit_card_id: "card2" }),
  tx({ amount: 70, description: "UBER TRIP", category_id: "cat-transp" }),
];
const ctx = { sb: fakeSb(rows), user_id: "u1" } as any;
const period = { from: "2026-09-01", to: "2026-09-30" };

describe("spending_aggregate (runtime)", () => {
  it("estabelecimento agrupado por categoria: números e texto do motor", async () => {
    const out: any = await spending_aggregate(ctx, { ...period, merchant: "thales", group_by: ["category"] });
    expect(out.ok).toBe(true);
    expect(out.result.total).toBe(130);
    const text = semanticBlockText("spending_aggregate", out.result)!.replace(/\u00a0/g, " ");
    expect(text).toContain("R$ 130,00");
    expect(text).toContain("*Lazer*");
    expect(text).toContain("*Transporte*");
  });

  it("filtro não resolvido vira erro de domínio, nunca é descartado", async () => {
    const cat: any = await spending_aggregate(ctx, { ...period, category: "Inexistente" });
    expect(cat.ok).toBe(false);
    expect(cat.error).toContain("category_not_found");
    const card: any = await spending_aggregate(ctx, { ...period, card: "Cartão Fantasma" });
    expect(card.error).toContain("card_not_found");
  });

  it("dimensão fora do catálogo é recusada", async () => {
    const out: any = await spending_aggregate(ctx, { ...period, group_by: ["banana"] });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("dimension_unsupported");
  });

  it("IR executado declara o que de fato rodou e a preservação aceita o pedido", async () => {
    const out: any = await spending_aggregate(ctx, {
      ...period, merchant: "thales", card: "nubank", group_by: ["category"],
    });
    const requested: any = {
      metric: "expense_amount", filters: [
        { field: "merchant", op: "eq", value: "thales" }, { field: "card", op: "eq", value: "Nubank" },
      ],
      time: { aspect: "value", from: period.from, to: period.to, n: null, exclude_partial: false },
      grain: "none", reduce: "sum", group_by: ["category"], legacy_operation: "breakdown",
    };
    const executed = executedIRFrom(requested, out.result);
    expect(executed?.group_by).toEqual(["category"]);
    expect(executed?.filters.map((f) => f.field).sort()).toEqual(["card", "merchant"]);
    const pres = planPreservation([{ requested, executed }]);
    expect(pres.compatible).toBe(true);
  });

  it("pedido com filtro a mais que o executado é bloqueado pela preservação", async () => {
    const out: any = await spending_aggregate(ctx, { ...period, merchant: "thales" });
    const requested: any = {
      metric: "expense_amount", filters: [
        { field: "merchant", op: "eq", value: "thales" }, { field: "card", op: "eq", value: "Nubank" },
      ],
      time: { aspect: "value", from: period.from, to: period.to, n: null, exclude_partial: false },
      grain: "none", reduce: "sum", group_by: [], legacy_operation: "sum",
    };
    const pres = planPreservation([{ requested, executed: executedIRFrom(requested, out.result) }]);
    expect(pres.compatible).toBe(false);
  });
});

// Regressão do piloto (29/10): parcela de cartão de compra ANTIGA tem occurred_at
// fora da folga de ±45 dias, mas competência dentro da janela. A leitura recortava
// só por occurred_at e a parcela sumia do total.
function filteringSb(rows: any[]) {
  const base = fakeSb(rows);
  return {
    from: (table: string) => {
      if (table !== "transactions") return base.from(table);
      const preds: Array<(r: any) => boolean> = [];
      const q: any = {
        select: () => q, eq: (c: string, v: any) => (preds.push((r) => r[c] === v), q),
        gte: (c: string, v: string) => (preds.push((r) => r[c] != null && String(r[c]).slice(0, 10) >= v), q),
        lte: (c: string, v: string) => (preds.push((r) => r[c] != null && String(r[c]).slice(0, 10) <= v), q),
        order: () => q, in: () => q, or: () => q, is: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: rows.filter((r) => preds.every((p) => p(r))).slice(a, b + 1), error: null }),
        then: (res: any) => Promise.resolve({ data: rows.filter((r) => preds.every((p) => p(r))), error: null }).then(res),
      };
      return q;
    },
  };
}

describe("janela por competência (parcela de compra antiga)", () => {
  it("conta a parcela cuja compra é anterior à folga de 45 dias", async () => {
    const installment = tx({ user_id: "u1", amount: 363.42, description: "JIM.COM", occurred_at: "2026-04-30", competence_date: "2026-09-01", category_id: "cat-lazer" });
    const recent = tx({ user_id: "u1", amount: 100, description: "THALES BAR", occurred_at: "2026-09-10", competence_date: "2026-09-01" });
    const out: any = await spending_aggregate(
      { sb: filteringSb([installment, recent]), user_id: "u1" } as any,
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(out.ok).toBe(true);
    expect(out.result.total).toBe(463.42);
    expect(out.result.transaction_count).toBe(2);
  });

  it("não conta parcela de competência fora da janela", async () => {
    const other = tx({ user_id: "u1", amount: 50, occurred_at: "2026-04-30", competence_date: "2026-05-01" });
    const out: any = await spending_aggregate(
      { sb: filteringSb([other]), user_id: "u1" } as any,
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(out.result.total).toBe(0);
  });
});

describe("analyze_spending usa competência (regra da Home)", () => {
  it("compra de julho cobrada na fatura de setembro é gasto de setembro", async () => {
    const eventim = tx({ user_id: "u1", amount: 220.48, description: "Eventim", occurred_at: "2026-07-26", competence_date: "2026-09-01", category_id: "cat-lazer" });
    const bar = tx({ user_id: "u1", amount: 16, description: "Fakku Bar", occurred_at: "2026-09-25", payment_method: "account", credit_card_id: null, category_id: "cat-lazer" });
    const out: any = await analyze_spending(
      { sb: filteringSb([eventim, bar]), user_id: "u1" } as any,
      { from: "2026-09-01", to: "2026-09-30", view: "total", category: "Lazer" },
    );
    expect(out.ok).toBe(true);
    expect(out.result.total_metric).toBe(236.48);
  });

  it("compra de setembro cobrada na fatura de outubro NÃO é gasto de setembro", async () => {
    const next = tx({ user_id: "u1", amount: 90, occurred_at: "2026-09-28", competence_date: "2026-10-01" });
    const out: any = await analyze_spending(
      { sb: filteringSb([next]), user_id: "u1" } as any,
      { from: "2026-09-01", to: "2026-09-30", view: "total" },
    );
    expect(out.result.total_metric).toBe(0);
  });
});
