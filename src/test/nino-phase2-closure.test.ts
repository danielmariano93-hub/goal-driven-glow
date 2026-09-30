import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceReferences,
  captureReferenceObjects,
  monthlySeriesEvidenceFromCall,
} from "../../supabase/functions/_shared/agent/core/ConversationReferenceStore";
import {
  monthlySpendingSeriesText,
  type MonthlySpendingSeriesResult,
} from "../../supabase/functions/_shared/agent/core/handlers/MonthlySeriesHandler";
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  reportingCompetenceDate,
  type TransactionRow,
} from "../../supabase/functions/_shared/finance-core/facts";
import { isContextualChartFollowup } from "../../supabase/functions/_shared/intelligence/chartIntent";
import { buildMonthlySeriesChartArtifact } from "../../supabase/functions/_shared/intelligence/monthlySeriesChart";

function monthlyFixture(): MonthlySpendingSeriesResult {
  return {
    version: "nino_monthly_series.v1",
    formula_version: "monthly_spending_series.v1",
    months: [
      { month: "2026-04", total: 80, has_data: true, transaction_count: 1 },
      { month: "2026-05", total: 14, has_data: true, transaction_count: 1 },
      { month: "2026-06", total: 160, has_data: true, transaction_count: 1 },
      { month: "2026-07", total: 72, has_data: true, transaction_count: 2 },
      { month: "2026-08", total: 125, has_data: true, transaction_count: 3 },
      { month: "2026-09", total: 155, has_data: true, transaction_count: 3 },
    ],
    total: 606,
    transaction_count: 11,
    window: { from: "2026-04-01", to: "2026-09-26", n: 6 },
    scope: { category: "Lazer", merchant: "Thales" },
    partial_first_month: false,
    partial_last_month: true,
  };
}

function tx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "tx-base",
    account_id: "acc-1",
    category_id: "cat-lazer",
    type: "expense",
    status: "confirmed",
    amount: 100,
    occurred_at: "2026-08-10",
    description: "Teste",
    transfer_group_id: null,
    payment_method: "account",
    credit_card_id: null,
    competence_date: null,
    posted_at: null,
    posted_at_source: null,
    settles_card_id: null,
    movement_kind: "transaction",
    investment_id: null,
    refund_of_transaction_id: null,
    ...overrides,
  };
}

describe("Fase 2 — evidência analítica durável", () => {
  it("projeta a série mensal executada sem perder nenhum fato financeiro", () => {
    const fixture = monthlyFixture();
    const evidence = monthlySeriesEvidenceFromCall({
      tool_name: "spending_timeseries_monthly",
      ok: true,
      args: { query_id: "q1" },
      result: fixture,
    });

    expect(evidence).not.toBeNull();
    expect(evidence).toMatchObject({
      kind: "monthly_series",
      version: "nino_monthly_series.v1",
      formula_version: fixture.formula_version,
      total: 606,
      transaction_count: 11,
      window: fixture.window,
      scope: fixture.scope,
      partial_first_month: false,
      partial_last_month: true,
    });
    expect(evidence?.months).toEqual(fixture.months);
  });

  it("captura a evidência mensal no Reference Store e a mantém por TTL", () => {
    const now = new Date("2026-09-26T18:00:00-03:00");
    const refs = captureReferenceObjects([{
      tool_name: "spending_timeseries_monthly",
      ok: true,
      args: { query_id: "q1" },
      result: monthlyFixture(),
    }], now);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      target: "category",
      source: {
        tool_name: "spending_timeseries_monthly",
        query_id: "q1",
        context: {
          months: 6,
          target_period: { from: "2026-04-01", to: "2026-09-26" },
          evidence: { kind: "monthly_series", total: 606 },
        },
      },
    });

    let current = refs;
    for (let i = 0; i < 8; i++) current = advanceReferences(current, new Date(now.getTime() + i * 60_000));
    expect(current[0].status).toBe("active");
    expect(current[0].turns_remaining).toBeGreaterThan(0);
  });

  it("o bridge V2 persiste a série real e deixa de usar result=null para monthly series", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2Entry.ts", "utf8");
    expect(source).toContain('evidence.kind === "monthly_series"');
    expect(source).toContain('tool_name: "spending_timeseries_monthly"');
    expect(source).toContain("monthlySeriesEvidenceResult(evidence)");
    expect(source).toContain("formulaVersionsFromCalls");
    expect(source).toContain("bindRequestedArtifact(input, turn)");
    expect(source).toContain('media_status: "pending"');
  });
});

