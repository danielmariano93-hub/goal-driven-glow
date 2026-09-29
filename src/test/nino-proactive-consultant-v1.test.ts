import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";
import { collectFinancialSignals } from "../../supabase/functions/_shared/proactive/signals";
import { repeatedKind } from "../../supabase/functions/_shared/proactive/repetition";
import { detectWeekdayPattern, weekdayNudgeSituation } from "../../supabase/functions/_shared/proactive/weekdayNudge";
import type { FinancialSituation, MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";

const debt = { id: "d1", name: "Celular", original_amount: 10500, outstanding_balance: 8000, installment_amount: 500, due_day: 28, status: "active", installments_total: 21, installments_paid: 5, start_date: null, first_due_date: null } as never;
const payments = [
  { id: "p1", debt_id: "d1", amount: 500, amount_applied: 500, installments_covered: 1, paid_at: "2026-08-28" },
  { id: "p2", debt_id: "d1", amount: 500, amount_applied: 500, installments_covered: 1, paid_at: "2026-09-29" },
] as never;
const agendaOn = (day: string) => computeCommitmentAgenda({
  txs: [], recurring: [], statements: [], installments: [], cards: [], debts: [debt], debtPayments: payments,
  horizonDays: 30, today: new Date(`${day}T12:00:00-03:00`),
} as never);

describe("compromissos: parcela recém-paga", () => {
  it("aparece como paga e a próxima fica pendente", () => {
    const items = agendaOn("2026-09-29").items.map((i) => [i.date, i.payment_status]);
    expect(items).toEqual([["2026-09-28", "paid"], ["2026-10-28", "pending"]]);
  });
  it("some da agenda depois de 7 dias", () => {
    expect(agendaOn("2026-10-07").items.map((i) => i.date)).toEqual(["2026-10-28"]);
  });
});

function ctxWith(obligations: unknown[]): MultiFinanceProactiveContext {
  return {
    version: "proactive_multifinance.v1", user_id: "u", as_of: "2026-09-27", monthly_income: 5000, materiality_floor: 100,
    available_today: 3000, projected_month_end_available: 500, daily_pace: 100, typical_daily_pace: 90,
    cash_horizon: [], first_negative_day: null, snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
    domains: { cash: {}, cards: {}, goals: [], commitments: [], debts: [], debt_obligations: obligations as never, debt_obligations_available: true, patterns: [] },
    learning: {},
  };
}
const obligation = (days: number, cycle: string, status = "pending") => ({
  debt_id: "d1", name: "Celular", creditor: null, installment_amount: 500, outstanding: 8000, situation: "em_dia",
  cycle_status: status, cycle_due_date: cycle, cycle_paid_at: null, next_due_date: cycle, days_until: days,
  days_overdue: days < 0 ? -days : null, overdue_amount: days < 0 ? 500 : 0, canonical_source: "debt_obligation_state", formula_version: "x",
});

describe("lembrete de dívida por ciclo", () => {
  const keyOf = (o: unknown) => collectFinancialSignals(ctxWith([o])).find((s) => s.key.startsWith("debt_due:"))?.key;
  it("cada ciclo e cada momento têm identidade própria", () => {
    const week = keyOf(obligation(5, "2026-09-28"));
    const eve = keyOf(obligation(1, "2026-09-28"));
    const nextMonth = keyOf(obligation(5, "2026-10-28"));
    expect(week).toBe("debt_due:d1:2026-09-28:week");
    expect(eve).toBe("debt_due:d1:2026-09-28:imminent");
    expect(nextMonth).not.toBe(week);
  });

  it("lembrete de obrigação com data não espera a janela de repetição do tipo", () => {
    const situation = { communication_kind: "debt_due_soon", severity: "attention", impact_amount: 500 } as FinancialSituation;
    const recent = [{ kind: "debt_due_soon", channel: "whatsapp", delivered_at: "2026-09-26T12:00:00Z", impact_amount: 500 }];
    expect(repeatedKind(situation, "whatsapp", recent, new Date("2026-09-27T12:00:00Z"))).toBeNull();
  });
});

describe("aviso matinal por dia da semana", () => {
  // 12 quartas com ~R$ 80 de Alimentação; outros dias ~R$ 20.
  const txs: Array<{ occurred_at: string; amount: number; category: string }> = [];
  for (let i = 1; i <= 84; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 30 - i));
    const iso = d.toISOString().slice(0, 10);
    txs.push({ occurred_at: iso, amount: d.getUTCDay() === 3 ? 80 : 20, category: "Alimentação" });
  }
  const ctx = { as_of: "2026-09-30", snapshot_ref: { reconciliation_id: "r", formula_version: "f" } };

  it("detecta o dia em que a categoria pesa, com a conta feita no código", () => {
    const pattern = detectWeekdayPattern(txs, "2026-09-30")!;
    expect(pattern.category).toBe("Alimentação");
    expect(pattern.typical_on_weekday).toBe(80);
    expect(pattern.ratio).toBe(4);
  });

  it("só gera o aviso de manhã e cita a meta quando existe", () => {
    const pattern = detectWeekdayPattern(txs, "2026-09-30");
    const morning = weekdayNudgeSituation(pattern, ctx, new Date("2026-09-30T11:00:00Z"), { name: "Viagem" });
    expect(morning?.communication_kind).toBe("weekday_spending_risk");
    expect(morning?.title).toMatch(/Hoje é quarta/);
    expect(morning?.body).toMatch(/Às quartas você costuma gastar cerca de R\$\s?80,00 com Alimentação/);
    expect(morning?.body).toMatch(/meta “Viagem”/);
    expect(weekdayNudgeSituation(pattern, ctx, new Date("2026-09-30T20:00:00Z"))).toBeNull();
  });

  it("não inventa padrão quando o dia não se destaca", () => {
    const flat = txs.map((t) => ({ ...t, amount: 20 }));
    expect(detectWeekdayPattern(flat, "2026-09-30")).toBeNull();
  });
});
