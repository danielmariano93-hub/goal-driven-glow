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
