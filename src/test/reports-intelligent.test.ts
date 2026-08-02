import { describe, it, expect } from "vitest";
import { lastClosedWeek, lastClosedMonth, previousOf, daysInPeriod } from "@/lib/reports/intelligent/periods";
import { buildIntelligentReport } from "@/lib/reports/intelligent/engine";
import { collectAllowedNumbers, validateNumbers } from "@/lib/reports/intelligent/numericGuard";
import { deterministicSummary, whatsappMessage } from "@/lib/reports/intelligent/narrative";
import type { TransactionRow } from "@/lib/engine/facts";

const tx = (over: Partial<TransactionRow>): TransactionRow => ({
  id: crypto.randomUUID(),
  account_id: "acc-1",
  type: "expense",
  status: "confirmed",
  amount: 100,
  occurred_at: "2026-07-08",
  category_id: null,
  description: null,
  transfer_group_id: null,
  ...over,
} as TransactionRow);

describe("períodos dos relatórios", () => {
  it("semana fechada é a segunda a domingo anterior", () => {
    // 2026-07-15 é uma quarta-feira
    const p = lastClosedWeek(new Date("2026-07-15T10:00:00Z"));
    expect(p.start).toBe("2026-07-06");
    expect(p.end).toBe("2026-07-12");
    expect(daysInPeriod(p)).toBe(7);
  });

  it("mês fechado é o mês anterior completo", () => {
    const p = lastClosedMonth(new Date("2026-08-02T10:00:00Z"));
    expect(p.start).toBe("2026-07-01");
    expect(p.end).toBe("2026-07-31");
    expect(p.label).toBe("julho de 2026");
  });

  it("período anterior mantém mesma duração", () => {
    const week = lastClosedWeek(new Date("2026-07-15T10:00:00Z"));
    const prev = previousOf(week, "weekly");
    expect(prev.start).toBe("2026-06-29");
    expect(prev.end).toBe("2026-07-05");
    const month = lastClosedMonth(new Date("2026-08-02T10:00:00Z"));
    expect(previousOf(month, "monthly").start).toBe("2026-06-01");
  });
});

