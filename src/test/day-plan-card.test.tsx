import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DayPlanCardView } from "@/components/metas/DayPlanCard";
import { gradeDayPlan, gradedPlans, openPlan, weekdayName, type DayPlanRow } from "@/lib/behavioral/dayPlan";

const row = (over: Partial<DayPlanRow>): DayPlanRow => ({
  friday: "2026-10-09", category: "Lazer", status: "missed", target_amount: 160, expected_amount: 271.62, realized_amount: 169.58, accepted_at: "2026-10-09T10:00:00Z", ...over,
});

describe("resultado graduado do plano (day_plan.v1)", () => {
  it("o caso real de 09/10: R$ 9,58 acima do teto, 38% abaixo do padrão, não é 'falhou'", () => {
    const g = gradeDayPlan({ target: 160, expected: 271.62, realized: 169.58 });
    expect(g.band).toBe("partial");
    expect(g.vs_typical_pct).toBe(38);
    expect(g.over_target).toBe(9.58);
    expect(g.reading).toMatch(/Não chegou ao plano \(R\$\s?9,58 acima do teto\), mas ficou 38% abaixo do seu padrão/);
  });
  it("dentro do teto é 'met'; perto do padrão e acima do teto é 'missed'", () => {
    expect(gradeDayPlan({ target: 160, expected: 271.62, realized: 150 }).band).toBe("met");
    const bad = gradeDayPlan({ target: 160, expected: 271.62, realized: 260 });
    expect(bad.band).toBe("missed");
    expect(bad.reading).toMatch(/Passou do plano em R\$\s?100,00 e ficou perto do seu padrão/);
  });
  it("ruído de menos de 10% abaixo do padrão não vira 'abaixo do seu padrão'", () => {
    expect(gradeDayPlan({ target: 100, expected: 200, realized: 185 }).band).toBe("missed");
    expect(gradeDayPlan({ target: 100, expected: 200, realized: 175 }).band).toBe("partial");
  });
  it("sem padrão para comparar, só olha o teto", () => {
    const g = gradeDayPlan({ target: 100, expected: null, realized: 120 });
    expect(g.band).toBe("missed");
    expect(g.vs_typical_pct).toBeNull();
  });
  it("o nome do dia vem da data, não de 'sexta' fixo", () => {
    expect(weekdayName("2026-10-09")).toBe("sexta");
    expect(weekdayName("2026-11-04")).toBe("quarta");
  });
  it("só planos aceitos e fechados com valor entram nos medidos; o aberto é o combinado, senão o proposto", () => {
    const rows = [
      row({ friday: "2026-10-16", status: "offered", realized_amount: null, accepted_at: null }),
      row({ friday: "2026-10-23", status: "offered", category: "Transporte", target_amount: 140, realized_amount: null, accepted_at: null }),
      row({ friday: "2026-10-09" }),
    ];
    expect(gradedPlans(rows)).toHaveLength(1);
    expect(openPlan(rows, "2026-10-24")?.category).toBe("Transporte");
    expect(openPlan(rows, "2026-11-20")).toBeNull();
  });
});

describe("cartão 'Seu plano de…' em Metas", () => {
  it("sem nenhum plano, não renderiza nada (sem cartão vazio)", () => {
    const { container } = render(<DayPlanCardView rows={[]} today="2026-11-05" />);
    expect(container.firstChild).toBeNull();
  });
  it("plano proposto: mostra teto, o padrão e como combinar", () => {
    render(<DayPlanCardView rows={[row({ friday: "2026-11-04", status: "offered", realized_amount: null, accepted_at: null })]} today="2026-11-05" />);
    expect(screen.getByText("Seu plano de quarta")).toBeTruthy();
    expect(screen.getByTestId("day-plan-open").textContent).toMatch(/Proposto\..*R\$\s?160,00 em Lazer.*R\$\s?271,62.*“topo”/);
  });
  it("último resultado: uma etiqueta de estado graduada e a leitura em texto simples", () => {
    render(<DayPlanCardView rows={[row({})]} today="2026-11-05" />);
    expect(screen.getByText("Abaixo do seu padrão")).toBeTruthy();
    expect(screen.getByTestId("day-plan-last").textContent).toMatch(/38% abaixo do seu padrão/);
    expect(screen.queryByText("Dentro do plano")).toBeNull();
  });
  it("a média só aparece com 3 planos medidos e diz que não prova causa", () => {
    const two = [row({}), row({ friday: "2026-10-02", realized_amount: 150, status: "kept" })];
    const { rerender } = render(<DayPlanCardView rows={two} today="2026-11-05" />);
    expect(screen.queryByTestId("day-plan-average")).toBeNull();
    rerender(<DayPlanCardView rows={[...two, row({ friday: "2026-09-25", realized_amount: 140, status: "kept" })]} today="2026-11-05" />);
    const avg = screen.getByTestId("day-plan-average");
    expect(avg.textContent).toMatch(/Nos 3 planos medidos.*em média.*padrão de/);
    expect(avg.textContent).toMatch(/não prova que foi o plano/);
    expect(within(screen.getByTestId("day-plan-history")).getAllByRole("listitem").length).toBe(3);
  });
});
