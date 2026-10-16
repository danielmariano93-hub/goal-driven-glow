import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Qual experiência a aba mostra: Mapa Financeiro (mapa_access) > hábitos v2 (habits_v2_access) > atual. Falha de flag = anterior.
let flags: Record<string, boolean | "error"> = {};
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => (flags[name] === "error" ? { data: null, error: { message: "x" } } : { data: flags[name] === true, error: null }),
    functions: { invoke: async () => ({ data: null, error: new Error("offline") }) },
    from: () => { const c: any = new Proxy({}, { get: (_t, p: string) => (p === "then" ? (r: any) => r({ data: [], error: null }) : () => c) }); return c; },
  },
}));
vi.mock("@/pages/HabitsV2", () => ({ default: () => <div>MARKER-HABITSV2</div> }));
vi.mock("@/components/home/EmotionalCheckinCard", () => ({ EmotionalCheckinCard: () => <div>MARKER-CHECKIN</div> }));
vi.mock("@/components/habits/FinancialWellBeingCard", () => ({ FinancialWellBeingCard: () => <div>MARKER-CFPB</div> }));
vi.mock("@/lib/behavioral/dashboardSnapshot", () => ({ loadBehavioralDashboardSnapshot: () => new Promise(() => undefined) }));
vi.mock("@/lib/behavioral/resilientClient", () => ({ loadBehavioralEvolutionResilient: () => new Promise(() => undefined) }));

async function mount() {
  const { default: Emocoes } = await import("@/pages/Emocoes");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>);
}

describe("aba Mapa Financeiro: qual experiência aparece", () => {
  beforeEach(() => { flags = {}; });

  it("mapa liberado: página do Mapa (sem a roda de notas), com bem-estar e check-in", async () => {
    flags = { mapa_enabled: true, habits_v2_enabled: true };
    await mount();
    expect(await screen.findByText("Sua situação, seus hábitos e seu bem-estar")).toBeInTheDocument();
    expect(screen.getByText("MARKER-CHECKIN")).toBeInTheDocument();
    expect(screen.queryByText("MARKER-HABITSV2")).not.toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("checkin")).not.toBeNull());
  });

  it("só hábitos v2 liberado: continua na página de hábitos v2", async () => {
    flags = { mapa_enabled: false, habits_v2_enabled: true };
    await mount();
    expect(await screen.findByText("MARKER-HABITSV2")).toBeInTheDocument();
  });

  it("falha ao ler a flag do Mapa: cai na experiência anterior, nunca em tela vazia", async () => {
    flags = { mapa_enabled: "error", habits_v2_enabled: true };
    await mount();
    expect(await screen.findByText("MARKER-HABITSV2")).toBeInTheDocument();
    expect(screen.queryByText("Sua situação, seus hábitos e seu bem-estar")).not.toBeInTheDocument();
  });

  it("sem nenhuma flag: nem o Mapa nem hábitos v2", async () => {
    flags = { mapa_enabled: false, habits_v2_enabled: false };
    await mount();
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText("Sua situação, seus hábitos e seu bem-estar")).not.toBeInTheDocument();
    expect(screen.queryByText("MARKER-HABITSV2")).not.toBeInTheDocument();
  });
});