describe("motor de relatório", () => {
  const categoryNames = { "cat-lazer": "Lazer", "cat-moradia": "Moradia" };
  const transactions = [
    tx({ type: "income", amount: 5000, occurred_at: "2026-07-06", category_id: null }),
    tx({ amount: 1200, occurred_at: "2026-07-07", category_id: "cat-moradia" }),
    tx({ amount: 400, occurred_at: "2026-07-08", category_id: "cat-lazer" }),
    tx({ amount: 100, occurred_at: "2026-07-09", category_id: "cat-lazer" }),
    // período anterior
    tx({ amount: 800, occurred_at: "2026-07-01", category_id: "cat-moradia" }),
    // fora de qualquer janela
    tx({ amount: 9999, occurred_at: "2026-05-01", category_id: "cat-lazer" }),
  ];

  const report = buildIntelligentReport({
    reportType: "weekly",
    referenceDate: new Date("2026-07-15T10:00:00Z"),
    transactions,
    categoryNames,
  });

  it("usa apenas o período fechado e calcula totais canônicos", () => {
    expect(report.period.start).toBe("2026-07-06");
    expect(report.payload.totals.income).toBe(5000);
    expect(report.payload.totals.expense).toBe(1700);
    expect(report.payload.totals.net).toBe(3300);
    expect(report.payload.totals.savingsRate).toBeCloseTo(0.66, 2);
    expect(report.payload.totals.transactionCount).toBe(4);
  });

  it("compara com o período anterior", () => {
    expect(report.payload.totals.previousExpense).toBe(800);
    expect(report.payload.totals.expenseDeltaPct).toBeCloseTo(112.5, 1);
  });

  it("ordena categorias por total e calcula participação", () => {
    expect(report.payload.categories[0].category).toBe("Moradia");
    expect(report.payload.categories[0].share).toBeCloseTo(1200 / 1700, 3);
    expect(report.payload.categories[1].category).toBe("Lazer");
    expect(report.payload.categories[1].total).toBe(500);
  });

  it("gera série diária cobrindo todos os dias do período", () => {
    expect(report.payload.series).toHaveLength(7);
    expect(report.payload.series[0].date).toBe("2026-07-06");
    expect(report.payload.series.at(-1)!.cumulativeExpense).toBe(1700);
  });

  it("calcula nota de saúde entre 0 e 10 com componentes somando o total", () => {
    const sum = report.healthBreakdown.reduce((s, c) => s + c.score, 0);
    expect(report.healthScore).toBeCloseTo(Math.min(10, sum), 2);
    expect(report.healthScore).toBeGreaterThan(0);
    expect(report.healthScore).toBeLessThanOrEqual(10);
  });

  it("produz destaques com evidência e no máximo 5 itens", () => {
    expect(report.highlights.length).toBeGreaterThan(0);
    expect(report.highlights.length).toBeLessThanOrEqual(5);
    for (const h of report.highlights) {
      expect(h.dedupKey).toContain("2026-07-06");
      expect(h.selectionReason.length).toBeGreaterThan(3);
    }
    expect(report.highlights.some((h) => h.detectorKey === "expense_spike")).toBe(true);
  });

  it("marca período sem lançamentos como insuficiente", () => {
    const empty = buildIntelligentReport({
      reportType: "weekly",
      referenceDate: new Date("2026-07-15T10:00:00Z"),
      transactions: [],
    });
    expect(empty.dataQualityStatus).toBe("insufficient");
    expect(empty.highlights.some((h) => h.detectorKey === "no_activity")).toBe(true);
  });

  it("resumo determinístico só cita números do relatório", () => {
    const allowed = collectAllowedNumbers({
      metrics: report.metrics,
      totals: report.payload.totals,
      categories: report.payload.categories,
      health: report.healthScore,
    });
    expect(validateNumbers(deterministicSummary(report), allowed).ok).toBe(true);
  });

  it("mensagem de WhatsApp é curta e leva o link", () => {
    const msg = whatsappMessage(report, "https://www.meunino.com.br/app/relatorios-inteligentes/x");
    expect(msg).toContain("Relatório completo: https://www.meunino.com.br");
    expect(msg.split("\n").length).toBeLessThan(14);
  });
});

describe("guardrail numérico", () => {
  const allowed = collectAllowedNumbers({ a: 1234.56, b: 12.5 });

  it("aprova números presentes nos fatos", () => {
    expect(validateNumbers("Você gastou R$ 1.234,56 e a taxa foi 12,5%.", allowed).ok).toBe(true);
  });

  it("bloqueia número inventado", () => {
    const r = validateNumbers("Você gastou R$ 9.876,54 no período.", allowed);
    expect(r.ok).toBe(false);
    expect(r.offending[0]).toContain("9.876");
  });

  it("tolera contagens pequenas de linguagem natural", () => {
    expect(validateNumbers("Foram 3 lançamentos em 7 dias.", allowed).ok).toBe(true);
  });
});

describe("mergeHighlights", () => {
  const base = {
    type: "risk" as const,
    title: "t",
    body: "b",
    confidence: "high" as const,
    evidence: {},
    selectionReason: "r",
  };
  it("mantém apenas um destaque por família, favorecendo o período no empate", () => {
    const merged = mergeHighlights(
      [{ ...base, detectorKey: "card_over_cash", family: "cartao", priority: 95, dedupKey: "p:cartao" }],
      [{ ...base, detectorKey: "card_debt_vs_income", family: "cartao", priority: 95, dedupKey: "c:cartao" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].detectorKey).toBe("card_over_cash");
    expect(merged[0].source).toBe("period");
  });
  it("agrega destaques do catálogo em famílias novas e respeita o limite", () => {
    const merged = mergeHighlights(
      [{ ...base, detectorKey: "negative_result", family: "resultado", priority: 100, dedupKey: "p:res" }],
      [
        { ...base, detectorKey: "debt_above_income", family: "dividas", priority: 93, dedupKey: "c:div" },
        { ...base, detectorKey: "subscriptions_load", family: "assinaturas", priority: 62, dedupKey: "c:ass" },
      ],
      2,
    );
    expect(merged.map((h) => h.family)).toEqual(["resultado", "dividas"]);
    expect(merged[1].source).toBe("catalog");
  });
});
