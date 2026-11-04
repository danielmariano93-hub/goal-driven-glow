import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";
import { GoalVerdictCard } from "@/components/metas/GoalVerdictViews";
import { DonationCurrentMonth } from "@/components/metas/DonationGoalMonths";
import { GoalScoreboard } from "@/components/metas/GoalHistoryViews";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { buildGoalHistory } from "@/lib/engine/goalHistory";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";

const sharedState: { goals: unknown[] | undefined; loading: boolean } = { goals: [], loading: false };
vi.mock("@/lib/db/sharedGoals", () => ({
  useSharedGoals: () => ({ data: sharedState.goals, isLoading: sharedState.loading }),
  useCreateSharedGoal: () => ({}), useAcceptSharedGoalInvite: () => ({}), useDeclineSharedGoalInvite: () => ({}), usePendingSharedGoalInvites: () => ({ data: [] }),
}));
import { SharedGoalsInline } from "@/pages/Metas";

// Visual de estado da tela do Ticket (etiqueta tingida com ponto, chips de valor, caixa de leitura, trio de indicadores).
const goal = {
  id: "g1", user_id: "u1", category_id: "c1", mode: "fixed_limit", reduction_pct: null, fixed_limit: 1044.67, baseline_kind: "custom",
  baseline_value: 1492.39, computed_limit: 1044.67, frequency: "monthly", start_date: "2026-11-01", end_date: "2026-11-30",
  status: "active", period_type: "this_month",
} as never as CategorySpendingGoalRow;
let n = 0;
const tx = (m: string, amount: number, d = "05"): SpendingLedgerTx => ({
  id: `v${++n}`, account_id: "a", category_id: "c1", type: "expense", status: "confirmed", amount, occurred_at: `${m}-${d}`,
  description: "x", merchant_name: "x", transfer_group_id: null, movement_kind: "transaction", payment_method: "account",
} as never);
const monthly = (m: string, total: number) => [tx(m, total / 2, "05"), tx(m, total / 2, "20")];

describe("meta do mês: etiqueta e chips no padrão do Ticket", () => {
  const ev = evaluateCategoryGoal(goal, [...monthly("2026-08", 1414), ...monthly("2026-09", 2028), ...monthly("2026-10", 1445), tx("2026-11", 368, "01")] as never, new Date("2026-11-03T12:00:00"), "Lazer");
  it("estado vira etiqueta tingida com ponto (não texto solto)", () => {
    const apertado = evaluateCategoryGoal({ ...goal, computed_limit: 600, fixed_limit: 600 } as CategorySpendingGoalRow, [...monthly("2026-08", 1414), ...monthly("2026-09", 2028), ...monthly("2026-10", 1445), tx("2026-11", 368, "01")] as never, new Date("2026-11-03T12:00:00"), "Lazer");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={apertado} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    const pill = screen.getByText("Em risco");
    expect(pill.className).toMatch(/rounded-full/);
    expect(pill.className).toMatch(/bg-destructive\/15/);
    expect(pill.querySelector("span[aria-hidden]")).not.toBeNull();
  });
  it("o teto dentro da faixa de fechamento é 'Atenção' (amarelo), não alarme", () => {
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    expect(screen.getByText("Atenção").className).toMatch(/bg-warning\/20/);
  });
  it("projeção e diferença em chips: neutro para a projeção, vermelho para 'acima'", () => {
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    const chips = screen.getByTestId("goal-projection-chips");
    expect(chips.textContent).toMatch(/Projeção R\$\s?[\d.]+,\d{2}/);
    const acima = screen.getByText(/acima$/);
    expect(acima.className).toMatch(/bg-destructive\/15/);
  });
  it("dentro do teto: chip verde de folga", () => {
    const folga = evaluateCategoryGoal({ ...goal, computed_limit: 9000, fixed_limit: 9000 } as CategorySpendingGoalRow, [...monthly("2026-10", 500), tx("2026-11", 50, "01")] as never, new Date("2026-11-03T12:00:00"), "Lazer");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={folga} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    expect(screen.getByText(/de folga$/).className).toMatch(/bg-success\/15/);
    expect(screen.getByText("No ritmo").className).toMatch(/bg-success\/15/);
  });
});

