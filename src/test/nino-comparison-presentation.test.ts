import { describe, expect, it } from "vitest";
import { comparisonHeader, comparisonPeriodLabel, formatPeriodComparisonEnhanced } from "../../supabase/functions/_shared/agent/core/ComparisonPresentation";
import { guardComposedReply } from "../../supabase/functions/_shared/agent/v3/ConversationalComposerV3";

const result = {
  total_a: 18414.95, total_b: 9803.59, delta_abs: -8611.36, delta_pct: -0.4676, by_group: [
    { name: "Moradia", total_a: 3412.07, total_b: 0, delta_abs: -3412.07, delta_pct: -1 },
  ],
  requested_group_by: "category",
  period_a: { from: "2026-09-01", to: "2026-09-30", partial: false },
  period_b: { from: "2026-10-01", to: "2026-10-31", partial: true },
};

describe("comparação nomeia os períodos e não deixa trocar os valores", () => {
  it("rótulo de período: mês inteiro vira nome do mês, o resto vira intervalo", () => {
    expect(comparisonPeriodLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe("outubro de 2026");
    expect(comparisonPeriodLabel({ from: "2026-02-01", to: "2026-02-28" })).toBe("fevereiro de 2026");
    expect(comparisonPeriodLabel({ from: "2026-10-01", to: "2026-10-15" })).toBe("01/10 a 15/10");
    expect(comparisonPeriodLabel(null)).toBeNull();
  });

  it("o cabeçalho diz qual total é de qual mês e avisa do mês aberto", () => {
    const header = comparisonHeader(result)!.replace(/\u00a0/g, " ");
    expect(header).toContain("*outubro de 2026*: R$ 9.803,59");
    expect(header).toContain("*setembro de 2026*: R$ 18.414,95");
    expect(header).toMatch(/outubro de 2026 ainda não terminou/);
    expect(formatPeriodComparisonEnhanced(result).replace(/\u00a0/g, " ").startsWith(header)).toBe(true);
  });

  it("sem os períodos no resultado, o texto é o de antes", () => {
    const { period_a: _a, period_b: _b, ...legacy } = result;
    expect(comparisonHeader(legacy)).toBeNull();
    expect(formatPeriodComparisonEnhanced(legacy)).toBe(formatPeriodComparisonEnhanced({ ...legacy }));
  });

  it("a abertura escrita pelo compositor não pode citar valores quando o corpo é uma comparação", () => {
    const input: any = {
      kind: "layout", channel: "whatsapp", user_text: "compare com o mês passado", history: [], relationship_context: null,
      deterministic_body: formatPeriodComparisonEnhanced(result), evidence: [result], allow_offer: false, capture_memory: false, today: "2026-10-29",
    };
    const wrong = guardComposedReply({ text: "Seu gasto em outubro foi R$ 18.414,95, contra R$ 9.803,59 no mês anterior.", input });
    expect(wrong.ok).toBe(false);
    expect(wrong.violations).toContain("comparison_opening_cites_money");
    expect(guardComposedReply({ text: "Aqui está a comparação entre outubro e setembro, com o detalhe logo abaixo.", input }).ok).toBe(true);
  });
});

import { computeCompare } from "../../supabase/functions/_shared/analytics/compare";

describe("variação percentual com base zerada ou só de estorno", () => {
  it("não inventa 0% quando a base é negativa ou zero e o valor mudou", () => {
    const names = new Map([["c1", "Rolê"], ["c2", "Pets"]]);
    const tx = (id: string, cat: string, amount: number, type: string, at: string, extra: Record<string, unknown> = {}) => ({
      id, category_id: cat, amount, type, status: "confirmed", occurred_at: at, account_id: "a", movement_kind: "transaction",
      transfer_group_id: null, payment_method: "pix", credit_card_id: null, settles_card_id: null, ...extra,
    });
    const result = computeCompare({
      txs: [
        tx("1", "c2", 61.47, "expense", "2026-10-05T12:00:00Z"),
        tx("2", "c1", 100, "expense", "2026-10-06T12:00:00Z"),
      ] as any,
      categoryNames: names, metric: "expense",
      period_a: { from: "2026-09-01", to: "2026-09-30" }, period_b: { from: "2026-10-01", to: "2026-10-31" },
      group_by: "category", category_scope: [],
    });
    for (const row of result.by_group) expect(row.delta_pct).toBeNull();
  });
});

import { mappingForQuery } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { merchantPeriodComparison } from "../../supabase/functions/_shared/agent/engineToolsImpl";

describe("comparação por estabelecimento", () => {
  const ir = { period: { from: "2026-10-01", to: "2026-10-29" }, comparison_period: { from: "2026-09-01", to: "2026-09-30" } } as any;
  const q = (over: Record<string, unknown> = {}) => ({
    id: "q1", metric: "expense_amount", operation: "compare", group_by: ["merchant"], filters: [], limit: null, depends_on: [],
    comparison_baseline: "period", ...over,
  } as any);

  it("mapeia para compare_periods por estabelecimento, com no máximo uma categoria de recorte", () => {
    const m = mappingForQuery(q({ filters: [{ field: "category", op: "eq", value: "Transporte" }] }), ir);
    expect(m?.tool).toBe("compare_periods");
    expect(m?.args).toMatchObject({ group_by: "merchant", category_scope: ["Transporte"], period_a: { from: "2026-09-01" }, period_b: { from: "2026-10-01" } });
    const two = mappingForQuery(q({ filters: ["Transporte", "Lazer"].map((value) => ({ field: "category", op: "eq", value })) }), ir);
    expect(two).toBeNull();
    expect(mappingForQuery(q({ comparison_baseline: "mean_previous_complete_months", comparison_baseline_window: 3 }), ir)).toBeNull();
    expect(mappingForQuery(q({ metric: "income_amount" }), ir)).toBeNull();
  });

  it("soma por estabelecimento nos dois períodos e declara o escopo", async () => {
    const tx = (id: string, desc: string, amount: number, at: string) => ({
      id, account_id: "a", category_id: "c1", type: "expense", status: "confirmed", amount, occurred_at: at, description: desc,
      transfer_group_id: null, payment_method: "pix", credit_card_id: null, settles_card_id: null, movement_kind: "transaction",
      competence_date: null, refund_of_transaction_id: null,
    });
    const rows = [
      tx("1", "Uber", 100, "2026-09-05T12:00:00Z"), tx("2", "Uber", 50, "2026-10-05T12:00:00Z"),
      tx("3", "99", 40, "2026-10-06T12:00:00Z"),
    ];
    const builder = (data: unknown): any => new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: (v: unknown) => void) => res({ data, error: null }) : () => builder(data) });
    const sb = { from: (table: string) => builder(table === "transactions" ? rows : table === "categories" ? [{ id: "c1", name: "Transporte" }] : []) };
    const out: any = await merchantPeriodComparison({ sb, user_id: "u" } as any, {
      period_a: { from: "2026-09-01", to: "2026-09-30" }, period_b: { from: "2026-10-01", to: "2026-10-29" }, category_name: "Transporte",
    });
    expect(out.total_a).toBe(100);
    expect(out.total_b).toBe(90);
    expect(out.delta_abs).toBe(-10);
    const uber = out.by_group.find((r: any) => /uber/i.test(r.name));
    expect(uber).toMatchObject({ total_a: 100, total_b: 50, delta_abs: -50 });
    const ninetyNine = out.by_group.find((r: any) => /99/.test(r.name));
    expect(ninetyNine).toMatchObject({ total_a: 0, total_b: 40, delta_pct: null });
    expect(out.applied_reference_scope).toEqual({ target: "category", entity_labels: ["Transporte"] });
  });

  it("a apresentação fala de estabelecimentos, não de categorias", () => {
    const text = formatPeriodComparisonEnhanced({
      total_a: 100, total_b: 90, delta_abs: -10, delta_pct: -0.1, requested_group_by: "merchant", coverage_a: 0.9, coverage_b: 1,
      by_group: [{ name: "Uber", total_a: 100, total_b: 50, delta_abs: -50, delta_pct: -0.5 }],
      period_a: { from: "2026-09-01", to: "2026-09-30", partial: false }, period_b: { from: "2026-10-01", to: "2026-10-31", partial: false },
    });
    expect(text).toMatch(/Diminuíram: .*Uber/);
    expect(text).toMatch(/estabelecimentos reconhecidos \(90%/);
    expect(text).not.toMatch(/categoria/i);
  });
});
