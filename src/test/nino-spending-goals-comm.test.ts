import { describe, expect, it } from "vitest";
import { spendingGoalSituations } from "../../supabase/functions/_shared/proactive/spendingGoalSituations";
import { meetsSituationMateriality } from "../../supabase/functions/_shared/proactive/ranking";
import { readGoals, type SpendingGoalContext } from "../../supabase/functions/_shared/spendingGoals/runtime";
import { buildSpendingLedger, type MerchantTargetRow, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";
import { buildMerchantResolver } from "@/lib/engine/merchant";
import type { MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";

const TRANSPORTE = "cat-transporte";
const ASSINATURAS = "cat-assinaturas";
const LAZER = "cat-lazer";

let seq = 0;
const tx = (occurred_at: string, amount: number, merchant_name: string, category_id = TRANSPORTE): SpendingLedgerTx => ({
  id: `t${++seq}`, account_id: "acc", category_id, type: "expense", status: "confirmed", amount, occurred_at,
  description: merchant_name, merchant_name, transfer_group_id: null, movement_kind: "transaction",
} as SpendingLedgerTx);

function ctx(asOf: string): MultiFinanceProactiveContext {
  return {
    version: "proactive_multifinance.v1", user_id: "u", as_of: asOf, monthly_income: 8000, materiality_floor: 160,
    available_today: 3000, projected_month_end_available: 500, daily_pace: 100, typical_daily_pace: 80,
    cash_horizon: [], first_negative_day: null, snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
    domains: { cash: {}, cards: {}, goals: [{}], commitments: [], debts: [], debt_obligations: [], debt_obligations_available: true, patterns: [] },
    learning: {},
  };
}

function goal(id: string, category_id: string, limit: number, baseline: number | null = null) {
  return {
    id, user_id: "u", category_id, mode: "fixed_limit", reduction_pct: null, fixed_limit: limit, baseline_kind: "custom",
    baseline_value: baseline, computed_limit: limit, frequency: "monthly", start_date: "2026-08-01", end_date: null,
    status: "active", period_type: "monthly_recurring",
  } as const;
}

function sgContext(asOf: string, rows: SpendingLedgerTx[], targets: MerchantTargetRow[], goals: ReturnType<typeof goal>[]): SpendingGoalContext {
  const resolver = buildMerchantResolver();
  return {
    as_of: asOf, rows: rows as never, entries: buildSpendingLedger(rows, resolver), resolver,
    categories: [{ id: TRANSPORTE, name: "Transporte" }, { id: ASSINATURAS, name: "Assinaturas" }, { id: LAZER, name: "Lazer" }],
    goals: goals as never, targets,
  };
}

const appsTarget: MerchantTargetRow = {
  id: "apps", goal_id: "g-transp", label: "Uber + 99", merchant_keys: ["uber", "99"], limit_kind: "amount",
  computed_limit: 250, limit_amount: 250, baseline_amount: 500, status: "active",
};

describe("comunicação ativa das metas de gasto", () => {
  it("desvio da categoria aponta o responsável, a projeção e o disponível", () => {
    const asOf = "2026-09-12";
    const rows = [
      tx("2026-09-02", 120, "ON UBER TRIP H02/09"), tx("2026-09-05", 90, "PAY 99 TE"), tx("2026-09-09", 110, "Uber"),
      tx("2026-09-11", 45, "Uber"), tx("2026-09-10", 60, "Estacionamento Centro"),
    ];
    const sg = sgContext(asOf, rows, [appsTarget], [goal("g-transp", TRANSPORTE, 600, 900)]);
    const out = spendingGoalSituations(ctx(asOf), sg, readGoals(sg));
    const pressure = out.find((s) => s.type === "spending_goal_pressure")!;
    expect(pressure.title).toBe("Transporte está acima do ritmo da meta");
    expect(pressure.body).toContain("O gasto de R$ 45,00 em Uber + 99 entrou na submeta de Uber + 99 e também na meta de Transporte.");
    expect(pressure.body).toContain("O principal responsável é Uber + 99");
    expect(pressure.body).toContain("acima do limite da submeta");
    expect(pressure.body).toMatch(/Para cumprir a meta, (o disponível é|restam)/);
    expect(pressure.route).toBe("/app/metas/categoria/g-transp");
  });

  it("cobrança em submeta zerada é crítica e sugere cancelar", () => {
    const asOf = "2026-09-13";
    const rows = [tx("2026-09-12", 120, "LOVABLELOVABLE.DEVUS", ASSINATURAS)];
    const zero: MerchantTargetRow = { id: "lov", goal_id: "g-ass", label: "Lovable", merchant_keys: ["lovable"], limit_kind: "zero", computed_limit: 0, status: "active" };
    const sg = sgContext(asOf, rows, [zero], [goal("g-ass", ASSINATURAS, 200)]);
    const out = spendingGoalSituations(ctx(asOf), sg, readGoals(sg));
    const alert = out.find((s) => s.type === "spending_goal_zero_charge")!;
    expect(alert.severity).toBe("critical");
    expect(alert.title).toBe("Nova cobrança em Lovable");
    expect(alert.body).toContain("assinatura ainda ativa");
  });

  it("75% usados com 40% do mês pela frente mostra o valor por dia", () => {
    const asOf = "2026-09-18";
    const rows = [tx("2026-09-03", 400, "Bar do Zé", LAZER), tx("2026-09-10", 380, "Bar do Zé", LAZER)];
    const sg = sgContext(asOf, rows, [], [goal("g-lazer", LAZER, 1000)]);
    const readings = readGoals(sg).map((r) => ({ ...r, status: "on_track", projected_overage: 0, current_overage: 0 }));
    const out = spendingGoalSituations(ctx(asOf), sg, readings);
    const threshold = out.find((s) => s.type === "spending_goal_threshold")!;
    expect(threshold.body).toContain("Você já utilizou 78% da meta de Lazer");
    expect(threshold.body).toContain("40% dos dias");
    expect(threshold.body).toContain("por dia");
  });

  it("segunda-feira traz o resumo da semana; dia 1 traz o fechamento com a economia", () => {
    const rows = [
      tx("2026-08-05", 100, "Uber"), tx("2026-08-20", 90, "99"), tx("2026-08-12", 150, "Autopass"),
      tx("2026-09-01", 60, "Uber"), tx("2026-09-03", 40, "99"),
    ];
    const monday = "2026-09-07";
    const sgMon = sgContext(monday, rows, [appsTarget], [goal("g-transp", TRANSPORTE, 600, 900)]);
    const weekly = spendingGoalSituations(ctx(monday), sgMon, readGoals(sgMon)).find((s) => s.type === "spending_goal_weekly")!;
    expect(weekly.body).toContain("Transporte:");
    expect(weekly.body).toContain("Para a semana: até");
    expect(meetsSituationMateriality(weekly, ctx(monday))).toBe(true);

    const first = "2026-09-01";
    const sgFirst = sgContext(first, rows, [appsTarget], [goal("g-transp", TRANSPORTE, 600, 900)]);
    const monthly = spendingGoalSituations(ctx(first), sgFirst, readGoals(sgFirst)).find((s) => s.type === "spending_goal_monthly")!;
    expect(monthly.title).toBe("Fechamento de agosto: 1 de 1 meta cumprida");
    expect(monthly.body).toContain("A meta de Transporte em agosto foi cumprida");
    expect(monthly.body).toContain("reserva, um investimento ou para reduzir uma dívida");
  });
});
