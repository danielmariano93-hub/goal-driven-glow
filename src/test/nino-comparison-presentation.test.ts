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
