import { describe, expect, it } from "vitest";
import { buildCashHorizon } from "../../supabase/functions/_shared/proactive/cashHorizon";
import { collectFinancialSignals } from "../../supabase/functions/_shared/proactive/signals";
import { composeFinancialSituations } from "../../supabase/functions/_shared/proactive/situations";
import { allocateAttention, scoreSituations } from "../../supabase/functions/_shared/proactive/ranking";
import type { MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";

function ctxOf(overrides: Partial<MultiFinanceProactiveContext> = {}): MultiFinanceProactiveContext {
  const base: MultiFinanceProactiveContext = {
    version: "proactive_multifinance.v1",
    user_id: "u1",
    as_of: "2026-08-10",
    monthly_income: 8000,
    materiality_floor: 160,
    available_today: 1200,
    projected_month_end_available: -400,
    daily_pace: 300,
    typical_daily_pace: 200,
    cash_horizon: [],
    first_negative_day: null,
    snapshot_ref: { reconciliation_id: "rec-1", formula_version: "financial_snapshot_contract.v9" },
    domains: {
      cash: { month_start: "2026-08-01", month_end: "2026-08-31", days_remaining: 21, known_future_commitments: 2500 },
      cards: { cards_owed: 3000, card_due_this_month: 2400, card_due_estimated: false, next_card_due_date: "2026-08-15" },
      goals: [],
      commitments: [],
      debts: [],
      patterns: [],
    },
    learning: {},
  };
  return { ...base, ...overrides, domains: { ...base.domains, ...(overrides.domains ?? {}) } };
}

describe("proactive_multifinance.v1 — horizonte de caixa", () => {
  it("acumula entradas e saídas em ordem de data", () => {
    const horizon = buildCashHorizon({
      today: "2026-08-10",
      availableToday: 1000,
      incomeEvents: [{ date: "2026-08-20", amount: 5000, label: "Salário" }],
      commitments: [
        { date: "2026-08-15", amount: 2400, type: "expense", name: "Fatura" },
        { date: "2026-08-25", amount: 300, type: "expense", name: "Assinatura" },
      ],
    });
    expect(horizon.map((p) => p.balance)).toEqual([-1400, 3600, 3300]);
  });

  it("ignora datas fora do horizonte", () => {
    const horizon = buildCashHorizon({
      today: "2026-08-10",
      availableToday: 100,
      incomeEvents: [],
      commitments: [{ date: "2026-12-01", amount: 900, type: "expense" }],
    });
    expect(horizon).toHaveLength(0);
  });
});

describe("proactive_multifinance.v1 — sinais e situações", () => {
  const negativeCtx = () => {
    const ctx = ctxOf();
    const horizon = buildCashHorizon({
      today: ctx.as_of,
      availableToday: ctx.available_today,
      incomeEvents: [],
      commitments: [{ date: "2026-08-15", amount: 2400, type: "expense", name: "Fatura do cartão" }],
    });
    return { ...ctx, cash_horizon: horizon, first_negative_day: horizon.find((p) => p.balance < 0) ?? null };
  };

  it("cruza fatura e caixa em uma única situação crítica", () => {
    const ctx = negativeCtx();
    const signals = collectFinancialSignals(ctx);
    expect(signals.some((s) => s.key.startsWith("cash_negative:"))).toBe(true);
    const situations = composeFinancialSituations(signals, ctx);
    const cross = situations.find((s) => s.type === "card_pressure_on_cash");
    expect(cross).toBeDefined();
    expect(cross!.severity).toBe("critical");
    expect(cross!.domains).toContain("cards");
    expect(cross!.domains).toContain("cash");
    // Sinal de fatura não pode virar uma segunda comunicação isolada.
    expect(situations.filter((s) => s.primary_domain === "cards")).toHaveLength(1);
  });

  it("nunca inventa valor: impacto vem do sinal canônico", () => {
    const ctx = negativeCtx();
    const situations = composeFinancialSituations(collectFinancialSignals(ctx), ctx);
    const cross = situations.find((s) => s.type === "card_pressure_on_cash")!;
    expect(cross.impact_amount).toBe(1200);
    expect(cross.evidence.reconciliation_id).toBe("rec-1");
  });

  it("prioriza situação integrada acima de padrão isolado", () => {
    const ctx = negativeCtx();
    const situations = scoreSituations(composeFinancialSituations(collectFinancialSignals(ctx), ctx), ctx);
    expect(situations[0].type).toBe("card_pressure_on_cash");
  });
});

describe("proactive_multifinance.v1 — orçamento de atenção", () => {
  it("libera apenas uma interrupção no WhatsApp e explica as retenções", () => {
    const ctx = ctxOf({
      domains: {
        ...ctxOf().domains,
        goals: [
          { goal_id: "g1", category_name: "Transporte", current_overage: 400, projected_overage: 0, days_remaining: 10, days_elapsed: 20, period_end: "2026-08-31", status: "exceeded" },
          { goal_id: "g2", category_name: "Assinaturas", current_overage: 0, projected_overage: 300, days_remaining: 10, days_elapsed: 20, period_end: "2026-08-31", status: "at_risk" },
        ],
      },
    });
    const situations = composeFinancialSituations(collectFinancialSignals(ctx), ctx);
    const { decisions, selected } = allocateAttention({ situations, ctx, channels: ["whatsapp"] });
    expect(selected).toHaveLength(1);
    expect(decisions.some((d) => d.decision === "suppress" && d.reason === "attention_budget_exhausted")).toBe(true);
  });

  it("retém situação já comunicada sem mudança material", () => {
    const ctx = ctxOf();
    const situations = composeFinancialSituations(collectFinancialSignals(ctx), ctx);
    const already = new Set(situations.map((s) => s.fingerprint));
    const { decisions, selected } = allocateAttention({ situations, ctx, channels: ["app"], alreadyDelivered: already });
    expect(selected).toHaveLength(0);
    expect(decisions.every((d) => d.reason === "already_communicated_no_material_change")).toBe(true);
  });

  it("retém itens abaixo do piso de materialidade", () => {
    const ctx = ctxOf({ projected_month_end_available: 500, daily_pace: 200, typical_daily_pace: 200 });
    ctx.domains.commitments = [
      { date: "2026-08-12", amount: 30, type: "expense", name: "Streaming", source: "recurring", estimated: false },
      { date: "2026-08-14", amount: 20, type: "expense", name: "App", source: "recurring", estimated: false },
    ];
    ctx.domains.cards = { card_due_this_month: 0 };
    const situations = composeFinancialSituations(collectFinancialSignals(ctx), ctx);
    const { decisions, selected } = allocateAttention({ situations, ctx, channels: ["app"] });
    expect(selected).toHaveLength(0);
    expect(decisions.some((d) => d.reason === "below_materiality_floor")).toBe(true);
  });
});
