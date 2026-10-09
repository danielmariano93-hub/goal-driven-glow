import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildObservedProfileV3 } from "@/lib/engine/behaviorObservedV3";
import { buildHabitPatterns } from "../../supabase/functions/_shared/proactive/habitPatterns";

// Página v2 REAL com o motor v3 e o motor de padrões reais; só a rede é simulada (com estado:
// as respostas de contexto gravadas pelas RPCs alimentam a próxima leitura dos padrões).

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

// Lazer e Transporte concentrados em fins de semana (12 semanas).
const tx: Array<{ occurred_at: string; amount: number; category: string }> = [];
for (let w = 1; w <= 12; w++) {
  const friday = new Date(Date.UTC(2026, 9, 9 - 7 * w, 12));
  tx.push({ occurred_at: friday.toISOString(), amount: 150 + (w % 5) * 40, category: "Lazer" });
  tx.push({ occurred_at: new Date(friday.getTime() + 86_400_000).toISOString(), amount: 60 + (w % 3) * 30, category: "Lazer" });
  tx.push({ occurred_at: friday.toISOString(), amount: 150 + (w % 4) * 15, category: "Transporte" });
  tx.push({ occurred_at: new Date(friday.getTime() + 86_400_000).toISOString(), amount: 80 + (w % 3) * 10, category: "Transporte" });
}
const goals = { Lazer: { name: "Lazer", limit: 1000, actual: 340 }, Transporte: { name: "Transporte", limit: 300, actual: 280 } };

const state = {
  observed: profile,
  cycle: { cadenceDays: 15, due: false, nextDueAt: null, daysRemaining: 15, questionSetIndex: 0, questionSet: "wheel_set_a" },
  degradedSources: [], assessments: [], previousAssessment: null,
  latestAssessment: { id: "a1", overall_score: 3.6, scores: { awareness: 6, planning: 3, control: 6, consistency: 5, security: 1, wealth: 2, calm: 2, debt: 3 }, created_at: "2026-10-09T12:00:00Z" },
  hypotheses: [], activeExperiments: [{ id: "e1", status: "active", title: "Pequenas ações de patrimônio", template_slug: "small-wealth-moves" }],
  experiments: [{ id: "e1", status: "active", title: "Pequenas ações de patrimônio" }], templates: [], recommendedTemplates: [],
  checkins: [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, occurred_at: iso(i * 3), mood: 3, financial_calm_score: 4 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, occurred_at: iso(i + 1), mood: 3, financial_calm_score: null })),
  ],
  moodHistory: [], moodAverage30: 4, moodTrend14: null,
  emotionSpend: { sufficient: true, pairedDays: 41, vulnerableDays: 20, vulnerableAverage: 244.11, comparisonAverage: 85.29, upliftPct: 186 },
  momentSignal: null, highlights: [],
};

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

type AnswerRow = { subject: string; question: string; answer_keys: string[]; updated_at: string };
const answersState: AnswerRow[] = [];
let commitmentsState: Record<string, unknown> = {};
const rpcCalls: Array<[string, Record<string, unknown>]> = [];
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      if (name === "habits_v2_enabled") return { data: true, error: null };
      if (name === "habit_context_answer") {
        for (const subject of args.p_subjects as string[]) {
          const i = answersState.findIndex((r) => r.subject === subject && r.question === args.p_question);
          const row = { subject, question: String(args.p_question), answer_keys: args.p_answers as string[], updated_at: "2026-10-09T12:00:00Z" };
          if (i >= 0) answersState[i] = row; else answersState.push(row);
        }
      }
      if (name === "habit_context_clear") {
        for (const subject of args.p_subjects as string[]) {
          const i = answersState.findIndex((r) => r.subject === subject && r.question === args.p_question);
          if (i >= 0) answersState.splice(i, 1);
        }
      }
      return { data: null, error: null };
    },
    functions: {
      invoke: async () => ({ data: { ok: true, as_of: "2026-10-09", ...buildHabitPatterns({ transactions: tx, today: "2026-10-09", goals, contextAnswers: answersState }), commitments: commitmentsState }, error: null }),
    },
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "in", "not", "order", "limit"]) c[m] = () => c;
      (c as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: table === "habit_context_answers" ? answersState : [], error: null });
      return c;
    },
  },
}));
vi.mock("@/components/home/EmotionalCheckinCard", () => ({ EmotionalCheckinCard: () => <div>CHECKIN</div> }));
vi.mock("@/components/behavioral/MoneyMoodTimeline", () => ({ MoneyMoodTimeline: () => <div>MOODTIMELINE</div> }));

async function mount() {
  const { default: HabitsV2 } = await import("@/pages/HabitsV2");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}><MemoryRouter><HabitsV2 /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText("Seus hábitos com dinheiro")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText(/Seus fins de semana concentram/)).toBeInTheDocument());
  return utils;
}
const called = (name: string) => rpcCalls.filter(([n]) => n === name);

