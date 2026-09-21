import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { resolveReadIntent } from "../../supabase/functions/_shared/agent/core/IntentResolver";
import { fastFinancialIR } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import {
  cashFlowFromAgentBridge,
  formatFinancialSnapshot,
} from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";

const capability = (text: string) => classifyCapability(text, interpret(text), null);
const period = { from: "2026-09-01", to: "2026-09-20", label: "setembro" };

const veraBridge = {
  opening_cash: 629.52,
  closing_cash: 1512.18,
  operational_income: 0,
  operational_account_expense: 1322.46,
  investment_applications: 0,
  investment_redemptions: 0,
  card_payments: 167.81,
  loan_proceeds: 0,
  debt_principal_payments: 0,
  external_transfers_in: 5029,
  external_transfers_out: 2681,
  refunds_and_reimbursements: 24.93,
  adjustments: 0,
  reconciliation_difference: 0,
};

describe("Nino — intenção de fluxo de caixa", () => {
  it("roteia perguntas bancárias de entrou/saiu para o snapshot canônico", () => {
    for (const text of [
      "Quanto entrou na minha conta este mês?",
      "Quanto saiu da minha conta este mês?",
      "Qual foi meu fluxo de caixa?",
      "Quanto entrou este mês?",
      "Quanto saiu este mês?",
      "Quanto PIX entrou na conta?",
    ]) {
      expect(resolveReadIntent(text), text).toMatchObject({
        name: "financial_snapshot",
        required_tool: "get_financial_snapshot",
      });
      expect(capability(text), text).toMatchObject({
        name: "financial_snapshot",
        execution: "deterministic",
        required_tool: "get_financial_snapshot",
      });
    }
  });

  it("preserva renda/receita como métrica operacional, não como caixa", () => {
    expect(resolveReadIntent("Quanto de receita eu tive este mês?")).not.toMatchObject({ name: "financial_snapshot" });
    expect(fastFinancialIR("Quanto de receita eu tive este mês?", period)?.queries[0]).toMatchObject({
      metric: "income_amount",
      operation: "sum",
    });
    expect(resolveReadIntent("Quanto ganhei de salário este mês?")).not.toMatchObject({ name: "financial_snapshot" });
  });

  it("reproduz o fluxo de caixa da Vera e publica total apenas quando reconcilia", () => {
    const cash = cashFlowFromAgentBridge(veraBridge);
    expect(cash).toMatchObject({
      inflow: 5053.93,
      outflow: 4171.27,
      netFlow: 882.66,
      bankDelta: 882.66,
      publishable: true,
    });

    const reply = formatFinancialSnapshot({
      available_today: 1512.18,
      current_month_income: 0,
      current_month_expense: 1297.53,
      daily_pace: 0,
      typical_daily_pace: 0,
      known_future_commitments: 0,
      projected_month_end_available: 1512.18,
      cards_owed_estimated: false,
      cash_bridge: veraBridge,
    });

    expect(reply).toContain("Receitas da rotina: R$ 0,00");
    expect(reply).toContain("Fluxo de caixa: entrou R$ 5.053,93 · saiu R$ 4.171,27 · resultado +R$ 882,66");
    expect(reply).toContain("Caixa no período: R$ 629,52 → R$ 1.512,18 (+R$ 882,66)");
    expect(reply).not.toContain("Entrou este mês: R$ 0,00");
  });

  it("não publica total de entrou/saiu se componentes expostos não explicarem o saldo", () => {
    const incomplete = { ...veraBridge, closing_cash: 1522.18 };
    expect(cashFlowFromAgentBridge(incomplete)?.publishable).toBe(false);
    const reply = formatFinancialSnapshot({
      available_today: 1522.18,
      current_month_income: 0,
      current_month_expense: 1297.53,
      daily_pace: 0,
      typical_daily_pace: 0,
      known_future_commitments: 0,
      projected_month_end_available: 1522.18,
      cards_owed_estimated: false,
      cash_bridge: incomplete,
    });
    expect(reply).not.toContain("Fluxo de caixa: entrou");
    expect(reply).toContain("Caixa no período:");
  });
});
