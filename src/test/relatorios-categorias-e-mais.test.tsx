import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { aggregateMerchants, CategoriesTabContent } from "@/components/reports/CategoriesTab";
import type { DashCategoryRow, ReportDashboard } from "@/lib/engine/reportDashboard";

const cat = (over: Partial<DashCategoryRow>): DashCategoryRow => ({
  id: "c", name: "Transporte", total: 540, share: 0.3, count: 4, previous: 360, previousMonth: null, deltaAbs: 180, deltaPct: 0.5, spark: [], merchants: [], ...over,
});
const dash = (categories: DashCategoryRow[], over: Partial<ReportDashboard> = {}) => ({
  categories, previous: { start: "2026-10-01", end: "2026-10-24", days: 24 }, coverage: { comparisonAvailable: true }, ...over,
}) as ReportDashboard;

const cats = [
  cat({ id: "t", name: "Transporte", total: 540, previous: 360, deltaPct: 0.5, merchants: [
    { key: "uber", label: "Uber", total: 400, share: 0.74, previous: 200, deltaPct: 1 },
    { key: "99", label: "99", total: 100, share: 0.18, previous: 160, deltaPct: -0.38 },
    { key: "__others__", label: "Outros", total: 40, share: 0.08, previous: 0, deltaPct: null }] }),
  cat({ id: "a", name: "Alimentação", total: 420, previous: 420, deltaPct: 0, share: 0.25, merchants: [
    { key: "uber", label: "Uber", total: 30, share: 0.07, previous: 0, deltaPct: null },
    { key: "ifood", label: "iFood", total: 390, share: 0.93, previous: 420, deltaPct: -0.07 }] }),
  cat({ id: "m", name: "Moradia", total: 14, previous: 0, previousMonth: 3808, deltaPct: null, share: 0.01, merchants: [] }),
  cat({ id: "n", name: "Pets", total: 80, previous: 0, previousMonth: null, deltaPct: null, share: 0.04, merchants: [] }),
];

describe("aba Categorias e mais", () => {
  it("categorias com comparação: subiu, estável, sem gasto até aqui e novo", () => {
    render(<CategoriesTabContent d={dash(cats)} compare="previous" onCompare={() => {}} />);
    const list = within(screen.getByRole("region", { name: "Categorias" }));
    expect(list.getByText("+50%")).toBeTruthy();
    expect(list.getByText("estável")).toBeTruthy();
    expect(list.getByText("sem gasto até aqui")).toBeTruthy();
    expect(list.getByText("novo")).toBeTruthy();
    expect(list.getByText(/mês passado inteiro R\$ 3\.808/)).toBeTruthy();
    expect(screen.getByText("Comparado com os mesmos dias do mês anterior (01/10 a 24/10).")).toBeTruthy();
  });

  it("estabelecimentos somam as categorias e cada um traz a sua comparação", () => {
    const merchants = aggregateMerchants(dash(cats));
    expect(merchants.map((m) => m.label)).toEqual(["Uber", "iFood", "99"]);
    expect(merchants[0]).toMatchObject({ total: 430, previous: 200, category: "Transporte" });
    render(<CategoriesTabContent d={dash(cats)} compare="previous" onCompare={() => {}} />);
    const section = within(screen.getByRole("region", { name: "Estabelecimentos" }));
    expect(section.getByText("+115%")).toBeTruthy(); // Uber: 430 vs 200
    expect(section.getByText("−7%")).toBeTruthy(); // iFood
    expect(section.getByText("−38%")).toBeTruthy(); // 99
  });

  it("'Outros' e sem identificação não aparecem como estabelecimento", () => {
    const labels = aggregateMerchants(dash([cat({ merchants: [{ key: "__none__", label: "Sem identificação", total: 50, share: 0.1, previous: 0, deltaPct: null }, { key: "__others__", label: "Outros", total: 9, share: 0.1, previous: 0, deltaPct: null }] })])).map((m) => m.label);
    expect(labels).toEqual([]);
  });

  it("toque na categoria mostra os estabelecimentos dela com a variação de cada um", () => {
    render(<CategoriesTabContent d={dash(cats)} compare="previous" onCompare={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Transporte/ }));
    const list = within(screen.getByRole("region", { name: "Categorias" }));
    expect(list.getByText("+100%")).toBeTruthy();
    expect(list.getByText("−38%")).toBeTruthy();
  });

  it("busca filtra estabelecimentos por nome e categoria, sem acento", () => {
    render(<CategoriesTabContent d={dash(cats)} compare="previous" onCompare={() => {}} />);
    fireEvent.change(screen.getByLabelText("Buscar estabelecimento ou categoria"), { target: { value: "alimentacao" } });
    const section = within(screen.getByRole("region", { name: "Estabelecimentos" }));
    expect(section.queryByText("99")).toBeNull();
    expect(section.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("sem comparação: sem chips nem 'antes', e a escolha de período de comparação existe", () => {
    const picks: string[] = [];
    render(<CategoriesTabContent d={dash(cats, { previous: null })} compare="none" onCompare={(m) => picks.push(m)} />);
    expect(screen.queryByText("+50%")).toBeNull();
    expect(screen.queryByText(/antes R\$/)).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "previous" } });
    expect(picks).toEqual(["previous"]);
  });
});
