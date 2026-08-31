import { describe, expect, it } from "vitest";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { formatForecastMonthClose } from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";

describe("Nino — previsão de fechamento", () => {
  it("roteia pergunta de fechamento do mês para a tool canônica", () => {
    for (const q of [
      "Nino, qual a previsão de eu fechar o mês?",
      "quanto vou gastar neste mês?",
      "como fecho o mês?",
    ]) {
      const decision = classifyCapability(q, {} as any, null);
      expect(decision.required_tool).toBe("forecast_month_close");
      expect(decision.execution).toBe("deterministic");
    }
  });

  it("formata previsão com fato, composição e evidência", () => {
    const reply = formatForecastMonthClose({
      month: "2026-08",
      point: 4200.5,
      low: 3900,
      high: 4600,
      model_used: "financial_snapshot_contract.v9+observed",
      drivers: { mtd_expense: 2100, day_of_month: 12, days_in_month: 31, recurring_future: 900 },
      provenance: { row_count: 88, confidence: "medium" },
    });
    expect(reply).toContain("4.200,50");
    expect(reply).toContain("3.900,00");
    expect(reply).toContain("88 lançamentos");
    expect(reply).not.toMatch(/confiança|contract|v8/i);
  });
});
