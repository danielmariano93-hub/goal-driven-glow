import { describe, expect, it } from "vitest";
import { mappingForQuery } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { aggregate } from "../../supabase/functions/_shared/agent/core/handlers/GenericAggregate";
import { formatSpendingAggregate } from "../../supabase/functions/_shared/agent/core/handlers/GenericAggregateFormat";
import { validateFinancialIRv2 } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";

const period = { from: "2026-09-01", to: "2026-10-31" };
const q = (group_by: string[], extra: Record<string, unknown> = {}) => ({
  id: "q1", metric: "expense_amount", operation: "breakdown", group_by, filters: [], limit: null, ...extra,
}) as any;
const ir = (on: boolean) => ({ period, comparison_period: null, execution_options: { generic_aggregate: on } }) as any;

describe("dois agrupamentos (executor genérico)", () => {
  it("categoria × mês vai para o executor genérico com as duas dimensões, na ordem pedida", () => {
    const m = mappingForQuery(q(["category", "month"]), ir(true));
    expect(m?.tool).toBe("spending_aggregate");
    expect((m?.args as any).group_by).toEqual(["category", "month"]);
    expect((m?.args as any).limit).toBe(20);
  });
  it("com a opção desligada não há mapeamento (recusa/autocorreção, nunca motor dedicado lendo só a primeira)", () => {
    expect(mappingForQuery(q(["category", "merchant"]), ir(false))).toBeNull();
    expect(mappingForQuery(q(["card", "category"]), ir(false))).toBeNull();
  });
  it("recusa combinações sem leitura única", () => {
    expect(mappingForQuery(q(["category", "category"]), ir(true))).toBeNull();
    expect(mappingForQuery(q(["month", "weekday"]), ir(true))).toBeNull();
    expect(mappingForQuery(q(["category", "merchant", "card"]), ir(true))).toBeNull();
    expect(mappingForQuery(q(["category", "month"], { operation: "trend" }), ir(true))).toBeNull();
    expect(mappingForQuery(q(["category", "month"], { filters: [{ field: "category", op: "eq", value: "Mercado" }] }), ir(true))).toBeNull();
    expect(mappingForQuery(q(["category", "card"], { metric: "income_amount" }), ir(true))).toBeNull();
  });
  it("uma dimensão continua como antes", () => {
    expect(mappingForQuery(q(["merchant"]), ir(true))).not.toBeNull();
  });
  it("o IR aceita até duas dimensões e recusa três", () => {
    const mk = (g: string[]) => ({ intent: "analyze", queries: [{ ...q(g), id: "q1", depends_on: [] }], period });
    expect(validateFinancialIRv2(mk(["category", "month"])).filter((e) => e.includes("group_by"))).toEqual([]);
    expect(validateFinancialIRv2(mk(["category", "month", "card"])).some((e) => e.includes("group_by"))).toBe(true);
  });
  it("o núcleo soma certo por par e o texto mostra 'A · B'", () => {
    let n = 0;
    const tx = (over: Record<string, unknown>) => ({
      id: `t${++n}`, account_id: "acc1", category_id: "c1", type: "expense", status: "confirmed",
      amount: 100, occurred_at: "2026-09-10", description: "X", payment_method: "credit_card",
      credit_card_id: "card1", movement_kind: "transaction", competence_date: null, refund_of_transaction_id: null, ...over,
    });
    const rows = [
      tx({ amount: 100 }), tx({ amount: 50, occurred_at: "2026-09-12" }),
      tx({ amount: 30, occurred_at: "2026-10-02" }), tx({ amount: 20, occurred_at: "2026-10-03", category_id: "c2" }),
    ] as any[];
    const r = aggregate({
      metric: "expense", rows, from: "2026-09-01", to: "2026-10-31", group_by: ["category", "month"],
      lookups: { categories: new Map([["c1", "Mercado"], ["c2", "Lazer"]]), cards: new Map(), accounts: new Map() },
    } as any);
    const byLabel = Object.fromEntries(r.groups.map((g) => [g.label, g.total]));
    expect(byLabel["Mercado · 2026-09"]).toBe(150);
    expect(byLabel["Mercado · 2026-10"]).toBe(30);
    expect(byLabel["Lazer · 2026-10"]).toBe(20);
    expect(r.total).toBe(200);
    const text = formatSpendingAggregate({ ...r, engine: "spending_aggregate", period: { from: r.window.from, to: r.window.to }, scope_labels: { category: null, card: null, account: null }, headline: "", executed_ir: {} } as any);
    expect(text).toContain("Mercado · 2026-09");
  });
});
