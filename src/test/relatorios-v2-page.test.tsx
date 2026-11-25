import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildReportV2, type V2Entry } from "@/lib/engine/reportV2";

const exp = (id: string, date: string, amount: number, category: string, m?: string): V2Entry => ({ id, date, kind: "expense", amount, category_id: `c-${category}`, category, merchant_key: m ?? null, merchant: m ?? null, chart_date: date });
const entries: V2Entry[] = [];
let n = 0;
for (const mo of ["2026-08", "2026-09", "2026-10", "2026-11"]) {
  entries.push(exp(`a${n++}`, `${mo}-02`, 1000, "Aluguel"), exp(`a${n++}`, `${mo}-10`, mo === "2026-11" ? 700 : 400, "Mercado", "Pão de Açúcar"), exp(`a${n++}`, `${mo}-12`, 30, "Lazer", "Cinema"));
  entries.push({ id: `i${n++}`, date: `${mo}-05`, kind: "income", amount: 5000, category_id: null, category: "Salário", merchant_key: null, merchant: null });
}
const snapshot = { availableToday: 4791, projection: { currentAvailableBalance: 4791, estimatedIncomeEvents: [{ date: "2026-11-30", amount: 9430, source: "configured", label: "Salário" }], upcomingConfirmedCommitments: 2100, cardDueThisMonth: 650, projectedVariableSpending: 0, projectedEndBalance: 11471 }, commitmentAgenda: { horizonEnd: "2026-12-24", pendingItems: [{ type: "expense", amount: 700, date: "2026-11-28", source: "card_statement" }] } };
const report = buildReportV2({ today: "2026-11-24", month: "2026-11", compare: "previous", entries, debtSplits: {}, isStructuralCategory: (x) => /aluguel/i.test(x), profile: null, snapshot, monthlyFact: null, receivables: [], commitmentMonths: [], patterns: [], situationActions: [], savingsGoalIds: [], netWorthSeries: [{ month: "2026-09", value: -500 }, { month: "2026-10", value: 200 }] });

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => ({}) } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/engine/facts", async (orig) => ({ ...(await orig<object>()), todayISO: () => "2026-11-24" }));

import RelatoriosInteligentes from "@/pages/RelatoriosInteligentes";

invoke.mockImplementation(async () => ({ data: { report }, error: null }));
const renderAt = (url: string) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><RelatoriosInteligentes /></MemoryRouter></QueryClientProvider>);

describe("Relatórios v2 — quatro abas", () => {
  it("Visão geral: consumo, trio, ponte, curva e recomendações; sem tudo aberto", async () => {
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    expect(screen.getByText("Receitas")).toBeTruthy();
    expect(screen.getByText("Resultado")).toBeTruthy();
    expect(screen.getByText("Saldo hoje")).toBeTruthy();
    expect(screen.getByText("Evolução do consumo")).toBeTruthy();
    expect(screen.queryByText("Saldo esperado até o fim do mês")).toBeNull();
  });
  it("navega pelas quatro abas e mostra o conteúdo de cada uma", async () => {
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    fireEvent.click(screen.getByRole("tab", { name: "Comportamento" }));
    await screen.findByText("Gastos fixos e ajustáveis");
    expect(screen.getByText("Categorias e estabelecimentos")).toBeTruthy();
    expect(screen.getByText(/Comparar com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Projeções" }));
    await screen.findByText("Saldo esperado até o fim do mês");
    expect(screen.getByText("Saldo projetado")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Evolução" }));
    await waitFor(() => expect(screen.getByText("Evolução mensal do resultado")).toBeTruthy());
    expect(screen.getByText("Evolução patrimonial")).toBeTruthy();
  });
});

describe("Relatórios v2 — período, drill-down, exportação e meses fechados", () => {
  it("trocar o mês pede o mês certo ao servidor", async () => {
    invoke.mockClear();
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    fireEvent.click(screen.getByLabelText("Mês anterior"));
    await waitFor(() => expect(invoke.mock.calls.some((c) => (c[1] as { body: { month: string } }).body.month === "2026-10")).toBe(true));
  });
  it("mudar a comparação pede o servidor de novo e a escolha fica na URL", async () => {
    invoke.mockClear();
    renderAt("/app/relatorios?aba=comportamento");
    await screen.findByText("Gastos fixos e ajustáveis");
    fireEvent.change(screen.getByDisplayValue("Mês anterior"), { target: { value: "year" } });
    await waitFor(() => expect(invoke.mock.calls.some((c) => (c[1] as { body: { compare: string } }).body.compare === "year")).toBe(true));
  });
  it("drill-down: a categoria aberta leva aos lançamentos do mês", async () => {
    renderAt("/app/relatorios?aba=comportamento");
    await screen.findByText("Categorias e estabelecimentos");
    fireEvent.click(within(screen.getByRole("region", { name: "Categorias e estabelecimentos" })).getByText("Mercado"));
    const link = await screen.findByText(/Ver os \d+ lançamentos/);
    expect(link.closest("a")?.getAttribute("href")).toMatch(/^\/app\/lancamentos\?category=c-Mercado&start=2026-11-01&end=2026-11-31$/);
  });
  it("exportação e impressão continuam no cabeçalho", async () => {
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    expect(screen.getByLabelText("Exportar CSV")).toBeTruthy();
    expect(screen.getByLabelText("Imprimir")).toBeTruthy();
  });
  it("a composição de gastos soma 100% na tela", async () => {
    renderAt("/app/relatorios?aba=comportamento");
    await screen.findByText("Gastos fixos e ajustáveis");
    const lis = Array.from(document.querySelectorAll("section[aria-label='Gastos fixos e ajustáveis'] li"));
    const pcts = lis.map((li) => Number((li.textContent ?? "").match(/(-?\d+)%/)?.[1]));
    expect(pcts.length).toBeGreaterThan(1);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(99);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
  });
});
