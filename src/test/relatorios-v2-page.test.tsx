import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
function Probe() { const l = useLocation(); return <p data-testid="destino">{l.pathname}{l.search}</p>; }
const renderAt = (url: string) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><Routes><Route path="/app/relatorios" element={<RelatoriosInteligentes />} /><Route path="/app/lancamentos" element={<Probe />} /></Routes></MemoryRouter></QueryClientProvider>);
const ready = () => screen.findByRole("region", { name: "Consumo do mês" });

describe("Relatórios v2 — layout anterior (reversão ?versao=abas)", () => {
  it("Visão geral: KPI dominante, dois KPIs, resultado, curva; detalhes fechados", async () => {
    renderAt("/app/relatorios?versao=abas");
    await ready();
    expect(screen.getByText("Receitas")).toBeTruthy();
    expect(screen.getByText("Saldo disponível")).toBeTruthy();
    expect(screen.getByText(/Resultado (parcial|do mês)/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Evolução do consumo" })).toBeTruthy();
    // Composição e ponte do caixa só abrem na gaveta.
    expect(screen.queryByText("Ponte do caixa no mês")).toBeNull();
    expect(screen.queryByText(/bom sinal/i)).toBeNull();
  });
  it("a aba ativa é a única selecionada e as setas do teclado trocam de aba", async () => {
    renderAt("/app/relatorios?versao=abas");
    await ready();
    const geral = screen.getByRole("tab", { name: "Visão geral" });
    expect(geral.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(geral, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Comportamento" }).getAttribute("aria-selected")).toBe("true"));
  });
  it("navega pelas quatro abas e mostra o conteúdo de cada uma", async () => {
    renderAt("/app/relatorios?versao=abas");
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Comportamento" }));
    await screen.findByRole("region", { name: "Composição do consumo" });
    expect(screen.getByRole("region", { name: "Categorias e estabelecimentos" })).toBeTruthy();
    expect(screen.getByLabelText("Comparar com")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Projeções" }));
    await screen.findByText("Saldo esperado no fim do mês");
    expect(screen.getByText(/Sem a renda prevista/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Evolução" }));
    await screen.findByRole("region", { name: "Receitas × consumo" });
    expect(screen.getByRole("region", { name: "Patrimônio líquido registrado" })).toBeTruthy();
  });
});

describe("Relatórios v2 — período, drill-down, exportação e meses fechados", () => {
  it("trocar o mês pede o mês certo ao servidor", async () => {
    invoke.mockClear();
    renderAt("/app/relatorios?versao=abas");
    await ready();
    fireEvent.click(screen.getByLabelText("Mês anterior"));
    await waitFor(() => expect(invoke.mock.calls.some((c) => (c[1] as { body: { month: string } }).body.month === "2026-10")).toBe(true));
  });
  it("mudar a comparação (dentro do cartão) pede o servidor de novo", async () => {
    invoke.mockClear();
    renderAt("/app/relatorios?versao=abas&aba=comportamento");
    await screen.findByRole("region", { name: "Categorias e estabelecimentos" });
    fireEvent.change(screen.getByLabelText("Comparar com"), { target: { value: "year" } });
    await waitFor(() => expect(invoke.mock.calls.some((c) => (c[1] as { body: { compare: string } }).body.compare === "year")).toBe(true));
  });
  it("drill-down: tocar na categoria leva aos lançamentos dela no mês", async () => {
    renderAt("/app/relatorios?versao=abas&aba=comportamento");
    const card = await screen.findByRole("region", { name: "Categorias e estabelecimentos" });
    fireEvent.click(within(card).getByText("Mercado"));
    expect((await screen.findByTestId("destino")).textContent).toBe("/app/lancamentos?category=c-Mercado&start=2026-11-01&end=2026-11-31");
  });
  it("exportação e impressão ficam no menu de ações", async () => {
    renderAt("/app/relatorios?versao=abas");
    await ready();
    expect(screen.getByLabelText("Ações do relatório")).toBeTruthy();
  });
  it("a composição de gastos fecha 100% na tela (estorno como ajuste negativo)", async () => {
    renderAt("/app/relatorios?versao=abas&aba=comportamento");
    const card = await screen.findByRole("region", { name: "Composição do consumo" });
    const lis = Array.from(card.querySelectorAll("li")).slice(0, -1);
    const pcts = lis.map((li) => { const m = (li.textContent ?? "").match(/([−-]?)(\d+)%/); return m ? (m[1] ? -1 : 1) * Number(m[2]) : NaN; });
    expect(pcts.length).toBeGreaterThan(1);
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });
});
