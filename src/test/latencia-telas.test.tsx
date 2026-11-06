import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { initialQueryInFlight } from "@/components/perf/ScreenPerfTracker";
import { prefetchMapa } from "@/lib/mapa/client";

let flagValue: boolean | Promise<boolean> = true;
const invoke = vi.fn(async (_fn: string, _opts: { body: { action: string } }) => ({ data: { ok: true, mapa: { indicators: [], questions_due: [], as_of: "2026-11-06" }, evidence: null }, error: null }));
const rpc = vi.fn(async (_name: string) => ({ data: await flagValue, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string) => rpc(n), functions: { invoke: (f: string, o: { body: { action: string } }) => invoke(f, o) } } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

const never = () => new Promise<never>(() => undefined);

describe("tela pronta: melhoria opcional não segura o relógio", () => {
  it("consulta inicial normal conta como carregando; a marcada nonBlocking, não", () => {
    const qc = new QueryClient();
    void qc.prefetchQuery({ queryKey: ["normal"], queryFn: never });
    expect(initialQueryInFlight(qc)).toBe(true);
    const qc2 = new QueryClient();
    void qc2.prefetchQuery({ queryKey: ["opcional"], queryFn: never, meta: { nonBlocking: true } });
    expect(initialQueryInFlight(qc2)).toBe(false);
  });
  it("com uma obrigatória e uma opcional em andamento, ainda está carregando", () => {
    const qc = new QueryClient();
    void qc.prefetchQuery({ queryKey: ["opcional"], queryFn: never, meta: { nonBlocking: true } });
    void qc.prefetchQuery({ queryKey: ["obrigatoria"], queryFn: never });
    expect(initialQueryInFlight(qc)).toBe(true);
  });
});

describe("Mapa: aquecimento", () => {
  it("flag ligada: busca a leitura antes da pessoa abrir a tela", async () => {
    flagValue = true; invoke.mockClear();
    await prefetchMapa(new QueryClient(), "u1");
    expect(invoke).toHaveBeenCalledWith("nino-insights", { body: { action: "map" } });
  });
  it("flag desligada: não gasta chamada ao servidor", async () => {
    flagValue = false; invoke.mockClear();
    await prefetchMapa(new QueryClient(), "u1");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("sem usuário ou com erro, nunca quebra", async () => {
    await expect(prefetchMapa(new QueryClient(), undefined)).resolves.toBeUndefined();
    rpc.mockRejectedValueOnce(new Error("rede"));
    await expect(prefetchMapa(new QueryClient(), "u1")).resolves.toBeUndefined();
  });
  it("a tela pede a leitura junto com a flag, sem esperar por ela (sem fila)", async () => {
    flagValue = never() as unknown as Promise<boolean>; // a flag nunca responde
    invoke.mockClear();
    const { render } = await import("@testing-library/react");
    const { MemoryRouter } = await import("react-router-dom");
    const { QueryClientProvider } = await import("@tanstack/react-query");
    vi.doMock("@/components/home/EmotionalCheckinCard", () => ({ EmotionalCheckinCard: () => null }));
    const { default: Emocoes } = await import("@/pages/Emocoes");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><Emocoes /></MemoryRouter></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 30));
    expect(rpc).toHaveBeenCalledWith("mapa_enabled");
    // a flag continua sem resposta e a leitura já foi pedida: não há fila
    expect(invoke).toHaveBeenCalledWith("nino-insights", { body: { action: "map" } });
  });
});
