import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";
import { collectFinancialSignals } from "../../supabase/functions/_shared/proactive/signals";
import { repeatedKind } from "../../supabase/functions/_shared/proactive/repetition";
import { buildWeekdayProjection, detectWeekdayPattern, weekdayNudgeSituation } from "../../supabase/functions/_shared/proactive/weekdayNudge";
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

  it("projeta o mês, compara com a meta e só avisa de manhã", () => {
    // 23/09 é quarta; meta de R$ 600 e o ritmo leva o mês a ~R$ 660.
    const projection = buildWeekdayProjection(txs, "2026-09-23", { Alimentação: { name: "Alimentação", limit: 600 } })!;
    expect(projection.anchor.kind).toBe("goal");
    expect(projection.month_to_date).toBeGreaterThan(0);
    expect(projection.projected_month).toBeGreaterThan(projection.anchor.amount);
    expect(projection.projected_without_today).toBeCloseTo(projection.projected_month - projection.pattern.typical_on_weekday, 2);
    const morning = weekdayNudgeSituation(projection, ctx, new Date("2026-09-23T11:00:00Z"));
    expect(morning?.communication_kind).toBe("weekday_spending_risk");
    expect(morning?.title).toMatch(/Hoje é quarta/);
    expect(morning?.body).toMatch(/Em \d+ das últimas 12 quartas você gastou com Alimentação, uns R\$\s?80,00 por vez/);
    expect(morning?.body).toMatch(/Nesse ritmo, fecha em/);
    expect(morning?.body).toMatch(/a meta é R\$\s?600,00/);
    expect(weekdayNudgeSituation(projection, ctx, new Date("2026-09-23T20:00:00Z"))).toBeNull();
  });

  it("sem meta usa a média dos meses fechados e fica em silêncio quando o mês está em linha", () => {
    const wed = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === 3;
    // 10/10 é sábado; padrão de sábado inexistente → usa quarta em 14/10.
    const rows: Array<{ occurred_at: string; amount: number; category: string }> = [];
    for (let i = 1; i <= 120; i += 1) {
      const iso = new Date(Date.UTC(2026, 9, 14 - i)).toISOString().slice(0, 10);
      rows.push({ occurred_at: iso, amount: wed(iso) ? 80 : 20, category: "Alimentação" });
    }
    const normal = buildWeekdayProjection(rows, "2026-10-14");
    // Mês em linha com a média dos anteriores: não há o que decidir.
    expect(normal).toBeNull();
    const heavy = rows.map((r) => (r.occurred_at.startsWith("2026-10") ? { ...r, amount: r.amount * 3 } : r));
    const over = buildWeekdayProjection(heavy, "2026-10-14")!;
    expect(over.anchor.kind).toBe("average");
    expect(over.overage).toBeGreaterThan(30);
  });

  it("não aponta categoria de data fixa (Assinaturas) nem padrão de poucas semanas", () => {
    const subs = txs.map((x) => ({ ...x, category: "Assinaturas" }));
    expect(detectWeekdayPattern(subs, "2026-09-30")).toBeNull();
    // só 4 quartas com gasto alto: coincidência, não hábito
    const sparse = txs.filter((x) => new Date(x.occurred_at).getUTCDay() !== 3).concat(
      txs.filter((x) => new Date(x.occurred_at).getUTCDay() === 3).slice(0, 4),
    );
    expect(detectWeekdayPattern(sparse, "2026-09-30")).toBeNull();
  });

  it("não inventa padrão quando o dia não se destaca", () => {
    const flat = txs.map((t) => ({ ...t, amount: 20 }));
    expect(detectWeekdayPattern(flat, "2026-09-30")).toBeNull();
  });
});
