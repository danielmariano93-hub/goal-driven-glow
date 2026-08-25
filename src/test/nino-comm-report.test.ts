import { describe, expect, it } from "vitest";
import { deterministicClosing, deterministicDetails, deterministicSummary } from "@/lib/reports/intelligent/narrative";
import { countNumbers } from "@/lib/copy/ninoVoice";
import type { IntelligentReport } from "@/lib/reports/intelligent/types";

const report = {
  reportType: "monthly_partial",
  period: { label: "agosto de 2026", start: "2026-08-01", end: "2026-08-25" },
  previousPeriod: { label: "julho de 2026", start: "2026-07-01", end: "2026-07-31" },
  healthScore: 6.4,
  highlights: [{ title: "Delivery cresceu", body: "Delivery subiu R$ 290 no período." }],
  payload: {
    totals: {
      income: 3000,
      expense: 7229.83,
      expenseDeltaPct: -60.47,
      daysWithExpense: 18,
      dailyAvgExpense: 401.65,
    },
    categories: [{ category: "Alimentação", total: 1500, share: 0.207 }],
    partial: { daysElapsed: 25, daysInMonth: 31, projectedExpense: 8965 },
  },
} as unknown as IntelligentReport;

describe("nino_comm.v1 — relatório com conclusão executiva", () => {
  const summary = deterministicSummary(report);

  it("abre com conclusão em no máximo 3 frases", () => {
    const sentences = summary.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(sentences[0]).toContain("acima do que recebeu");
  });

  it("não enfileira todos os indicadores no nível 1", () => {
    expect(summary).not.toContain("média de");
    expect(summary).not.toContain("Nota de saúde");
    expect(summary).not.toContain("dias com gasto");
    expect(countNumbers(summary)).toBeLessThanOrEqual(4);
  });

  it("zero percentual com 2 casas na conclusão", () => {
    expect(summary).toContain("60%");
    expect(summary).not.toContain("60,47");
  });

  it("os fatos de apoio continuam disponíveis no nível 2", () => {
    const details = deterministicDetails(report);
    const joined = details.join(" ");
    expect(joined).toContain("Nota de saúde");
    expect(joined).toContain("dias com gasto");
    expect(joined).toContain("R$ 8.965,00");
  });

  it("fechamento é um próximo passo curto", () => {
    expect(deterministicClosing(report).split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);
  });
});