describe("veredito: etiqueta, trio de indicadores e caixa de leitura", () => {
  const T = "c-t", V = "c-v";
  const history = (t: Record<string, number>, v: Record<string, number>) => buildGoalHistory({
    today: "2026-11-03",
    goals: [{ id: "g", category_id: T, computed_limit: 1800, baseline_value: 2000, status: "active", period_type: "monthly_recurring", start_date: "2026-09-01", end_date: null, created_at: "2026-09-01T10:00:00+00:00" }],
    entries: buildSpendingLedger(Object.entries({ ...Object.fromEntries(Object.entries(t).map(([m, a]) => [`${T}|${m}`, a])), ...Object.fromEntries(Object.entries(v).map(([m, a]) => [`${V}|${m}`, a])) }).flatMap(([k, a]) => {
      const [cat, m] = k.split("|");
      return [{ ...tx(m!, a / 2, "05"), category_id: cat }, { ...tx(m!, a / 2, "20"), category_id: cat }] as never[];
    })),
    categories: [{ id: T, name: "Transporte" }, { id: V, name: "Serviços" }],
  });
  const ok = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 }, { "2026-06": 500, "2026-07": 500, "2026-08": 500, "2026-09": 900, "2026-10": 900 });
  it("a resposta cabe numa etiqueta ao lado da pergunta", () => {
    render(<GoalVerdictCard verdict={ok.verdict!} />);
    expect(screen.getByText("Funcionando").className).toMatch(/bg-success\/15/);
  });
  it("trio Com meta / Sem meta / Confiança no formato dos indicadores do Ticket", () => {
    render(<GoalVerdictCard verdict={ok.verdict!} />);
    const box = screen.getByTestId("goal-vs-outside");
    expect(box.querySelectorAll(".bg-muted\\/50").length).toBeGreaterThanOrEqual(4); // 3 indicadores + caixa de leitura
    expect(box.textContent).toMatch(/Com meta.*−\d+%.*Sem meta.*\+\d+%.*Confiança/);
    expect(screen.getByText("Com meta").nextElementSibling!.className).toMatch(/text-success/);
  });
  it("cedo: etiqueta neutra e nenhum indicador inventado", () => {
    render(<GoalVerdictCard verdict={{ ...ok.verdict!, verdict: "cedo", net_monthly: null, net_pct: null, total_avoided: null, outside_line: null, comparison: null, summary: "Preciso de pelo menos 2 meses fechados." }} />);
    expect(screen.getByText("Cedo demais").className).toMatch(/bg-muted/);
    expect(screen.queryByTestId("goal-vs-outside")).toBeNull();
  });
  it("placar: variação 'vs antes' em chip colorido pelo efeito", () => {
    render(<GoalScoreboard history={ok} effects={Object.fromEntries(ok.verdict!.by_category.map((c) => [c.category_id, { change_pct: c.change_pct, status: c.status }]))} />);
    const chip = screen.getByText(/^−\d+%$/);
    expect(chip.className).toMatch(/bg-success\/15/);
  });
});

describe("dízimo: 'sem valor definido' não é verde", () => {
  it("etiqueta neutra com o mês ao lado", () => {
    render(<DonationCurrentMonth goal={{ id: "d", kind: "donation", donation_mode: "income_percent", donation_percent: 10, donation_start_date: "2026-06-01", donation_end_date: "2026-12-28", donation_due_day: 25, monthly_target: 0 } as never} txs={[]} />);
    const pill = screen.getByText("Sem valor definido");
    expect(pill.className).toMatch(/bg-muted/);
    expect(pill.className).not.toMatch(/bg-success/);
  });
});

describe("metas conjuntas: sem meta, sem espaço", () => {
  const wrap = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);
  it("aba 'Todas' sem meta conjunta: nada na tela", () => {
    sharedState.goals = []; sharedState.loading = false;
    const { container } = wrap(<SharedGoalsInline section />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(/Nenhuma meta conjunta ainda/)).toBeNull();
  });
  it("enquanto carrega, também nada (sem pulo de layout)", () => {
    sharedState.goals = undefined; sharedState.loading = true;
    const { container } = wrap(<SharedGoalsInline section />);
    expect(container.innerHTML).toBe("");
  });
  it("com meta conjunta, aparece o título e a lista", () => {
    sharedState.goals = [{ id: "s1", title: "Viagem", target_amount: 5000, deadline: null }]; sharedState.loading = false;
    wrap(<SharedGoalsInline section />);
    expect(screen.getByTestId("shared-goals-section")).toBeTruthy();
    expect(screen.getByText("Viagem")).toBeTruthy();
  });
  it("aba 'Conjuntas': o estado vazio continua (a pessoa foi procurar por ele)", () => {
    sharedState.goals = []; sharedState.loading = false;
    wrap(<SharedGoalsInline />);
    expect(screen.getByText("Nenhuma meta conjunta ainda")).toBeTruthy();
  });
});
