import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DayPlansAccordionView } from "@/components/metas/DayPlanCard";
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

describe("acordeão 'Planos e experimentos' em Metas", () => {
  it("sem plano e sem como criar, não renderiza nada; podendo criar, mostra a linha de convite", () => {
    const { container, rerender } = render(<DayPlansAccordionView rows={[]} today="2026-11-05" />);
    expect(container.firstChild).toBeNull();
    rerender(<DayPlansAccordionView rows={[]} today="2026-11-05" canCreate onCreate={() => {}} />);
    expect(screen.getByTestId("day-plans-summary").textContent).toMatch(/Nenhum plano ainda/);
  });
  it("fechado: uma linha de resumo e nada do conteúdo (discreto perto das metas)", () => {
    render(<DayPlansAccordionView rows={[row({})]} today="2026-11-05" canCreate onCreate={() => {}} />);
    expect(screen.getByTestId("day-plans-summary").textContent).toBe("1 plano medido · último: 38% abaixo do seu padrão");
    expect(screen.getByRole("button", { name: /Planos e experimentos/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("day-plan-last")).toBeNull();
    expect(screen.queryByText("Abaixo do seu padrão")).toBeNull();
  });
  it("aberto: último resultado com uma etiqueta graduada, histórico e o botão de criar", () => {
    const onCreate = vi.fn();
    render(<DayPlansAccordionView rows={[row({})]} today="2026-11-05" canCreate onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /Planos e experimentos/ }));
    expect(screen.getByText("Abaixo do seu padrão")).toBeTruthy();
    expect(screen.getByTestId("day-plan-last").textContent).toMatch(/38% abaixo do seu padrão/);
    expect(within(screen.getByTestId("day-plan-history")).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Criar um plano/ }));
    expect(onCreate).toHaveBeenCalled();
  });
  it("sem permissão para criar, o botão não aparece", () => {
    render(<DayPlansAccordionView rows={[row({})]} today="2026-11-05" />);
    fireEvent.click(screen.getByRole("button", { name: /Planos e experimentos/ }));
    expect(screen.queryByRole("button", { name: /Criar um plano/ })).toBeNull();
  });
  it("plano combinado: abre sozinho, mostra 'Combinado' e permite cancelar", () => {
    const onCancel = vi.fn();
    const active = row({ friday: "2026-11-06", status: "accepted", target_amount: 216, realized_amount: null });
    render(<DayPlansAccordionView rows={[active]} today="2026-11-05" canCreate onCreate={() => {}} onCancel={onCancel} />);
    expect(screen.getByTestId("day-plans-summary").textContent).toMatch(/Plano de sexta combinado · Lazer, teto de R\$\s?216,00/);
    expect(screen.getByRole("button", { name: /Planos e experimentos/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Combinado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cancelar este plano/ }));
    expect(onCancel).toHaveBeenCalledWith(active);
  });
  it("plano proposto: diz como combinar pelo WhatsApp e não oferece cancelar", () => {
    render(<DayPlansAccordionView rows={[row({ friday: "2026-11-06", status: "offered", realized_amount: null, accepted_at: null })]} today="2026-11-05" onCancel={() => {}} />);
    expect(screen.getByTestId("day-plan-open").textContent).toMatch(/Proposto.*“topo”/);
    expect(screen.queryByRole("button", { name: /Cancelar este plano/ })).toBeNull();
  });
  it("a média só aparece com 3 planos medidos e diz que não prova causa", () => {
    const two = [row({}), row({ friday: "2026-10-02", realized_amount: 150, status: "kept" })];
    const { rerender } = render(<DayPlansAccordionView rows={two} today="2026-11-05" />);
    fireEvent.click(screen.getByRole("button", { name: /Planos e experimentos/ }));
    expect(screen.queryByTestId("day-plan-average")).toBeNull();
    rerender(<DayPlansAccordionView rows={[...two, row({ friday: "2026-09-25", realized_amount: 140, status: "kept" })]} today="2026-11-05" />);
    const avg = screen.getByTestId("day-plan-average");
    expect(avg.textContent).toMatch(/Nos 3 planos medidos.*em média.*padrão de/);
    expect(avg.textContent).toMatch(/não prova que foi o plano/);
  });
});
