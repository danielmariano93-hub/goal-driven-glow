import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildObservedProfileV3 } from "@/lib/engine/behaviorObservedV3";
import { buildHabitPatterns } from "../../supabase/functions/_shared/proactive/habitPatterns";

// Página v2 REAL com o motor v3 e o motor de padrões reais; só a rede é simulada.
// Cobre os critérios de aceite da especificação (AC-01 a AC-11) que dependem da interface.

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const iso = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const profile = buildObservedProfileV3({
  financialRow: { payload: { snapshot: {
    monthlyTotals: { expense: 9000 }, availableToday: 800, projection: { freeAfterKnownCommitments: 3200 },
    netWorth: { assets: 5137, owed: 65472 }, netWorthBridge: { openingDebts: 71000, closingDebts: 65472 },
  } } },
  checkins: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, occurred_at: iso(i * 3), mood: 3, financial_calm_score: 4 })),
  txStats: { count: 900, first_at: iso(120) },
  appActivity: { active_days_30: 28, planning_views_30: 87, movement_views_30: 54 },
  goalCycles: [], planningStats: { active_category_goals: 6, active_recurring_rules: 0 }, investmentStats: { contributions_90d: 8000, contribution_days_90d: 1 },
}, NOW);

// Fim de semana de Lazer: 12 fins de semana de R$ 150–400 e dias úteis quase sem gasto.
const tx: Array<{ occurred_at: string; amount: number; category: string }> = [];
for (let w = 1; w <= 12; w++) {
  const friday = new Date(Date.UTC(2026, 9, 9 - 7 * w, 12));
  tx.push({ occurred_at: friday.toISOString(), amount: 150 + (w % 5) * 40, category: "Lazer" });
  tx.push({ occurred_at: new Date(friday.getTime() + 86_400_000).toISOString(), amount: 60 + (w % 3) * 30, category: "Lazer" });
}
const patterns = buildHabitPatterns({ transactions: tx, today: "2026-10-09", goals: { Lazer: { name: "Lazer", limit: 1000, actual: 340 } } });

const state = {
  observed: profile,
  cycle: { cadenceDays: 15, due: false, nextDueAt: null, daysRemaining: 15, questionSetIndex: 0, questionSet: "wheel_set_a" },
  degradedSources: [], assessments: [], previousAssessment: null,
  latestAssessment: { id: "a1", overall_score: 3.6, scores: { awareness: 6, planning: 3, control: 6, consistency: 5, security: 2, wealth: 2, calm: 2, debt: 3 }, created_at: "2026-10-09T12:00:00Z" },
  hypotheses: [], activeExperiments: [], experiments: [], templates: [], recommendedTemplates: [], moodHistory: [], moodAverage30: 4, moodTrend14: null,
  emotionSpend: { sufficient: true, pairedDays: 41, vulnerableDays: 20, vulnerableAverage: 244.11, comparisonAverage: 85.29, upliftPct: 186 },
  momentSignal: null, highlights: [],
};

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const rpc = vi.fn(async (name: string, _args?: unknown) => (name === "habits_v2_enabled" ? { data: true, error: null } : { data: null, error: null }));
const feedbackCalls: unknown[] = [];

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/behavioral/dashboardSnapshot", () => ({ loadBehavioralDashboardSnapshot: async () => state }));
vi.mock("@/lib/behavioral/resilientClient", () => ({ loadBehavioralEvolutionResilient: async () => state }));
vi.mock("@/lib/behavioral/observedSnapshots", () => ({ useObservedSnapshots: () => ({ data: [] }), useSaveObservedSnapshot: () => undefined }));
vi.mock("@/lib/behavioral/observedFeedback", () => ({
  useObservedFeedback: () => ({ data: {} }),
  useContestDimension: () => ({ isPending: false, mutateAsync: async (a: unknown) => { feedbackCalls.push(a); } }),
  useRemoveFeedback: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args as never),
    functions: { invoke: async () => ({ data: { ok: true, as_of: "2026-10-09", ...patterns, commitments: {} }, error: null }) },
    from: () => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "gte", "in", "not", "order", "limit"]) c[m] = () => c; (c as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null }); return c; },
  },
}));
vi.mock("@/components/home/EmotionalCheckinCard", () => ({ EmotionalCheckinCard: () => <div>CHECKIN</div> }));
vi.mock("@/components/behavioral/MoneyMoodTimeline", () => ({ MoneyMoodTimeline: () => <div>MOODTIMELINE</div> }));

async function mount(Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText("Seus hábitos com dinheiro")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText("A principal descoberta")).toBeInTheDocument());
  return utils;
}

beforeEach(() => { rpc.mockClear(); feedbackCalls.length = 0; });

