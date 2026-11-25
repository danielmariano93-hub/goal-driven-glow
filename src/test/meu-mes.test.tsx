import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { report } from "./fixtures/meuMesFixture";
import { buildEditorial, EDITORIAL_THRESHOLDS } from "@/lib/engine/reportEditorial";
import type { ReportV2 } from "@/lib/engine/reportV2";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => ({ upsert: async () => ({ error: null }) }) } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/engine/facts", async (orig) => ({ ...(await orig<object>()), todayISO: () => "2026-11-25" }));

import RelatoriosInteligentes from "@/pages/RelatoriosInteligentes";

invoke.mockImplementation(async (_fn: string, opts: { body: { month: string } }) => ({ data: { report: opts.body.month === report.month ? report : { ...report, month: opts.body.month, isCurrentMonth: false } }, error: null }));
function Probe() { const l = useLocation(); return <p data-testid="destino">{l.pathname}{l.search}</p>; }
const renderAt = (url: string) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><Routes><Route path="/app/relatorios" element={<RelatoriosInteligentes />} /><Route path="/app/lancamentos" element={<Probe />} /><Route path="/app/*" element={<Probe />} /></Routes></MemoryRouter></QueryClientProvider>);
const ready = () => screen.findByRole("heading", { level: 2, name: /Você está gastando/ });

describe("Meu mês — estrutura (handoff one page)", () => {
  it("título, seletor de mês e índice com as seis âncoras, sem abas", async () => {
    renderAt("/app/relatorios");
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: "Meu mês" })).toBeTruthy();
    expect(screen.getByText(/faltam 5 dias/)).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Capítulos do mês" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Hoje", "Gastos", "Hábitos", "Futuro", "Evolução", "Ação"]);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
  it("seis capítulos em ordem fixa e no máximo dois heroes escuros", async () => {
    const { container } = renderAt("/app/relatorios");
    await ready();
    expect([...container.querySelectorAll("[data-chapter]")].map((e) => e.id)).toEqual(["momento", "gastos", "habitos", "futuro", "evolucao", "acao"]);
    expect(container.querySelectorAll("[data-hero]").length).toBe(2);
  });
  it("01: diagnóstico editorial, disponível hoje, consumo, saldo projetado e próxima entrada", async () => {
    renderAt("/app/relatorios");
    await ready();
    const hero = document.getElementById("momento")!;
    expect(within(hero).getByText("Disponível hoje")).toBeTruthy();
    expect(within(hero).getByText("R$ 3.554")).toBeTruthy();
    expect(within(hero).getByText("R$ 11.783")).toBeTruthy();
    expect(within(hero).getByText(/Próxima entrada prevista/)).toBeTruthy();
    expect(within(hero).getByText(/pode estar subestimado/)).toBeTruthy();
  });
  it("04: saldo esperado, cenário sem renda e consumo projetado; ponte e simulador com restauração", async () => {
    renderAt("/app/relatorios");
    await ready();
    const fut = document.getElementById("futuro")!;
    expect(within(fut).getByText("Se essa renda não entrar, você fecha o mês com")).toBeTruthy();
    expect(within(fut).getByText("R$ 2.353")).toBeTruthy();
    fireEvent.click(within(fut).getByRole("button", { name: "Ver ponte e simular" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("R$ 11.783,34").length).toBe(2); // total da ponte + cenário inicial
    expect(within(dialog).getByText(/Sem a renda prevista: R\$ 2\.352,90/)).toBeTruthy();
    expect(within(dialog).getByText(/Antes do consumo variável: R\$ 12\.070,70/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText("Contar a renda prevista"));
    expect(within(dialog).getAllByText("R$ 11.783,34").length).toBe(1);
    expect(within(dialog).getAllByText("R$ 2.352,90").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar cenário" }));
    expect(within(dialog).getAllByText("R$ 11.783,34").length).toBe(2);
  });
  it("06: ação principal com verbo, valor e unidade; ação de caixa sem valor não vira protagonista", async () => {
    renderAt("/app/relatorios");
    await ready();
    const acao = document.getElementById("acao")!;
    expect(within(acao).getByRole("heading", { level: 2 }).textContent).toBe("Revise os gastos com assinaturas");
    expect(within(acao).getByText("Até R$ 375/mês estimados")).toBeTruthy();
    expect(within(acao).getByText(/Método report_v2/)).toBeTruthy();
  });
  it("detalhes sob demanda: categorias abrem em gaveta com a comparação dentro", async () => {
    invoke.mockClear();
    renderAt("/app/relatorios");
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Ver categorias, estabelecimentos e lançamentos" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Comparar com"), { target: { value: "year" } });
    await waitFor(() => expect(invoke.mock.calls.some((c) => (c[1] as { body: { compare: string } }).body.compare === "year")).toBe(true));
  });
  it("trocar o mês não mostra números do mês anterior durante a carga e passa para 'mês encerrado'", async () => {
    renderAt("/app/relatorios");
    await ready();
    fireEvent.click(screen.getByLabelText("Mês anterior"));
    await screen.findByText("Mês encerrado", { selector: "span" });
    await screen.findByText("Você consumiu no mês");
    expect(screen.queryByText("Disponível hoje")).toBeNull();
  });
  it("menu de ações mantém exportar e imprimir", async () => {
    renderAt("/app/relatorios");
    await ready();
    expect(screen.getByLabelText("Ações do relatório")).toBeTruthy();
  });
});

