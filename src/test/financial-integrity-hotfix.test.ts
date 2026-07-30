import { describe, expect, it } from "vitest";
import { computeRhythm } from "@/lib/engine/spendingRhythm";
import { computeEmotionalSummary } from "@/lib/emotions/summary";
import { sanitize } from "../../supabase/functions/_shared/documents/types";
import { decideByRule } from "../../supabase/functions/_shared/categorization/pipeline";
import { parseBulkItems, sumItems } from "../../supabase/functions/_shared/agent/bulkParse";

describe("financial integrity hotfix", () => {
  it("faz o último ponto da série coincidir com as médias do resumo", () => {
    const result = computeRhythm([
      {
        id: "daily",
        account_id: "a",
        category_id: "food",
        type: "expense",
        status: "confirmed",
        amount: 90,
        occurred_at: "2026-07-01",
        description: "Mercado",
        transfer_group_id: null,
      },
      {
        id: "fixed",
        account_id: "a",
        category_id: "housing",
        type: "expense",
        status: "confirmed",
        amount: 900,
        occurred_at: "2026-07-02",
        description: "Aluguel",
        transfer_group_id: null,
      },
    ], { start: "2026-07-01", end: "2026-07-03" }, {
      categoryNameById: { food: "Alimentação", housing: "Moradia" },
    });

    expect(result.days).toBe(3);
    expect(result.series[2].runningAverage).toBe(result.average);
    expect(result.series[2].typicalRunningAverage).toBe(result.typicalAverage);
    expect(result.series[2].amount).toBe(0);
  });

  it("preserva antecipação negativa de fatura como pagamento positivo", () => {
    const result = sanitize({
      k: "invoice",
      i: [["expense", "2026-07-20", -500, "Antecipação da fatura", "credit_card", null, "4739", "payment"]],
    }, "2026-07-30");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "income",
      amount: 500,
      movement_kind: "card_payment",
    });
  });

  it("resolve categorias com acentos usando regra determinística", () => {
    const decision = decideByRule("Lovablelovable.devus", [
      { id: "service", name: "Serviços" },
    ]);
    expect(decision?.category_id).toBe("service");
  });

  it("calcula sequência e meta emocional por dias distintos", () => {
    const summary = computeEmotionalSummary([
      { mood: 4, occurred_at: "2026-07-30T09:00:00Z", trigger_label: "Tranquilidade" },
      { mood: 3, occurred_at: "2026-07-30T18:00:00Z", trigger_label: "Tranquilidade" },
      { mood: 2, occurred_at: "2026-07-29T09:00:00Z", trigger_label: "Ansiedade" },
    ], "2026-07-30");

    expect(summary.streakDays).toBe(2);
    expect(summary.checkinsLast7Days).toBe(2);
    expect(summary.weeklyProgress).toBe(0.4);
    expect(summary.dominantTrigger).toBe("Tranquilidade");
  });

  it("preserva metadados do JSON colado e calcula o líquido da fatura", () => {
    const parsed = parseBulkItems(JSON.stringify({
      items: [
        { description: "Mercado 03/10", amount: 120, type: "expense", category: "Mercado", installments_total: 10, installment_number: 3 },
        { description: "Antecipação da fatura", amount: 50, type: "income", movement_kind: "card_payment" },
      ],
    }), 2);

    expect(parsed.items[0]).toMatchObject({
      category_hint: "Mercado",
      installments_total: 10,
      installment_number: 3,
    });
    expect(sumItems(parsed.items)).toBe(70);
  });
});