describe("hábitos v2 — página montada de verdade", () => {
  it("o motor de padrões sobre os dados do teste gera um padrão de Lazer com limite sugerido", () => {
    expect(patterns.shown[0].category).toBe("Lazer");
    expect(patterns.shown[0].action?.kind).toBe("suggest_limit");
  });

  it("AC-01/AC-06/AC-09: a primeira dobra é descoberta + roda, com no máximo 2 descobertas e sem experimentos", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    const { container } = await mount(HabitsV2);
    const text = container.textContent ?? "";
    expect(text.indexOf("O que o Nino descobriu")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("O que o Nino descobriu")).toBeLessThan(text.indexOf("Você e o que o Nino observa"));
    expect(container.querySelectorAll("article[aria-label]").length).toBeLessThanOrEqual(2);
    expect(text).not.toMatch(/Experimentos opcionais|Mude um comportamento por vez|Começar experimento|Testar por 14 dias/);
    // histórico e análises detalhadas é camada secundária, fechada por padrão
    const details = screen.getByText("Histórico e análises detalhadas").closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("AC-04: dimensão sem base não vira 0 nem nota; aparece como 'sem leitura confiável'", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    const { container } = await mount(HabitsV2);
    const planning = within(screen.getByLabelText("Dimensões")).getByText("Planejamento").closest("li")!;
    expect(planning.textContent).toContain("Base parcial");
    expect(planning.textContent).not.toMatch(/Nino \d/);
    expect(container.querySelector('[data-testid="no-reading-planning"]')).not.toBeNull();
    expect(container.textContent).toContain("sem leitura confiável");
  });

  it("AC-02/AC-03: tocar numa dimensão mostra observei / ainda não sei / como você se percebe e permite discordar com contexto", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    await mount(HabitsV2);
    fireEvent.click(within(screen.getByLabelText("Dimensões")).getByText("Planejamento").closest("button")!);
    const panel = await screen.findByLabelText(/Como o Nino chegou à leitura de Planejamento/);
    const text = panel.textContent ?? "";
    expect(text).toContain("O que observei");
    expect(text).toContain("6 metas de gasto ativas");
    expect(text).toContain("O que ainda não sei");
    expect(text).toContain("Como você se percebe");
    expect(text).toContain("Você se deu 3,0");
    expect(text).toContain("De onde vem e o que não prova");
    expect(text).not.toMatch(/87 acessos|87 vezes/); // acesso a telas não é prova de planejamento
    expect(text).toContain("Isso representa minha realidade?");
    fireEvent.click(within(panel).getByText("Não"));
    fireEvent.change(within(panel).getByPlaceholderText(/contar o contexto/), { target: { value: "Uso planilha fora do Nino" } });
    fireEvent.click(within(panel).getByText("Registrar"));
    await waitFor(() => expect(feedbackCalls).toHaveLength(1));
    expect(feedbackCalls[0]).toMatchObject({ dimension: "planning", verdict: "no", note: "Uso planilha fora do Nino" });
  });

  it("AC-07/AC-08: o limite mostra a conta e só vira compromisso depois do aceite explícito", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    await mount(HabitsV2);
    expect(rpc.mock.calls.filter(([n]) => String(n).startsWith("habit_limit"))).toHaveLength(0);
    fireEvent.click(screen.getByText("Ver um limite possível"));
    const effect = await screen.findByTestId("limit-effect");
    expect(effect.textContent).toMatch(/fecha em torno de/);
    expect(screen.getByText(/hipótese, não promessa/)).toBeInTheDocument();
    // abrir a sugestão ainda não cria nada
    expect(rpc.mock.calls.filter(([n]) => String(n) === "habit_limit_accept")).toHaveLength(0);
    // editar o valor recalcula o efeito no mês
    const before = effect.textContent;
    fireEvent.change(screen.getByLabelText(/Seu limite para Lazer/), { target: { value: "100" } });
    expect(screen.getByTestId("limit-effect").textContent).not.toBe(before);
    fireEvent.click(screen.getByText(/Aceitar R\$ 100/));
    await waitFor(() => expect(rpc.mock.calls.some(([n]) => n === "habit_limit_accept")).toBe(true));
    const [, args] = rpc.mock.calls.find(([n]) => n === "habit_limit_accept")! as unknown as [string, Record<string, unknown>];
    expect(args).toMatchObject({ p_category: "Lazer", p_target: 100 });
  });

  it("recusar registra a recusa e não cria compromisso", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    await mount(HabitsV2);
    fireEvent.click(screen.getByText("Agora não"));
    await waitFor(() => expect(rpc.mock.calls.some(([n]) => n === "habit_limit_decline")).toBe(true));
    expect(rpc.mock.calls.some(([n]) => n === "habit_limit_accept")).toBe(false);
  });

  it("AC-10/AC-11: emoção e Money Mood ficam na camada de detalhes, como associação e sem total 'perdido'", async () => {
    const { default: HabitsV2 } = await import("@/pages/HabitsV2");
    const { container } = await mount(HabitsV2);
    const details = screen.getByText("Histórico e análises detalhadas").closest("details")!;
    expect(details.textContent).toContain("MOODTIMELINE");
    expect(details.textContent).toContain("associação, não uma causa");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/por causa|por ansiedade|impulsiv|perdeu|186%/);
  });

  it("a flag decide a versão: v2 liberada mostra a nova página; sem acesso, a atual", async () => {
    const { default: Emocoes } = await import("@/pages/Emocoes");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText("A principal descoberta")).toBeInTheDocument());
    rpc.mockImplementation(async () => ({ data: false, error: null }));
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client2}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(container.textContent).toContain("O que seus comportamentos revelam"));
    rpc.mockImplementation(async (name: string) => (name === "habits_v2_enabled" ? { data: true, error: null } : { data: null, error: null }));
  });
});