describe("Fase 2 — texto e gráfico compartilham a mesma verdade", () => {
  it("mantém valores, escopo, janela, fórmula e contagem idênticos entre texto e artefato", () => {
    const fixture = monthlyFixture();
    const text = monthlySpendingSeriesText(fixture).replace(/\u00a0/g, " ");
    const artifact = buildMonthlySeriesChartArtifact(fixture);

    expect(text).toContain("Lazer com Thales");
    expect(text).toContain("*Total:* R$ 606,00 em 11 lançamentos");
    expect(text).toContain("01/04/2026 a 26/09/2026");
    expect(artifact.chart.series[0].data).toEqual(fixture.months.map((point) => point.total));
    expect(artifact.provenance.formula_version).toBe(fixture.formula_version);
    expect(artifact.provenance.row_count).toBe(fixture.transaction_count);
    expect(artifact.provenance.period).toEqual({ from: fixture.window.from, to: fixture.window.to });
    expect(artifact.summary_text.replace(/\u00a0/g, " ")).toContain("R$ 606,00 em 11 lançamentos");
    expect(artifact.summary_text).toContain("01/04/2026 a 26/09/2026");
  });

  it.each([
    "Mostre isso em gráfico",
    "Manda o gráfico",
    "Quero visualizar esses dados",
    "Coloca essa resposta em gráfico",
  ])("reconhece follow-up visual contextual: %s", (text) => {
    expect(isContextualChartFollowup(text)).toBe(true);
  });

  it("não trata um novo pedido mensal explícito como referência ao resultado anterior", () => {
    expect(isContextualChartFollowup("Gere um gráfico de Alimentação mês a mês nos últimos 5 meses"))
      .toBe(false);
  });

  it("falha fechado no App em vez de fabricar gráfico genérico para follow-up sem evidência", () => {
    const app = readFileSync("supabase/functions/_shared/agent/core/adapters/AppAdapter.ts", "utf8");
    const fallback = readFileSync("supabase/functions/_shared/intelligence/chartFallback.ts", "utf8");
    expect(app).toContain("!isContextualChartFollowup(args.text)");
    expect(fallback).toContain("loadRecentSeriesEvidence");
    expect(fallback).toContain("referenced_chart_evidence_unavailable");
    expect(fallback).toContain("source_evidence");
  });
});

describe("Fase 2 — verdade financeira canônica", () => {
  it("estorno abate consumo; transferência e pagamento de fatura não viram gasto", () => {
    const expense = tx({ id: "expense", amount: 100 });
    const refund = tx({
      id: "refund",
      type: "income",
      amount: 30,
      category_id: null,
      movement_kind: "refund",
      refund_of_transaction_id: "expense",
    });
    const transfer = tx({
      id: "transfer",
      type: "transfer",
      amount: 400,
      transfer_group_id: "tg-1",
      movement_kind: "internal_transfer",
    });
    const invoicePayment = tx({
      id: "invoice",
      amount: 900,
      settles_card_id: "card-1",
      movement_kind: "transaction",
    });

    expect(behavioralMetricAmount(expense, "expense")).toBe(100);
    expect(behavioralMetricAmount(refund, "expense")).toBe(-30);
    expect(behavioralMetricAmount(transfer, "expense")).toBe(0);
    expect(behavioralMetricAmount(invoicePayment, "expense")).toBe(0);

    const netConsumption = [expense, refund, transfer, invoicePayment]
      .reduce((sum, row) => sum + behavioralMetricAmount(row, "expense"), 0);
    expect(netConsumption).toBe(70);
  });

  it("atribui o estorno à categoria da despesa original", () => {
    const original = tx({ id: "original", category_id: "cat-lazer", amount: 100 });
    const refund = tx({
      id: "refund",
      type: "income",
      category_id: null,
      amount: 20,
      movement_kind: "refund",
      refund_of_transaction_id: "original",
    });
    const attribution = buildRefundAttribution([original, refund]);
    expect(effectiveCategoryId(refund, attribution)).toBe("cat-lazer");
  });

  it("usa competência da fatura para compra no cartão e data econômica para conta", () => {
    const cardPurchase = tx({
      id: "card",
      occurred_at: "2026-07-30",
      payment_method: "credit_card",
      credit_card_id: "card-1",
      competence_date: "2026-08-01",
    });
    const pix = tx({
      id: "pix",
      occurred_at: "2026-07-30",
      payment_method: "pix",
      credit_card_id: null,
      competence_date: "2026-08-01",
    });

    expect(reportingCompetenceDate(cardPurchase)).toBe("2026-08-01");
    expect(reportingCompetenceDate(pix)).toBe("2026-07-30");
  });
});
