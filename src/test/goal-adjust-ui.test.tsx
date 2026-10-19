import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GoalAdjustSheet } from "@/components/metas/GoalAdjustSheet";
import { AdjustedBadge, GoalAdjustmentsPanel } from "@/components/metas/GoalAdjustmentViews";
import { reviewGoalAdjustment } from "@/lib/engine/goalAdjustment";
import { readFileSync } from "node:fs";

const evaluation = {
  goal: { id: "g1", category_id: "c1", mode: "fixed_limit", computed_limit: 1000, reduction_pct: null, fixed_limit: 1000, baseline_kind: "avg_3m", baseline_value: 1200, frequency: "monthly", period_type: "monthly_recurring", start_date: "2026-10-01", end_date: "2026-10-31", status: "active" },
  categoryName: "Lazer", actualSpend: 400, projectedFinalSpend: 1300,
} as never;

describe("Ajustar meta", () => {
  it("só salva depois de mudar algo e envia limite, período original e motivo", () => {
    const onSubmit = vi.fn();
    render(<GoalAdjustSheet evaluation={evaluation} txs={[]} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Salvar ajuste"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Nada mudou/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("1000"), { target: { value: "1400" } });
    fireEvent.click(screen.getByText("Mudou minha renda"));
    expect(screen.getByTestId("adjust-preview").textContent).toMatch(/dentro dele/);
    fireEvent.click(screen.getByText("Salvar ajuste"));
    const [input, reason] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({ id: "g1", mode: "fixed_limit", computed_limit: 1400, period_type: "monthly_recurring", start_date: "2026-10-01" });
    expect(reason).toBe("Mudou minha renda");
  });
  it("avisa quando o novo limite ainda fica abaixo do ritmo", () => {
    render(<GoalAdjustSheet evaluation={evaluation} txs={[]} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("1000"), { target: { value: "1100" } });
    expect(screen.getByTestId("adjust-preview").textContent).toMatch(/ainda passa/);
  });
});

describe("Selo e painel de ajustes", () => {
  const review = reviewGoalAdjustment({
    adjustment: { id: "a1", goal_id: "g1", category_id: "c1", adjusted_on: "2026-10-10", period_start: "2026-10-01", period_end: "2026-10-31", old_limit: 1000, new_limit: 1500, reason: "Estava irreal" },
    entries: [{ id: "x", date: "2026-10-05", month: "2026-10", category_id: "c1", merchant_key: "k", merchant_label: "k", amount: 1300 }],
    today: "2026-11-02", categoryName: "Lazer",
  });
  it("selo mostra a data, o antes/depois e o veredito", () => {
    render(<AdjustedBadge review={review} />);
    const t = screen.getByTestId("goal-adjusted-badge").textContent ?? "";
    expect(t).toMatch(/Ajustada em 10\/10/);
    expect(t).toMatch(/Foi necessário/);
  });
  it("painel traz a leitura e o motivo", () => {
    render(<GoalAdjustmentsPanel reviews={[review]} />);
    expect(screen.getByText("O ajuste foi necessário")).toBeTruthy();
    expect(screen.getByText(/Estava irreal/)).toBeTruthy();
  });
});

describe("contrato do banco e do servidor", () => {
  const mig = readFileSync("supabase/migrations/20261020120000_spending_goal_adjustments.sql", "utf8");
  it("o registro nasce do gatilho e a pessoa só escreve o motivo", () => {
    expect(mig).toMatch(/after update on public\.category_spending_goals/);
    expect(mig).toMatch(/grant update \(reason\)/);
    expect(mig).not.toMatch(/grant insert/);
  });
  it("a ação goals e a ferramenta do Nino devolvem os ajustes avaliados", () => {
    expect(readFileSync("supabase/functions/nino-insights/index.ts", "utf8")).toMatch(/adjustments: adjustmentReviewsOf\(ctx\)/);
    expect(readFileSync("supabase/functions/_shared/agent/tools.ts", "utf8")).toMatch(/adjustmentReviewsOf\(sg\)/);
  });
});
