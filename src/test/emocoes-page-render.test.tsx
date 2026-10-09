import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BEHAVIOR_DIMENSIONS } from "@/lib/engine/behaviorDimensions";

// Monta a página REAL de hábitos (Emocoes) com dados parecidos com os de produção e
// confere o que a pessoa vê: a ordem dos blocos e a ausência de erro de renderização.

const scoresObserved: Record<string, [number, "low" | "medium" | "high"]> = {
  awareness: [10, "low"], planning: [8, "medium"], control: [6.7, "medium"], consistency: [9.1, "medium"],
  security: [3.9, "medium"], wealth: [3, "low"], calm: [3.9, "low"], debt: [3.3, "high"],
};
const perception: Record<string, number> = { awareness: 6, planning: 3, control: 4, consistency: 5, security: 3, wealth: 3, calm: 4, debt: 2 };

const observed = {
  overallScore: 5.6, coverage: 8, asOf: "2026-10-09", methodologyVersion: "behavior_observed.v2", overallConfidence: "medium", historyDays: 90,
  dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, {
    score: scoresObserved[d.key][0], confidence: scoresObserved[d.key][1], evidence: `Evidência de ${d.label}.`, source: "test",
    factors: [{ key: "f1", label: "Componente 1", value: scoresObserved[d.key][0], weight: 1 }],
  }])),
};

const state = {
  observed,
  cycle: { cadenceDays: 15, due: false, nextDueAt: null, daysRemaining: 15, questionSetIndex: 0, questionSet: "wheel_set_a" },
  degradedSources: [],
  assessments: [], previousAssessment: null,
  latestAssessment: { id: "a1", overall_score: 3.6, scores: perception, created_at: "2026-10-09T12:00:00Z" },
  hypotheses: [], activeExperiments: [], templates: [], moodHistory: [], moodAverage30: 4.4, moodTrend14: -1.2,
  emotionSpend: { sufficient: true, pairedDays: 41, vulnerableDays: 20, vulnerableAverage: 244.11, comparisonAverage: 85.29, upliftPct: 186 },
  momentSignal: null, highlights: [],
};

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/behavioral/dashboardSnapshot", () => ({ loadBehavioralDashboardSnapshot: async () => state }));
vi.mock("@/lib/behavioral/resilientClient", () => ({ loadBehavioralEvolutionResilient: async () => state }));
vi.mock("@/lib/behavioral/observedSnapshots", () => ({ useObservedSnapshots: () => ({ data: [] }), useSaveObservedSnapshot: () => undefined }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "not", "order", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/components/home/EmotionalCheckinCard", () => ({ EmotionalCheckinCard: () => <div>CHECKIN</div> }));
vi.mock("@/components/behavioral/ExperimentsBoard", () => ({ ExperimentsBoard: () => <div>EXPERIMENTS</div> }));
vi.mock("@/components/behavioral/MoneyMoodTimeline", () => ({ MoneyMoodTimeline: () => <div>MOODTIMELINE</div> }));
vi.mock("@/components/behavioral/BehaviorWheel", () => ({ BehaviorWheel: () => <div>WHEEL</div> }));
vi.mock("@/components/emotions/BehavioralInsightsCard", () => ({ BehavioralInsightsCard: () => <div>INSIGHTS</div> }));

describe("página de hábitos (Emocoes) montada de verdade", () => {
  it("mostra a descoberta no topo, depois a roda e a mudança possível — sem o veredito grande", async () => {
    const { default: Emocoes } = await import("@/pages/Emocoes");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    const { container } = render(
      <QueryClientProvider client={client}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Seus hábitos com dinheiro")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Uma descoberta sobre você")).toBeInTheDocument());
    const text = container.textContent ?? "";
    const order = ["Uma descoberta sobre você", "WHEEL", "Uma mudança possível", "O que mudou e por quê", "INSIGHTS", "Impacto no dinheiro", "CHECKIN", "MOODTIMELINE", "Ver a evolução semana a semana"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Como você se vê");
    expect(text).toContain("Isso não representa minha realidade");
    expect(text).toContain("Um sinal para investigar");
    expect(text).not.toContain("no total");
    expect(errors.filter((e) => String(e).includes("Error")), String(errors.slice(0, 3))).toHaveLength(0);
    spy.mockRestore();
  });
});
