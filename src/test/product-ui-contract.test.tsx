// Teste de CONTRATO DE UI: não basta "renderizou", o DADO IMPORTANTE precisa
// aparecer na tela. É o teste que teria pegado a regressão do nome da
// categoria nas Metas por Categoria.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";
import { ResumoContas } from "@/components/home/ResumoContas";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";
import { dataContractViolations, resetDataContractViolations } from "@/lib/observability/dataContract";

const today = new Date("2026-08-25T12:00:00");

function goal(category_id: string): CategorySpendingGoalRow {
  return {
    id: "g1", user_id: "u1", category_id, mode: "fixed_limit", reduction_pct: null,
    fixed_limit: 500, baseline_kind: "custom", baseline_value: 500, computed_limit: 500,
    frequency: "monthly", start_date: "2026-08-01", end_date: "2026-08-31",
    status: "active", period_type: "this_month",
  } as CategorySpendingGoalRow;
}

function renderCard(categoryName?: string) {
  const evaluation = evaluateCategoryGoal(goal("cat-global"), [], today, categoryName);
  return render(
    <MemoryRouter>
      <ul>
        <CategoryGoalCard evaluation={evaluation} onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} />
      </ul>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetDataContractViolations();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("contrato de UI — meta por categoria", () => {
  it("CASO A/B — nome da categoria (global ou pessoal) aparece na tela", () => {
    renderCard("Alimentação");
    expect(screen.getByText("Alimentação")).toBeInTheDocument();
    expect(screen.queryByText("Categoria")).not.toBeInTheDocument();
  });

  it("valor gasto e limite aparecem com o rótulo do período", () => {
    renderCard("Lazer");
    expect(screen.getByText(/de R\$/)).toBeInTheDocument();
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });

  it("CASO C — sem nome, fallback neutro E violação de contrato registrada", () => {
    renderCard(undefined);
    expect(screen.getByText("Categoria")).toBeInTheDocument();
    expect(dataContractViolations().category_name_missing).toBe(1);
  });

  it("não existe 'undefined' técnico visível no card", () => {
    const { container } = renderCard("Transporte");
    expect(container.textContent).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe("contrato de UI — resumo patrimonial da Home", () => {
  it("rótulos e destinos de conta/cartão/investimento/dívida aparecem", () => {
    const { container } = render(
      <MemoryRouter>
        <ResumoContas cash={1200} cardsOwed={340} invested={5000} otherDebts={0} />
      </MemoryRouter>,
    );
    for (const label of ["Contas", "Fatura do cartão", "Investimentos", "Outras dívidas"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const href of ["/app/contas", "/app/cartoes", "/app/investimentos", "/app/dividas"]) {
      expect(container.querySelector(`a[href="${href}"]`), href).toBeTruthy();
    }
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });
});