describe("Meu mês — reconciliação (seção 14)", () => {
  const cash = report.projections.cash!;
  it("ponte de caixa: 4.761,12 + 9.430,44 − 1.861,06 − 259,80 − 287,36 = 11.783,34; sem renda 2.352,90", () => {
    const v = (k: string) => cash.steps.find((s) => s.key === k)!.value;
    expect(v("start")).toBe(4761.12);
    expect(Math.round((v("start") + v("income") - v("commitments") - v("card") - v("variable")) * 100) / 100).toBe(11783.34);
    expect(cash.projectedEnd).toBe(11783.34);
    expect(cash.withoutIncomeEnd).toBe(2352.9);
    expect(cash.freeCash).toBe(12070.7);
  });
  it("recebíveis: vencidos + a vencer, fora do saldo", () => {
    const r = report.projections.receivables!;
    expect(Math.round(r.overdue + r.toDue)).toBe(5437);
  });
  it("classes somam o consumo com o estorno como parcela negativa; percentuais assinados fecham 100", () => {
    const b = report.behavior!;
    const parts = Object.values(b.split.classes);
    expect(Math.round(parts.reduce((s, v) => s + v, 0) * 100) / 100).toBe(b.split.total);
    const pcts = parts.filter((v) => v !== 0).map((v) => Math.round((v / b.split.total) * 100));
    expect(Math.abs(pcts.reduce((s, v) => s + v, 0) - 100)).toBeLessThanOrEqual(1);
    expect(parts.some((v) => v < 0)).toBe(true);
  });
  it("oportunidades: 375 + 261 + 60 + 27 = 723, sem somar pequenos gastos", () => {
    const rec = report.projections.recoverable!;
    expect(rec.sources.reduce((s, x) => s + x.monthly, 0)).toBe(723);
    expect(rec.monthly).toBe(723);
  });
  it("vencimentos com data e origem; fatura estimada sem data inventada", () => {
    const items = report.projections.commitments!.items!;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(i.date))).toBe(true);
    expect(items.find((i) => i.estimated)?.date).toBe("");
  });
});

describe("Meu mês — motor editorial determinístico", () => {
  it("mudança de consumo vira o destaque quando não há risco de caixa nem pressão", () => {
    const ed = buildEditorial(report);
    expect(ed.dominant.kind).toBe("consumption");
    expect(ed.dominant.title).toMatch(/gastando \d+% menos que o habitual/);
    expect(ed.dominant.detail).toMatch(/calendário/);
    expect(ed.complementary.length).toBeLessThanOrEqual(2);
  });
  it("qualidade crítica vence tudo quando o saldo de hoje não existe", () => {
    const r = { ...report, overview: { ...report.overview!, balance: { available: null, asOf: null } } } as ReportV2;
    expect(buildEditorial(r).dominant.kind).toBe("quality");
  });
  it("risco de caixa só com vencimentos datados antes da próxima entrada", () => {
    const base = report.projections.commitments!;
    const r = { ...report, projections: { ...report.projections, commitments: { ...base, items: [{ date: "2026-11-26", label: "Parcela", amount: 6000, group: "debts" as const, estimated: false }] } } } as ReportV2;
    const ed = buildEditorial(r);
    expect(ed.dominant.kind).toBe("cash_risk");
    expect(ed.dominant.title).toBe("Seu saldo pode faltar antes de 27/11");
    const noDates = { ...report, projections: { ...report.projections, commitments: { ...base, items: [{ date: "", label: "Fatura", amount: 6000, group: "cards" as const, estimated: true }] } } } as ReportV2;
    expect(buildEditorial(noDates).dominant.kind).not.toBe("cash_risk");
  });
  it("pressão de compromissos usa o limiar configurado", () => {
    expect(buildEditorial(report, { ...EDITORIAL_THRESHOLDS, commitmentPressurePct: 0.4 }).dominant.kind).toBe("commitments");
  });
  it("é determinístico", () => {
    expect(JSON.stringify(buildEditorial(report))).toBe(JSON.stringify(buildEditorial(report)));
  });
});

describe("Meu mês — ajustes da revisão (metas e próximo passo)", () => {
  it("metas usam o status do motor canônico (o mesmo da aba Metas)", () => {
    expect(report.evolution.goals.spending.every((g) => g.status !== "on_track" || g.verdict === "no_ritmo")).toBe(true);
  });
  it("ação de caixa coberta pelo saldo não vira protagonista e diz o que é, quanto e quando", () => {
    const sit = report.recommendations.items.find((r) => r.kind === "situation")!;
    expect(sit.title).toBe("Reserve R$ 1.566 para 09/12");
    expect(sit.body).toMatch(/^A parcela de Tia é de R\$ 1\.566,00 e vence em 09\/12\. O saldo previsto .* já cobre esse valor\.$/);
    expect(sit.urgent).toBe(false);
    expect(report.recommendations.items[0].kind).not.toBe("situation");
  });
});
