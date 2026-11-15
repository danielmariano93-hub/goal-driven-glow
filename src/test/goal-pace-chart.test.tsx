// "Como a meta fecha": a série diária usa as mesmas regras do gasto da meta, e os números do gráfico batem com os do card.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { type TransactionRow } from "@/lib/engine/facts";
import { categoryGoalDailySpend, goalPaceApplies, goalPaceIsStepped, goalPaceModel } from "@/lib/engine/goalPaceChart";
import { GoalPaceChart } from "@/components/metas/GoalPaceChart";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";

const CAT = "cat-transporte";
const today = new Date("2026-11-15T12:00:00");
const goal = {
  id: "g1", user_id: "u1", category_id: CAT, mode: "fixed_limit", reduction_pct: null, fixed_limit: 958.61, baseline_kind: "custom",
  baseline_value: 1597.68, computed_limit: 958.61, frequency: "monthly", start_date: "2026-11-01", end_date: "2026-11-30",
  status: "active", period_type: "this_month",
} as CategorySpendingGoalRow;

const tx = (over: Partial<TransactionRow> & { id: string; amount: number; occurred_at: string }): TransactionRow => ({
  account_id: "a1", category_id: CAT, type: "expense", status: "confirmed", description: "Uber", transfer_group_id: null,
  payment_method: "pix", credit_card_id: null, movement_kind: "transaction", ...over,
}) as TransactionRow;

// Um gasto quase todo dia útil: consumo contínuo, R$/dia faz sentido.
const daily = (): TransactionRow[] => Array.from({ length: 15 }, (_, i) => tx({ id: `t${i}`, amount: 19.09, occurred_at: `2026-11-${String(i + 1).padStart(2, "0")}` }));

describe("série diária da meta", () => {
  it("a soma bate com o gasto oficial da meta", () => {
    const txs = [...daily(), tx({ id: "outra", amount: 500, occurred_at: "2026-11-05", category_id: "outra-cat" }), tx({ id: "fora", amount: 80, occurred_at: "2026-10-30" })];
    const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
    const s = categoryGoalDailySpend(goal, txs, today);
    expect(s.total).toBe(ev.actualSpend);
    expect(s.days).toHaveLength(30);
    expect(s.days[0]).toMatchObject({ day: 1, date: "2026-11-01", amount: 19.09 });
    expect(s.days[14].date).toBe("2026-11-15");
  });
  it("estorno abate no dia em que cai; parcela antiga e transferência ficam de fora, como no card", () => {
    const txs = [
      ...daily(),
      tx({ id: "est", amount: 10, occurred_at: "2026-11-10", type: "income", movement_kind: "refund", refund_of_transaction_id: "t3" } as never),
      tx({ id: "tr", amount: 300, occurred_at: "2026-11-08", type: "transfer", transfer_group_id: "x" }),
    ];
    const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
    expect(categoryGoalDailySpend(goal, txs, today).total).toBe(ev.actualSpend);
  });
});

describe("modelo do gráfico", () => {
  const txs = daily();
  const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
  const m = goalPaceModel(ev, txs, today)!;

  it("o último ponto da linha é o gasto do card e a ponta da projeção é a projeção do card", () => {
    expect(m).not.toBeNull();
    expect(m.cumulative[0]).toEqual({ day: 0, value: 0 });
    expect(m.cumulative.at(-1)).toEqual({ day: 15, value: ev.actualSpend });
    expect(m.projected).toBe(ev.projectedFinalSpend);
    expect(m.target).toBe(958.61);
    expect(m.idealAt(m.totalDays)).toBe(958.61);
    expect(m.idealAt(0)).toBe(0);
  });
  it("o acumulado nunca diminui e termina no gasto oficial", () => {
    for (let i = 1; i < m.cumulative.length; i++) expect(m.cumulative[i].value).toBeGreaterThanOrEqual(m.cumulative[i - 1].value);
  });
  it("cenários: o do ritmo fecha na projeção do card e o do limite fecha exatamente no teto", () => {
    const pace = m.scenarios.find((s) => s.kind === "pace")!;
    const limit = m.scenarios.find((s) => s.kind === "limit")!;
    expect(pace.final).toBe(ev.projectedFinalSpend);
    expect(pace.diff).toBe(m.tiles.slack);
    expect(limit.rate).toBe(ev.dailyAllowance);
    expect(limit.final).toBe(ev.targetAmount);
    expect(limit.diff).toBe(0);
    const rates = m.scenarios.map((s) => s.rate);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
    expect(m.scenarios[m.defaultScenario].kind).toBe("pace");
  });
  it("folga = teto − projeção", () => {
    expect(m.tiles.slack).toBe(Math.round((ev.targetAmount - Math.max(ev.actualSpend, ev.projectedFinalSpend)) * 100) / 100);
    expect(m.tiles.allowance).toBe(ev.dailyAllowance);
  });
  it("não aplica a meta pausada, agendada ou concluída; nem a categoria sem R$/dia", () => {
    expect(goalPaceApplies({ ...ev, status: "paused" })).toBe(false);
    expect(goalPaceApplies({ ...ev, status: "scheduled" })).toBe(false);
    expect(goalPaceApplies({ ...ev, status: "completed_ok" })).toBe(false);
    expect(goalPaceApplies({ ...ev, supportsDailyBudget: false })).toBe(false);
    expect(goalPaceIsStepped({ ...ev, supportsDailyBudget: false })).toBe(true);
    expect(goalPaceIsStepped({ ...ev, status: "paused", supportsDailyBudget: false })).toBe(false);
    expect(goalPaceModel({ ...ev, supportsDailyBudget: false }, txs, today)).toBeNull();
  });
  it("já acima do teto: sem 'e se' (não há folga para simular), mas o gráfico continua", () => {
    const over = { ...ev, actualSpend: 1000, dailyAllowance: 0, status: "exceeded" as const, projectedFinalSpend: 1100 };
    const mo = goalPaceModel(over, txs, today)!;
    expect(mo).not.toBeNull();
    expect(mo.scenarios).toEqual([]);
    expect(mo.tiles.slack).toBeLessThan(0);
  });
});

