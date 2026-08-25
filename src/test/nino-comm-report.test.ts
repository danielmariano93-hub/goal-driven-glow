import { describe, expect, it } from "vitest";
import { deterministicClosing, deterministicDetails, deterministicSummary, whatsappMessage } from "@/lib/reports/intelligent/narrative";
import { buildReportReading, presentReportHighlight } from "@/lib/reports/intelligent/presentation";
import { countNumbers } from "@/lib/copy/ninoVoice";
import type { IntelligentReport } from "@/lib/reports/intelligent/types";
import type { ReportDetail, ReportHighlightRow } from "@/lib/reports/intelligent/client";

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
      flexibleTotal: 1500,
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
    expect(countNumbers(summary)).toBeLessThanOrEqual(3);
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
    expect(joined).toMatch(/R\$\s?8\.965,00/);
  });

  it("fechamento é um próximo passo curto", () => {
    expect(deterministicClosing(report).split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);
  });

  it("WhatsApp do relatório deixa de ser tabela de indicadores", () => {
    const message = whatsappMessage(report, "https://meunino.com.br/r/abc");
    expect(message.split("\n").length).toBeLessThanOrEqual(4);
    expect(message).not.toContain("Receitas:");
    expect(message).not.toContain("Nota de saúde");
  });

  it("tela reinterpreta relatório persistido em níveis", () => {
    const detail = {
      id: "r1",
      report_type: report.reportType,
      period_start: report.period.start,
      period_end: report.period.end,
      status: "published",
      health_score: report.healthScore,
      executive_summary: "texto antigo denso com receitas, despesas, categorias e recomendação em um bloco.",
      data_quality_status: "ok",
      generated_at: "2026-08-25T00:00:00Z",
      viewed_at: null,
      timezone: "America/Sao_Paulo",
      closing_text: "Próximo passo antigo.",
      text_source: "deterministic",
      health_breakdown: [],
      data_quality_flags: [],
      payload: report.payload,
      metrics: [],
      highlights: [],
    } as ReportDetail;
    const reading = buildReportReading(detail);
    expect(reading.headline).toContain("a mais do que recebeu");
    expect(reading.context).toContain("caíram 60%");
    expect(reading.nextStep).toContain("gastos que dão pra ajustar");
    expect(countNumbers([reading.headline, reading.context, reading.nextStep].join(" "))).toBeLessThanOrEqual(3);
  });

  it("destaque de sem categoria vira conversa, não analytics", () => {
    const highlight = {
      id: "h1",
      detector_key: "uncategorized",
      type: "info",
      title: "73,15% das despesas estão sem categoria",
      body: "São 8 lançamento(s) somando R$ 2.566,00. Classificar os maiores melhora todas as leituras seguintes.",
      confidence: "high",
      category: null,
      cta_label: "Classificar lançamentos",
      cta_route: "/app/lancamentos",
      evidence: { total: 2566, count: 8, share: 73.15 },
      sort_order: 0,
    } as ReportHighlightRow;
    const presented = presentReportHighlight(highlight);
    expect(presented.title).toBe("Lançamentos sem categoria estão atrapalhando a leitura.");
    expect(presented.title).not.toMatch(/73,15|explicou/);
    expect(presented.body).toContain("Antes de concluir");
  });
});
