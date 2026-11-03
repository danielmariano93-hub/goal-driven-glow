import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildGoalHistory } from "@/lib/engine/goalHistory";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";
import { GoalCandidatesCard, GoalVerdictCard } from "@/components/metas/GoalVerdictViews";

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
  it("sim: mostra a resposta, o evitado líquido e o efeito por categoria com rótulo (não só cor)", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 }, { "2026-06": 700, "2026-07": 700, "2026-08": 700, "2026-09": 700, "2026-10": 700 });
    render(<GoalVerdictCard verdict={h.verdict!} />);
    expect(screen.getByText("SIM")).toBeTruthy();
    expect(screen.getByText("Sim: ter metas está fazendo sentido.")).toBeTruthy();
    expect(screen.getByText("Ajudou")).toBeTruthy();
    expect(screen.getByText(/Evitado por mês/)).toBeTruthy();
    expect(screen.getByText(/Como o Nino mede isso/)).toBeTruthy();
  });
  it("não: diz 'por enquanto, não' e que gasta a mais", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 2600, "2026-10": 2600 }, { "2026-06": 700, "2026-07": 700, "2026-08": 700, "2026-09": 700, "2026-10": 700 });
    render(<GoalVerdictCard verdict={h.verdict!} />);
    expect(screen.getByText("AINDA NÃO")).toBeTruthy();
    expect(screen.getByText("Por enquanto, não.")).toBeTruthy();
    expect(screen.getByText("Não ajudou")).toBeTruthy();
    expect(screen.getByText(/A mais por mês/)).toBeTruthy();
  });
  it("cedo: não inventa número", () => {
    const h = history({ "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-10": 1500 }, { "2026-06": 700 });
    render(<GoalVerdictCard verdict={{ ...h.verdict!, verdict: "cedo", net_monthly: null, total_avoided: null, headline: "Ainda é cedo para dizer.", summary: "Preciso de pelo menos 2 meses fechados." }} />);
    expect(screen.getByText("CEDO DEMAIS")).toBeTruthy();
    expect(screen.queryByText(/Evitado por mês/)).toBeNull();
  });
});

describe("categorias que merecem uma meta", () => {
  it("lista o porquê e cria a meta com o teto sugerido", () => {
    const onCreate = vi.fn();
    render(<GoalCandidatesCard onCreate={onCreate} candidates={[{
      category_id: "c-v", category_name: "Serviços", avg_month: 800, share_variable: 0.11, trend_pct: 0.98, behavior: "concentrado",
      charges_per_month: 2, top_merchant: null, priority: "alta", recommended_limit: 950, potential_month: 0, reasons: ["Média de R$ 800,00 por mês, 11% do seu gasto variável.", "Subiu 98% nos últimos 3 meses."],
    }]} />);
    expect(screen.getByText("Serviços")).toBeTruthy();
    expect(screen.getByText("PRIORIDADE ALTA")).toBeTruthy();
    expect(screen.getByText(/Subiu 98%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Criar meta" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ category_id: "c-v", recommended_limit: 950 }));
  });
  it("sem candidatos não ocupa espaço", () => {
    const { container } = render(<GoalCandidatesCard candidates={[]} onCreate={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