describe("tela do gráfico", () => {
  const txs = daily();
  const ev = evaluateCategoryGoal(goal, txs, today, "Transporte");
  it("mostra título, gráfico, os três números e o 'e se eu gastar por dia…'", () => {
    render(<GoalPaceChart evaluation={ev} txs={txs} today={today} />);
    const sec = screen.getByRole("region", { name: "Como a meta fecha" });
    expect(within(sec).getByText("Como a meta fecha")).toBeTruthy();
    expect(within(sec).getByRole("img", { name: /Gasto acumulado da meta/ })).toBeTruthy();
    for (const label of ["Ritmo", "Limite"]) expect(within(sec).getByText(label)).toBeTruthy();
    expect(within(sec).getByText("E se eu gastar por dia…")).toBeTruthy();
  });
  it("tocar noutro valor troca a frase do resultado", () => {
    render(<GoalPaceChart evaluation={ev} txs={txs} today={today} />);
    const result = screen.getByTestId("goal-pace-result");
    const before = result.textContent;
    const buttons = screen.getAllByRole("button");
    const pressed = buttons.find((b) => b.getAttribute("aria-pressed") === "true")!;
    const other = buttons.find((b) => b.getAttribute("aria-pressed") === "false")!;
    expect(pressed).toBeTruthy();
    fireEvent.click(other);
    expect(other.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("goal-pace-result").textContent).not.toBe(before);
  });
  it("categoria em degraus: só a explicação, sem gráfico", () => {
    render(<GoalPaceChart evaluation={{ ...ev, supportsDailyBudget: false }} txs={txs} today={today} />);
    expect(screen.getByText(/o gasto cai em datas fixas/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("meta pausada: não mostra nada", () => {
    const { container } = render(<GoalPaceChart evaluation={{ ...ev, status: "paused" }} txs={txs} today={today} />);
    expect(container.textContent).toBe("");
  });
});

describe("dentro do card da meta", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T12:00:00")); });
  afterEach(() => vi.useRealTimers());
  const txs = daily();
  const h = { onEdit: () => {}, onDelete: () => {}, onToggleStatus: () => {} };
  it("o card compacto só mostra o gráfico depois de abrir", () => {
    const ev = evaluateCategoryGoal(goal, txs, new Date(), "Transporte");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact txs={txs} {...h} /></ul></MemoryRouter>);
    expect(screen.queryByText("Como a meta fecha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes e ações/ }));
    expect(screen.getByText("Como a meta fecha")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Gasto acumulado da meta/ })).toBeTruthy();
  });
  it("sem lançamentos (txs) o card continua igual", () => {
    const ev = evaluateCategoryGoal(goal, txs, new Date(), "Transporte");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact {...h} /></ul></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Detalhes e ações/ }));
    expect(screen.queryByText("Como a meta fecha")).toBeNull();
  });
  it("o número do gráfico é o mesmo do texto do card", () => {
    const ev = evaluateCategoryGoal(goal, txs, new Date(), "Transporte");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact txs={txs} {...h} /></ul></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Detalhes e ações/ }));
    const proj = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(ev.projectedFinalSpend).replace(/\s/g, " ");
    const texts = Array.from(document.querySelectorAll("svg text")).map((n) => (n.textContent ?? "").replace(/\s/g, " "));
    expect(texts.some((t) => t.includes(proj))).toBe(true);
  });
});
