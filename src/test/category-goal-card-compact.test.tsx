import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";

const goal: CategorySpendingGoalRow = {
  id: "g1", user_id: "u1", category_id: "c1", mode: "fixed_limit", reduction_pct: null, fixed_limit: 958.61, baseline_kind: "custom",
  baseline_value: 1597.68, computed_limit: 958.61, frequency: "monthly", start_date: "2026-11-01", end_date: "2026-11-30",
  status: "active", period_type: "this_month",
} as never;
const evaluation = evaluateCategoryGoal(goal, [], new Date("2026-11-03T12:00:00"), "Transporte");

function renderCard(compact: boolean) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onToggleStatus: vi.fn(), onAdjust: vi.fn() };
  render(<MemoryRouter><ul><CategoryGoalCard evaluation={evaluation} compact={compact} {...handlers}><p>Plano do Nino</p></CategoryGoalCard></ul></MemoryRouter>);
  return handlers;
}

describe("lista de metas deste mês, compacta", () => {
  it("fechado: título, regra, barra e números numa linha; ações e plano ficam atrás de 'Detalhes e ações'", () => {
    renderCard(true);
    expect(screen.getByText("Transporte")).toBeTruthy();
    expect(screen.getByText(/de R\$\s958,61/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByText("Plano do Nino")).toBeNull();
  });
  it("aberto: mostra o plano e as quatro ações, e elas funcionam", () => {
    const h = renderCard(true);
    fireEvent.click(screen.getByRole("button", { name: /Detalhes e ações/ }));
    expect(screen.getByText("Plano do Nino")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ajustar meta/ }));
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pausar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    expect(h.onAdjust).toHaveBeenCalled(); expect(h.onEdit).toHaveBeenCalled(); expect(h.onToggleStatus).toHaveBeenCalled(); expect(h.onDelete).toHaveBeenCalled();
  });
  it("a tela de detalhe continua com o cartão completo (não compacto)", () => {
    renderCard(false);
    expect(screen.getByRole("button", { name: /Editar/ })).toBeTruthy();
    expect(screen.getByText("Plano do Nino")).toBeTruthy();
  });
});

describe("skill unslop incluída com crédito", () => {
  it("mantém a licença e o crédito ao autor, e não traz scripts de terceiros", () => {
    const notice = readFileSync(".claude/skills/unslop/NOTICE.md", "utf8");
    expect(notice).toMatch(/Damir Sokolovsky/);
    expect(notice).toMatch(/CC BY 4\.0/);
    expect(readFileSync(".claude/skills/unslop/SKILL.md", "utf8")).toMatch(/created by Damir Sokolovsky/);
    expect(() => readFileSync(".claude/skills/unslop/scripts/snapshot.mjs")).toThrow();
  });
});
