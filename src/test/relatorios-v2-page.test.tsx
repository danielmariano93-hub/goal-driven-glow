import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: { report }, error: null }) }, from: () => ({}) } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/engine/facts", async (orig) => ({ ...(await orig<object>()), todayISO: () => "2026-11-24" }));

import RelatoriosInteligentes from "@/pages/RelatoriosInteligentes";

const renderAt = (url: string) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><RelatoriosInteligentes /></MemoryRouter></QueryClientProvider>);

describe("Relatórios v2 — quatro abas", () => {
  it("Visão geral: consumo, trio, ponte, curva e recomendações; sem tudo aberto", async () => {
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    expect(screen.getByText("Receitas")).toBeTruthy();
    expect(screen.getByText("Resultado")).toBeTruthy();
    expect(screen.getByText("Saldo hoje")).toBeTruthy();
    expect(screen.getByText("Evolução do consumo")).toBeTruthy();
    expect(screen.queryByText("Projeção de saldo até o fim do mês")).toBeNull();
  });
  it("navega pelas quatro abas e mostra o conteúdo de cada uma", async () => {
    renderAt("/app/relatorios");
    await screen.findByText("Consumo do mês");
    fireEvent.click(screen.getByRole("tab", { name: "Comportamento" }));
    await screen.findByText("Gastos fixos e ajustáveis");
    expect(screen.getByText("Categorias e estabelecimentos")).toBeTruthy();
    expect(screen.getByText(/Comparar com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Projeções" }));
    await screen.findByText("Projeção de saldo até o fim do mês");
    expect(screen.getByText("Saldo projetado")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Evolução" }));
    await waitFor(() => expect(screen.getByText("Evolução mensal do resultado")).toBeTruthy());
    expect(screen.getByText("Evolução patrimonial")).toBeTruthy();
  });
});
