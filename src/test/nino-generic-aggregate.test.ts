/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de transação parciais */
// Executor genérico (`nino_generic_aggregate.v1`): núcleo puro.
import { describe, expect, it } from "vitest";
import { aggregate } from "../../supabase/functions/_shared/agent/core/handlers/GenericAggregate.ts";

let n = 0;
const tx = (over: Record<string, unknown>) => ({
  id: `t${++n}`, account_id: "acc1", category_id: "cat-lazer", type: "expense", status: "confirmed",
  amount: 100, occurred_at: "2026-09-10", description: "THALES BAR", payment_method: "credit_card",
  credit_card_id: "card1", movement_kind: "transaction", competence_date: null,
  refund_of_transaction_id: null, ...over,
} as any);

const lookups = {
  categories: new Map([["cat-lazer", "Lazer"], ["cat-transp", "Transporte"]]),
  cards: new Map([["card1", "Nubank"], ["card2", "Itaú"]]),
  accounts: new Map([["acc1", "Conta Itaú"]]),
};
const base = { metric: "expense" as const, lookups, from: "2026-09-01", to: "2026-09-30" };

describe("aggregate", () => {
  it("combina estabelecimento × cartão sem código novo", () => {
    const rows = [
      tx({ amount: 100, description: "THALES BAR", credit_card_id: "card1" }),
      tx({ amount: 40, description: "THALES BAR", credit_card_id: "card2" }),
      tx({ amount: 70, description: "UBER TRIP", category_id: "cat-transp", credit_card_id: "card1" }),
    ];
    const r = aggregate({ ...base, rows, scope: { merchant: "thales", card_ids: ["card1"] } });
    expect(r.total).toBe(100);
    expect(r.transaction_count).toBe(1);
  });

  it("agrupa estabelecimento por categoria", () => {
    const rows = [
      tx({ amount: 100, description: "THALES BAR", category_id: "cat-lazer" }),
      tx({ amount: 30, description: "THALES BAR", category_id: "cat-transp" }),
    ];
    const r = aggregate({ ...base, rows, scope: { merchant: "thales" }, group_by: ["category"] });
    expect(r.groups.map((g) => [g.label, g.total])).toEqual([["Lazer", 100], ["Transporte", 30]]);
    expect(r.groups[0].share).toBeCloseTo(76.9, 1);
  });

  it("dia da semana e dois agrupamentos (mês × categoria)", () => {
    const rows = [
      tx({ amount: 10, occurred_at: "2026-09-14", payment_method: "account", credit_card_id: null }), // segunda
      tx({ amount: 20, occurred_at: "2026-09-21", payment_method: "account", credit_card_id: null }), // segunda
      tx({ amount: 5, occurred_at: "2026-09-15", payment_method: "account", credit_card_id: null }),  // terça
    ];
    const wd = aggregate({ ...base, rows, group_by: ["weekday"] });
    expect(wd.groups.find((g) => g.label === "segunda")?.total).toBe(30);
    const mc = aggregate({ ...base, rows, group_by: ["month", "category"] });
    expect(mc.groups).toHaveLength(1);
    expect(mc.groups[0].key).toEqual({ month: "2026-09", category: "Lazer" });
  });

  it("dia da semana e semana seguem a data da COMPRA; mês segue a competência (fatura)", () => {
    // Compra num sábado (12/09), cobrada na fatura de 01/10 (uma quinta-feira).
    const card = tx({ amount: 80, occurred_at: "2026-09-12", competence_date: "2026-10-01" });
    const wd = aggregate({ ...base, from: "2026-10-01", to: "2026-10-31", rows: [card], group_by: ["weekday"] });
    expect(wd.groups.map((g) => g.label)).toEqual(["sábado"]);
    const wk = aggregate({ ...base, from: "2026-10-01", to: "2026-10-31", rows: [card], group_by: ["week"] });
    expect(wk.groups[0].label).toBe("semana de 07/09");
    const mo = aggregate({ ...base, from: "2026-10-01", to: "2026-10-31", rows: [card], group_by: ["month"] });
    expect(mo.groups[0].label).toBe("2026-10");
  });

  it("estorno vai para a categoria e o estabelecimento do original", () => {
    const orig = tx({ id: "orig", amount: 100, description: "THALES BAR" });
    const refund = tx({
      id: "ref", amount: 40, description: "ESTORNO", category_id: null,
      movement_kind: "refund", type: "income", refund_of_transaction_id: "orig", occurred_at: "2026-09-12",
    });
    const r = aggregate({ ...base, rows: [orig, refund], scope: { merchant: "thales", category_ids: ["cat-lazer"] } });
    expect(r.total).toBe(60);
  });

  it("limite preserva o total e conta o que ficou de fora", () => {
    const rows = [
      tx({ amount: 50, description: "A BAR" }), tx({ amount: 30, description: "B BAR" }), tx({ amount: 20, description: "C BAR" }),
    ];
    const r = aggregate({ ...base, rows, group_by: ["merchant"], limit: 2 });
    expect(r.groups).toHaveLength(2);
    expect(r.total).toBe(100);
    expect(r.omitted).toEqual({ groups: 1, total: 20 });
  });

  it("ignora linhas fora da janela de competência e não confirmadas", () => {
    const rows = [
      tx({ amount: 100, occurred_at: "2026-08-20", payment_method: "account", credit_card_id: null }),
      tx({ amount: 100, status: "pending" }),
    ];
    expect(aggregate({ ...base, rows }).total).toBe(0);
  });
});

// Paridade com o coletor auditado das séries (`collectScopedSpend`): mesmo
// recorte, mesmo total. Garante que o executor genérico não inventa uma
// segunda verdade contábil.
import { collectScopedSpend } from "../../supabase/functions/_shared/agent/core/handlers/MonthlySeriesHandler.ts";

function fakeSb(rows: any[], aliases: any[] = []) {
  const chain = (data: any[]) => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, in: () => q,
      range: (from: number, to: number) => Promise.resolve({ data: data.slice(from, to + 1), error: null }),
      then: (res: any) => Promise.resolve({ data, error: null }).then(res),
    };
    return q;
  };
  return { from: (table: string) => chain(table === "merchant_aliases" ? aliases : rows) };
}

describe("paridade com collectScopedSpend", () => {
  it("categoria + estabelecimento + estorno: mesmo total e mesma contagem", async () => {
    const orig = tx({ id: "o1", amount: 100, description: "THALES BAR", occurred_at: "2026-09-05" });
    const rows = [
      orig,
      tx({ amount: 55.5, description: "THALES BAR", occurred_at: "2026-09-18" }),
      tx({ amount: 80, description: "UBER TRIP", category_id: "cat-transp" }),
      tx({ id: "r1", amount: 30, description: "ESTORNO", category_id: null, type: "income",
        movement_kind: "refund", refund_of_transaction_id: "o1", occurred_at: "2026-09-12" }),
    ];
    const scoped = await collectScopedSpend(fakeSb(rows), {
      user_id: "u", from: "2026-09-01", to: "2026-09-30",
      category_ids: ["cat-lazer"], merchant: "thales",
    });
    const generic = aggregate({
      ...base, rows, scope: { category_ids: ["cat-lazer"], merchant: "thales" },
    });
    const scopedTotal = Math.round(scoped.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    expect(generic.total).toBe(scopedTotal);
    expect(generic.transaction_count).toBe(scoped.length);
  });
});
