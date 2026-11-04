import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CategoryGoalCard, displayLabel } from "@/components/metas/CategoryGoalCard";
import { GoalVerdictCard } from "@/components/metas/GoalVerdictViews";
import { DonationCurrentMonth } from "@/components/metas/DonationGoalMonths";
import { GoalScoreboard } from "@/components/metas/GoalHistoryViews";
import { evaluateCategoryGoal, projectedCrossingDate, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
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
  it("linha única: data prevista à esquerda, quanto passa à direita; sem texto vermelho nem caixa", () => {
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    const line = screen.getByTestId("goal-outlook");
    expect(line.children[0]!.textContent).toMatch(/^Passa do teto por volta de \d{2}\/\d{2}$/);
    expect(line.children[1]!.textContent).toMatch(/^\+R\$\s?[\d.]+,\d{2}$/);
    expect(line.querySelector("[class*='text-destructive']")).toBeNull();
    expect(line.className).not.toMatch(/bg-/);
  });
  it("barra na cor da marca com trilha visível, em qualquer estado", () => {
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    const fill = screen.getByTestId("goal-bar-fill");
    expect(fill.className).toMatch(/bg-primary/);
    expect(fill.parentElement!.className).toMatch(/bg-primary\/15/);
  });
  it("cada meta é um cartão próprio e tem um único selo (o estado)", () => {
    const { container } = render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    expect(container.querySelector("li")!.className).toMatch(/surface-card/);
    expect(container.querySelectorAll("span.px-2\\.5.rounded-full").length).toBe(1);
  });
  it("período, regra e projeção saem da frente e ficam nos detalhes", () => {
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={ev} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    expect(screen.queryByTestId("goal-details-rule")).toBeNull();
    expect(screen.queryByText(/Projeção R\$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes e ações/ }));
    expect(screen.getByTestId("goal-details-rule").textContent).toMatch(/1–30 nov · .* · dia \d+ de 30/);
    expect(screen.getByText(/Projeção R\$\s?[\d.]+,\d{2} · R\$\s?[\d.]+,\d{2} acima do teto/)).toBeTruthy();
  });
  it("dentro do teto: 'Deve fechar dentro do teto' com a folga", () => {
    const folga = evaluateCategoryGoal({ ...goal, computed_limit: 9000, fixed_limit: 9000 } as CategorySpendingGoalRow, [...monthly("2026-10", 500), tx("2026-11", 50, "01")] as never, new Date("2026-11-03T12:00:00"), "Lazer");
    render(<MemoryRouter><ul><CategoryGoalCard evaluation={folga} compact onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} /></ul></MemoryRouter>);
    expect(screen.getByTestId("goal-outlook").textContent).toMatch(/Deve fechar dentro do teto.*folga R\$/);
    expect(screen.getByText("No ritmo").className).toMatch(/bg-success\/15/);
  });
});

describe("data prevista de cruzar o teto (goal_cross_date.v1)", () => {
  const base = { limit: 1000, referenceIso: "2026-11-04", periodEnd: "2026-11-30" };
  it("espalha o que falta até a projeção pelos dias restantes", () => {
    // faltam 26 dias; vai de 100 a 1300: 46,15/dia; chega a 1000 em ~19,5 dias => 24/11
    expect(projectedCrossingDate({ ...base, actualSpend: 100, projectedFinalSpend: 1300, remainingDays: 26 })).toBe("2026-11-24");
  });
  it("sem data quando não passa, quando já passou ou quando o período acabou", () => {
    expect(projectedCrossingDate({ ...base, actualSpend: 100, projectedFinalSpend: 900, remainingDays: 26 })).toBeNull();
    expect(projectedCrossingDate({ ...base, actualSpend: 1200, projectedFinalSpend: 1500, remainingDays: 26 })).toBeNull();
    expect(projectedCrossingDate({ ...base, actualSpend: 100, projectedFinalSpend: 1300, remainingDays: 0 })).toBeNull();
  });
  it("nunca passa do fim do período", () => {
    expect(projectedCrossingDate({ ...base, actualSpend: 900, projectedFinalSpend: 1001, remainingDays: 26 })).toBe("2026-11-30");
  });
  it("passar até 5% é 'No limite' (neutro); acima disso continua Atenção", () => {
    const mk = (over: number) => ({ status: "attention", targetAmount: 1000, projectedOverage: over } as never);
    expect(displayLabel(mk(40), { label: "Atenção", tone: "warning" })).toEqual({ text: "No limite", tone: "muted" });
    expect(displayLabel(mk(120), { label: "Atenção", tone: "warning" })).toEqual({ text: "Atenção", tone: "warning" });
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
