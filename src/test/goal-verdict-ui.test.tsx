import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildGoalHistory } from "@/lib/engine/goalHistory";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";
import { GoalCandidatesCard, GoalVerdictCard } from "@/components/metas/GoalVerdictViews";
import { GoalScoreboard } from "@/components/metas/GoalHistoryViews";

const T = "c-t", V = "c-v";
let n = 0;
const tx = (m: string, amount: number, cat: string, d: string): SpendingLedgerTx => ({
  id: `u${++n}`, account_id: "a", category_id: cat, type: "expense", status: "confirmed", amount, occurred_at: `${m}-${d}`,
  description: "x", merchant_name: "x", transfer_group_id: null, movement_kind: "transaction",
} as SpendingLedgerTx);
const monthly = (cat: string, v: Record<string, number>) => Object.entries(v).flatMap(([m, a]) => [tx(m, a / 2, cat, "05"), tx(m, a / 2, cat, "20")]);

const history = (tVals: Record<string, number>, vVals: Record<string, number>) => buildGoalHistory({
  today: "2026-11-03",
  goals: [{ id: "g", category_id: T, computed_limit: 1800, baseline_value: 2000, status: "active", period_type: "monthly_recurring", start_date: "2026-09-01", end_date: null }],
  entries: buildSpendingLedger([...monthly(T, tVals), ...monthly(V, vVals)]),
  categories: [{ id: T, name: "Transporte" }, { id: V, name: "Serviços" }],
});

describe("tela de metas: veredito literal", () => {
  it("funcionando: selo 'N DE M FUNCIONARAM', número grande, evitado e confiança", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 }, { "2026-06": 700, "2026-07": 700, "2026-08": 700, "2026-09": 700, "2026-10": 700 });
    render(<GoalVerdictCard verdict={h.verdict!} />);
    expect(screen.getByText(/1 de 1 funcionaram/)).toBeTruthy();
    expect(screen.getByText("Nas categorias com meta, você está gastando menos.")).toBeTruthy();
    expect(screen.getAllByText(/a menos por mês/).length).toBeGreaterThan(0);
    // período real da medição em meses de calendário (não a soma categoria × mês)
    expect(screen.getByText(/evitado .* desde set\/2026 \(2 meses\) · confiança/)).toBeTruthy();
    expect(screen.queryByText(/12 meses/)).toBeNull();
    expect(screen.getByText(/Como o Nino mede isso/)).toBeTruthy();
  });
  it("não funcionou: diz que não reduziu e que gasta a mais", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 2600, "2026-10": 2600 }, { "2026-06": 700, "2026-07": 700, "2026-08": 700, "2026-09": 700, "2026-10": 700 });
    render(<GoalVerdictCard verdict={h.verdict!} />);
    expect(screen.getByText(/0 de 1 funcionaram/)).toBeTruthy();
    expect(screen.getByText("Por enquanto, as metas não reduziram o gasto.")).toBeTruthy();
    expect(screen.getAllByText(/a mais por mês/).length).toBeGreaterThan(0);
  });
  it("fora das metas aparece como contexto neutro", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 }, { "2026-06": 500, "2026-07": 500, "2026-08": 500, "2026-09": 900, "2026-10": 900 });
    render(<GoalVerdictCard verdict={h.verdict!} />);
    expect(screen.getByText(/Fora das metas, o seu gasto subiu/)).toBeTruthy();
  });
  it("cedo: não inventa número", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-10": 1500 }, { "2026-06": 700 });
    render(<GoalVerdictCard verdict={{ ...h.verdict!, verdict: "cedo", badge: "Cedo demais", net_monthly: null, total_avoided: null, outside_line: null, headline: "Ainda é cedo para dizer.", summary: "Preciso de pelo menos 2 meses fechados." }} />);
    expect(screen.getByText(/Preciso de pelo menos 2 meses/)).toBeTruthy();
    expect(screen.queryByText(/desde set/)).toBeNull();
  });
});

describe("onde ainda não há meta", () => {
  const cand = {
    category_id: "c-v", category_name: "Serviços", avg_month: 800, share_variable: 0.11, trend_pct: 0.98, behavior: "concentrado" as const,
    charges_per_month: 2, top_merchant: null, priority: "alta" as const, recommended_limit: 950, potential_month: 0,
    reasons: ["Média de R$ 800,00 por mês, 11% do seu gasto variável.", "Subiu 98% nos últimos 3 meses."],
  };
  it("fechado por padrão, com uma linha de resumo; expande para criar a meta com o teto sugerido", () => {
    const onCreate = vi.fn();
    render(<GoalCandidatesCard onCreate={onCreate} candidates={[cand]} />);
    expect(screen.getByText("Onde ainda não há meta")).toBeTruthy();
    expect(screen.getByText(/1 categoria subindo: Serviços \+98%/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Criar meta" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Criar meta" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ category_id: "c-v", recommended_limit: 950 }));
  });
  it("sem candidatos não ocupa espaço", () => {
    const { container } = render(<GoalCandidatesCard candidates={[]} onCreate={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("placar: meses reconstruídos antes da criação da meta", () => {
  it("não aparece '?' (sem confirmação manual) e 'vs antes' vem da mesma conta do resultado", () => {
    const h = buildGoalHistory({
      today: "2026-11-03",
      goals: [{ id: "g", category_id: T, computed_limit: 1800, baseline_value: 2000, status: "active", period_type: "monthly_recurring", start_date: "2026-09-01", end_date: null, created_at: "2026-09-01T10:00:00+00:00" }],
      cycles: [{ id: "cycle:c1", cycle_id: "c1", category_id: T, computed_limit: 900, baseline_value: null, start_date: "2026-08-01", end_date: "2026-08-31", period_type: "custom", status: "active", imported: true, confirmed: null }] as never,
      entries: buildSpendingLedger([...monthly(T, { "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 })]),
      categories: [{ id: T, name: "Transporte" }],
    });
    const effects = Object.fromEntries(h.verdict!.by_category.map((c) => [c.category_id, { change_pct: c.change_pct, status: c.status }]));
    render(<GoalScoreboard history={h} effects={effects} />);
    expect(screen.getByText("vs antes")).toBeTruthy();
    expect(screen.getByText("−25%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /histórico importado/ })).toBeNull();
  });
});