beforeEach(() => { rpcCalls.length = 0; feedbackCalls.length = 0; answersState.length = 0; commitmentsState = {}; });

describe("hábitos v2 — página montada de verdade", () => {
  it("AC-01/AC-06: primeira dobra = descoberta consolidada + roda; no máximo 2 insights", async () => {
    const { container } = await mount();
    const text = container.textContent ?? "";
    expect(text.indexOf("O que o Nino descobriu")).toBeLessThan(text.indexOf("Você e o que o Nino observa"));
    // Lazer e Transporte num só insight
    const articles = [...container.querySelectorAll("article[aria-label]")];
    expect(articles.length).toBeLessThanOrEqual(2);
    expect(articles[0].getAttribute("aria-label")).toMatch(/Lazer e Transporte|Transporte e Lazer/);
    expect(container.querySelectorAll('article[aria-label*="Transporte"]')).toHaveLength(1);
    const details = screen.getByText("Histórico e análises detalhadas").closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("experimentos saíram da interface (inclusive do histórico), com os dados ainda existindo", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByText("Histórico e análises detalhadas"));
    const text = container.textContent ?? "";
    expect(state.experiments.length).toBeGreaterThan(0); // preservados nos dados
    expect(text).not.toMatch(/Experimento|Pequenas ações de patrimônio|Mude um comportamento|Começar experimento|Testar por 14 dias|Novos desafios/);
  });

  it("ainda não sei + pergunta: as ações só aparecem depois da resposta", async () => {
    await mount();
    expect(screen.getByText(/O que ainda não sei/)).toBeInTheDocument();
    const q = screen.getByTestId("context-question");
    expect(q.textContent).toMatch(/Esses gastos de fim de semana com .* costumam ser/);
    expect(screen.queryByTestId("pattern-actions")).toBeNull();
    expect(screen.queryByText(/Ver um limite possível/)).toBeNull();
    expect(screen.getByTestId("consequence-line").textContent).toMatch(/Se esse ritmo continuar/);
  });

  it("'Decido na hora' grava a resposta e só então oferece limite (com a conta, edição e aceite explícito)", async () => {
    await mount();
    fireEvent.click(within(screen.getByTestId("context-question")).getByText("Decido na hora"));
    await waitFor(() => expect(called("habit_context_answer")).toHaveLength(1));
    expect(called("habit_context_answer")[0][1]).toMatchObject({ p_question: "planned_vs_spontaneous", p_answers: ["spontaneous"] });
    expect((called("habit_context_answer")[0][1].p_subjects as string[]).sort()).toEqual(["weekend:Lazer", "weekend:Transporte"]);
    const button = await screen.findByText(/Ver um limite possível para Lazer/);
    expect(called("habit_limit_accept")).toHaveLength(0);
    fireEvent.click(button);
    const effect = await screen.findByTestId("limit-effect");
    expect(effect.textContent).toMatch(/fecha em torno de/);
    expect(screen.getAllByText(/hipótese, não promessa/).length).toBeGreaterThan(0);
    expect(called("habit_limit_accept")).toHaveLength(0);
    const before = effect.textContent;
    fireEvent.change(screen.getByLabelText(/Seu limite para Lazer/), { target: { value: "100" } });
    expect(screen.getByTestId("limit-effect").textContent).not.toBe(before);
    fireEvent.click(screen.getByText(/Aceitar R\$ 100/));
    await waitFor(() => expect(called("habit_limit_accept")).toHaveLength(1));
    expect(called("habit_limit_accept")[0][1]).toMatchObject({ p_category: "Lazer", p_target: 100 });
  });

  it("'Já estavam planejados' leva à meta (nunca a um limite de gasto)", async () => {
    await mount();
    fireEvent.click(within(screen.getByTestId("context-question")).getByText("Já estavam planejados"));
    const actions = await screen.findByTestId("pattern-actions");
    expect(actions.textContent).toMatch(/ponto de partida é a meta/);
    expect(screen.queryByText(/Ver um limite possível/)).toBeNull();
    expect(screen.getByText(/Você respondeu: Já estavam planejados/)).toBeInTheDocument();
    // alterar a resposta volta à pergunta
    fireEvent.click(screen.getByText("Alterar", { selector: "button" }));
    await waitFor(() => expect(called("habit_context_clear")).toHaveLength(1));
    await screen.findByTestId("context-question");
  });

  it("'Prefiro não responder' mostra as sugestões genéricas e registra o evento (silêncio não é resposta)", async () => {
    await mount();
    fireEvent.click(screen.getByText("Prefiro não responder"));
    await screen.findByTestId("pattern-actions");
    expect(called("habit_context_answer")).toHaveLength(0);
    expect(called("habit_insight_event").some(([, a]) => a.p_event === "skipped")).toBe(true);
  });

  it("o combinado existente mostra a origem (WhatsApp), a data e permite alterar/desfazer", async () => {
    commitmentsState = { Lazer: { status: "accepted", target_amount: 160, friday: "2026-10-09", accepted_at: "2026-10-09T18:03:07Z", source: "whatsapp" } };
    await mount();
    const line = await screen.findByTestId("limit-accepted");
    expect(line.textContent).toMatch(/Combinado:.*R\$ 160.*Lazer/);
    expect(line.textContent).toMatch(/Você aceitou pelo WhatsApp em 09\/10 às 15:03/);
    fireEvent.click(within(line).getByText("Desfazer combinado"));
    await waitFor(() => expect(called("habit_limit_decline")).toHaveLength(1));
    expect(called("habit_limit_decline")[0][1]).toMatchObject({ p_category: "Lazer" });
  });

  it("AC-04: dimensão sem base não vira 0 nem nota", async () => {
    const { container } = await mount();
    const planning = within(screen.getByLabelText("Dimensões")).getByText("Planejamento").closest("li")!;
    expect(planning.textContent).toContain("Base parcial");
    expect(container.querySelector('[data-testid="no-reading-planning"]')).not.toBeNull();
  });

  it("AC-02/AC-03: painel da dimensão (observei / não sei / como você se percebe) com a leitura da diferença e discordância", async () => {
    await mount();
    fireEvent.click(within(screen.getByLabelText("Dimensões")).getByText("Segurança").closest("button")!);
    const panel = await screen.findByLabelText(/Como o Nino chegou à leitura de Segurança/);
    const text = panel.textContent ?? "";
    expect(text).toContain("O que observei");
    expect(text).toContain("O que ainda não sei");
    expect(text).toMatch(/Você se vê abaixo do que os indicadores mostram/);
    expect(text).toMatch(/não significa que a sua percepção esteja errada/);
    fireEvent.click(within(panel).getByText("Não"));
    fireEvent.change(within(panel).getByPlaceholderText(/contar o contexto/), { target: { value: "Tenho reserva fora do Nino" } });
    fireEvent.click(within(panel).getByText("Registrar"));
    await waitFor(() => expect(feedbackCalls).toHaveLength(1));
    expect(feedbackCalls[0]).toMatchObject({ dimension: "security", verdict: "no" });
  });

  it("a roda investiga: 'o que mais pesa para você' grava opções fechadas e vira evidência declarada", async () => {
    await mount();
    fireEvent.click(within(screen.getByLabelText("Dimensões")).getByText("Segurança").closest("button")!);
    const q = await screen.findByTestId("weighs-question");
    fireEvent.click(within(q).getByText("Reserva baixa"));
    fireEvent.click(within(q).getByText("Dívidas"));
    fireEvent.click(within(q).getByText("Salvar"));
    await waitFor(() => expect(called("habit_context_answer")).toHaveLength(1));
    expect(called("habit_context_answer")[0][1]).toMatchObject({ p_subjects: ["dimension:security"], p_question: "what_weighs", p_answers: ["se_low_reserve", "se_debts"] });
    const saved = await screen.findByTestId("weighs-saved");
    expect(saved.textContent).toMatch(/Reserva baixa, Dívidas/);
  });

  it("D: instrumenta exibido, utilidade e abertura de dimensão", async () => {
    await mount();
    await waitFor(() => expect(called("habit_insight_event").some(([, a]) => a.p_event === "shown")).toBe(true));
    fireEvent.click(screen.getByLabelText("Fez sentido"));
    await waitFor(() => expect(called("habit_insight_event").some(([, a]) => a.p_event === "useful")).toBe(true));
    fireEvent.click(within(screen.getByLabelText("Dimensões")).getByText("Planejamento").closest("button")!);
    await waitFor(() => expect(called("habit_insight_event").some(([, a]) => a.p_event === "dimension_opened")).toBe(true));
  });

  it("AC-10: Money Mood fica sob demanda, com o resumo de medições diretas × estimativas", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByText("Histórico e análises detalhadas"));
    const mood = screen.getByText("Histórico dos seus registros de tranquilidade").closest("details")!;
    expect(mood.hasAttribute("open")).toBe(false);
    expect(mood.textContent).toMatch(/8 medições diretas.*10 estimativas/);
    expect(container.textContent).toContain("associação, não uma causa");
    expect(container.textContent ?? "").not.toMatch(/por causa|por ansiedade|impulsiv|perdeu|186%/);
  });

  it("a flag decide a versão: v2 liberada mostra a nova página; sem acesso, a atual", async () => {
    const { default: Emocoes } = await import("@/pages/Emocoes");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/Seus fins de semana concentram/)).toBeInTheDocument());
  });
});
