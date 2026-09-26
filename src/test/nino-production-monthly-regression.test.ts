import { describe, expect, it } from "vitest";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate.ts";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter.ts";
import { normalizeToV2, validateFinancialIRv2 } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR.ts";
import { validateFinancialPlan } from "../../supabase/functions/_shared/agent/core/FinancialPlanValidator.ts";

const PERIOD = { from: "2026-09-01", to: "2026-09-26", label: "este mês" };

describe("produção 26/09 — hardening definitivo das leituras mensais", () => {
  it.each([
    ["Quanto gasto por mês com assinaturas?", "Assinaturas"],
    ["Quanto gasto por mês com lazer?", "Lazer"],
    ["Quanto eu gasto aproximadamente por mês com transporte?", "Transporte"],
  ])("resolve %s antes do Conversation Brain", (text, category) => {
    const turn = resolveNarrowDeterministicTurn(text);
    expect(turn).not.toBeNull();
    expect(turn).toMatchObject({
      act: "new_request",
      mode: "read",
      domain: "financial_read",
      inherit_focus: false,
      focus: { category },
      financial_read: {
        intent: "analyze",
        queries: [{
          metric: "expense_amount",
          operation: "value",
          group_by: [],
          filters: [{ field: "category", value: category }],
        }],
      },
    });
  });

  it("não derruba um escopo desconhecido e responde média geral por engano", () => {
    expect(resolveNarrowDeterministicTurn("Quanto gasto por mês com categoria inventada xyz?")).toBeNull();
  });

  it("preserva a série factual exata de Alimentação dos últimos 5 meses", () => {
    const turn = resolveNarrowDeterministicTurn("Quanto gastei com Alimentação por mês nos últimos 5 meses?");
    expect(turn).toMatchObject({
      mode: "read",
      domain: "financial_read",
      focus: {
        category: "Alimentação",
        period_expression: "últimos 5 meses",
      },
      financial_read: {
        queries: [{
          metric: "expense_amount",
          operation: "trend",
          group_by: ["month"],
          filters: [{ field: "category", value: "Alimentação" }],
        }],
      },
    });
  });

  it("preserva a série factual exata do Thales dos últimos 10 meses", () => {
    const turn = resolveNarrowDeterministicTurn("Quanto gastei no Thales por mês nos últimos 10 meses?");
    expect(turn).toMatchObject({
      mode: "read",
      domain: "financial_read",
      focus: {
        merchant: "Thales",
        period_expression: "últimos 10 meses",
      },
      financial_read: {
        queries: [{
          metric: "expense_amount",
          operation: "trend",
          group_by: ["month"],
          filters: [{ field: "merchant", value: "Thales" }],
        }],
      },
    });
  });

  it("canonicaliza sum+month escopado antes do validador e mapeia para spending_timeseries_monthly", () => {
    const base = resolveNarrowDeterministicTurn("Quanto gastei com Alimentação por mês nos últimos 5 meses?");
    expect(base).not.toBeNull();
    const turn: any = {
      ...base,
      financial_read: {
        ...base!.financial_read,
        queries: base!.financial_read!.queries.map((q) => ({
          ...q,
          operation: "sum",
          group_by: ["month"],
        })),
      },
    };

    const compiled = compileFinancialReadFromTurn({ turn, period: PERIOD });
    expect(compiled?.ir?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "trend",
      group_by: ["month"],
      filters: [{ field: "category", op: "eq", value: "Alimentação" }],
    });

    const v2 = normalizeToV2(compiled!.ir!);
    expect(validateFinancialIRv2(v2)).not.toContain("q1_value_with_group_by");
    const validation = validateFinancialPlan(v2);
    expect(validation.errors).toEqual([]);
    expect(validation.mapped.map((item) => item.tool)).toContain("spending_timeseries_monthly");
  });

  it("não transforma uma agregação mensal global sem filtro na série escopada", () => {
    const scoped = resolveNarrowDeterministicTurn("Quanto gastei com Alimentação por mês nos últimos 5 meses?")!;
    const turn: any = {
      ...scoped,
      focus: { ...scoped.focus, category: null },
      financial_read: {
        ...scoped.financial_read,
        queries: [{
          ...scoped.financial_read!.queries[0],
          operation: "sum",
          group_by: ["month"],
          filters: [],
        }],
      },
    };
    const compiled = compileFinancialReadFromTurn({ turn, period: PERIOD });
    expect(compiled?.ir?.queries[0].operation).toBe("sum");
    const v2 = normalizeToV2(compiled!.ir!);
    expect(validateFinancialIRv2(v2)).toContain("q1_value_with_group_by");
  });
});
