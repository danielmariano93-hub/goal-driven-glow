import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn(async () => ({ data: 1, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => (rpc as any)(...a) } }));
let mockUser: { id: string } | null = { id: "u1" };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

import { ScreenPerfTracker } from "@/components/perf/ScreenPerfTracker";

let go: (to: string) => void = () => {};
function Nav() { const n = useNavigate(); go = (to) => n(to); return null; }

function mount(initial: string, qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[initial]}><Nav /><ScreenPerfTracker /><div id="page" /></MemoryRouter></QueryClientProvider>,
  );
}
const sent = () => (rpc.mock.calls as unknown as Array<[string, { p_events: any[] }]>).flatMap((c) => c[1].p_events);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  rpc.mockClear(); mockUser = { id: "u1" };
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("ScreenPerfTracker", () => {
  it("tela sem nada carregando fica pronta rápido e é enviada em lote com a rota normalizada", async () => {
    mount("/app/metas/categoria/b0655e4b-e41e-44ea-ae2f-c3d8596aefe5");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const ev = sent();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ route: "/app/metas/categoria/:id", nav_kind: "cold", timed_out: false });
    expect(ev[0].ready_ms).toBeLessThan(1000);
  });

  it("enquanto há spinner de tela, não está pronta; some o spinner, fecha a medição", async () => {
    const spin = document.createElement("div"); spin.className = "animate-spin"; document.body.appendChild(spin);
    mount("/app");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(sent()).toHaveLength(0);
    spin.remove();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].ready_ms).toBeGreaterThanOrEqual(2900);
  });

  it("spinner dentro de botão não conta como tela carregando", async () => {
    const btn = document.createElement("button"); const spin = document.createElement("span"); spin.className = "animate-spin"; btn.appendChild(spin); document.body.appendChild(btn);
    mount("/app");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sent()).toHaveLength(1);
  });

  it("navegação seguinte é 'soft'; telas fora do app e usuário deslogado não geram medição", async () => {
    mount("/app");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { go("/app/mais"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { go("/admin/cockpit"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    const ev = sent();
    expect(ev.map((e) => [e.route, e.nav_kind])).toEqual([["/app", "cold"], ["/app/mais", "soft"]]);
    rpc.mockClear(); mockUser = null; document.body.innerHTML = "";
    mount("/app/metas");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tela que nunca termina vira 'timed_out' com o teto de 20 s", async () => {
    const spin = document.createElement("div"); spin.className = "animate-spin"; document.body.appendChild(spin);
    mount("/app/metas");
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(sent()[0]).toMatchObject({ timed_out: true, ready_ms: 20_000 });
  });
});
