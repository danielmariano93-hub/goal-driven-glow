import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommitmentsCard, ConsumptionHero, CostSplitCards, MonthSelector, ReportTabs, StorySection, SummaryTrio, TopCategories, brl0, parseTab } from "@/components/reports/StoryParts";
import { ninoRedirectTarget } from "@/lib/navigation/ninoRedirect";
import { resolveAppRoute } from "@/lib/navigation/resolveRoute";
import type { ReportDashboard } from "@/lib/engine/reportDashboard";
import type { FutureView, ReportStory } from "@/lib/engine/reportStory";

const dash = (over: Partial<ReportDashboard>) => ({ filtered: false, projection: null, totals: { expense: 6240, income: 8000, net: 1760 }, ...over }) as ReportDashboard;
const story = (over: Partial<ReportStory> = {}) => ({
  version: "report_story.v1", month: "2026-11", windowDays: 24,
  habitual: { expense: 5830, months: ["2026-08", "2026-09", "2026-10"], deltaAbs: 410, deltaPct: 0.07 }, income: null, cumulative: null,
  categories: [
    { id: "a", name: "Moradia", total: 2480, share: .4, habitual: 2430, deltaPct: 0.02, essential: true },
    { id: "b", name: "Alimentação", total: 1340, share: .2, habitual: 1207, deltaPct: 0.11, essential: false },
    { id: "c", name: "Transporte", total: 720, share: .1, habitual: 783, deltaPct: -0.08, essential: false },
    { id: "d", name: "Lazer", total: 300, share: .05, habitual: 300, deltaPct: 0, essential: false }],
  variations: [], weekday: null, split: { essential: 3900, adjustable: 2340, essentialShare: 0.625, flaggedCategories: 4 },
  sustainableSavings: null, recoverable: null, action: null, ...over,
}) as ReportStory;

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Relatórios no desenho do protótipo", () => {
  it('duas abas; a antiga aba mais cai em Visão geral', () => {
    expect(parseTab(null)).toBe("geral");
    expect(parseTab("xyz")).toBe("geral");
    expect(parseTab("mais")).toBe("geral");
    expect(parseTab("categorias")).toBe("categorias");
    render(<ReportTabs active="categorias" onChange={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Visão geral", "Categorias e mais"]);
    expect(screen.getByRole("tab", { name: "Categorias e mais" }).getAttribute("aria-selected")).toBe("true");
  });

  it("seletor de mês: 'Novembro 2026 / Até o dia 24', setas e mês seguinte desligado no mês atual", () => {
    const picks: Array<{ start: string; end: string; isCurrent: boolean }> = [];
    wrap(<MonthSelector start="2026-11-01" end="2026-11-24" today="2026-11-24" onPick={(r) => picks.push(r)} />);
    expect(screen.getAllByText("Novembro 2026").length).toBeGreaterThan(0);
    expect(screen.getByText("Até o dia 24")).toBeTruthy();
    expect((screen.getByLabelText("Mês seguinte") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Mês anterior"));
    expect(picks[0]).toEqual({ start: "2026-10-01", end: "2026-10-31", isCurrent: false });
  });

  it("sem histórico, o hero mostra o consumo e explica por que não compara", () => {
    wrap(<ConsumptionHero d={dash({})} story={story({ habitual: null })} />);
    expect(screen.getByText("R$ 6.240")).toBeTruthy();
    expect(screen.getByText(/2 meses fechados/)).toBeTruthy();
    expect(screen.queryByText(/vs\. seu habitual/)).toBeNull();
  });

  it("hero: valor, variação contra o habitual e frase; a definição fica no ⓘ", () => {
    wrap(<ConsumptionHero d={dash({})} story={story()} />);
    expect(screen.getByText("R$ 6.240")).toBeTruthy();
    expect(screen.getByText(/seu habitual/)).toBeTruthy();
    expect(screen.getByText("Seu gasto está acima do habitual para este período.")).toBeTruthy();
    expect(screen.queryByText(/mediana/)).toBeNull();
    fireEvent.click(screen.getByLabelText("O que é: habitual"));
    expect(screen.getByRole("note").textContent).toMatch(/mediana/);
  });

  it("principais categorias: só as 3 maiores, com variação", () => {
    wrap(<TopCategories story={story()} windowEnd="2026-11-24" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Lazer")).toBeNull();
    expect(screen.getByText("+11%")).toBeTruthy();
    expect(screen.getByText("−8%")).toBeTruthy();
  });

  it("renda a caminho: Resultado aguarda em vez de ficar negativo", () => {
    wrap(<SummaryTrio d={dash({ totals: { expense: 6757, income: 0, net: -6757 } as ReportDashboard["totals"] })} story={story({ income: { current: 0, typical: 8527, incomplete: true } })} future={{ balance: 4791 } as FutureView} />);
    expect(screen.getByText("aguardando a renda do mês")).toBeTruthy();
    expect(screen.queryByText(/6\.757/)).toBeNull();
    expect(screen.getByText("R$ 4.791")).toBeTruthy();
  });

  it("gastos fixos e ajustáveis com os rótulos do protótipo", () => {
    wrap(<CostSplitCards story={story()} />);
    expect(screen.getByText("Gastos fixos")).toBeTruthy();
    expect(screen.getByText("Gastos ajustáveis")).toBeTruthy();
    expect(screen.getByText("63% do total")).toBeTruthy();
  });

  it("compromissos usam os rótulos do protótipo e somem sem dado", () => {
    const f = { commitments: { total: 2850, hasEstimates: false, groups: [{ key: "cards", label: "x", amount: 950 }, { key: "debts", label: "x", amount: 700 }, { key: "recurring", label: "x", amount: 1200 }] } } as FutureView;
    const { container, rerender } = wrap(<CommitmentsCard future={f} />);
    expect(screen.getByText("Parcelas (cartão e compras)")).toBeTruthy();
    expect(screen.getByText("Recorrências (assinaturas, planos etc.)")).toBeTruthy();
    expect(screen.getByText("R$ 2.850")).toBeTruthy();
    rerender(<MemoryRouter><CommitmentsCard future={null} /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });

  it("seção empilhada tem título e subtítulo da tela do protótipo", () => {
    render(<StorySection id="ato-vai" title="Para onde você vai" subtitle="Projeção dos próximos 30 dias"><p>x</p></StorySection>);
    expect(screen.getByRole("heading", { name: "Para onde você vai" })).toBeTruthy();
    expect(document.getElementById("ato-vai")).not.toBeNull();
    expect(brl0(1234.6)).toBe("R$ 1.235");
  });

  it("links antigos da aba Nino caem no lugar certo", () => {
    expect(ninoRedirectTarget(null)).toBe("/app");
    expect(ninoRedirectTarget("mudancas")).toBe("/app/relatorios?ato=mudou");
    expect(ninoRedirectTarget("prepare-se")).toBe("/app/relatorios?ato=vai");
    expect(resolveAppRoute("/app/nino?section=aprendizados")).toBe("/app/relatorios?ato=mudou");
  });
});
