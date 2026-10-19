import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildArgs } from "@/lib/admin/rpcContracts";
import { perfTone, screenLabel, trendPct, type ScreenPerfReport } from "@/lib/admin/screenPerf";

const report: ScreenPerfReport = {
  days: 7,
  overall: { n: 120, p50: 900, p75: 1900, p95: 5200, fast_pct: 78.5, timed_out: 2, users: 4 },
  soft: { n: 100, p75: 1700 },
  cold: { n: 20, p75: 3300, ttfb_p75: 300, fcp_p75: 1100, lcp_p75: 2600 },
  screens: [
    { route: "/app/metas", n: 40, p50: 1200, p75: 4400, p95: 7000, fast_pct: 55, timed_out: 1 },
    { route: "/app/mais", n: 30, p50: 400, p75: 900, p95: 1500, fast_pct: 96.7, timed_out: 0 },
    { route: "/app/metas/categoria/:id", n: 5, p50: 900, p75: 1300, p95: 2000, fast_pct: 80, timed_out: 0 },
  ],
  daily: [{ day: "2026-10-17", n: 30, p50: 800, p75: 1500 }, { day: "2026-10-18", n: 40, p50: 900, p75: 1600 }, { day: "2026-10-19", n: 50, p50: 1000, p75: 2400 }],
  devices: [{ device: "ios", standalone: true, n: 80, p75: 1500 }, { device: "android", standalone: false, n: 20, p75: 3000 }],
  builds: [{ build: "e2a19d7", n: 120, p75: 1900, last_seen: "2026-10-19T12:00:00Z" }],
};
let current: ScreenPerfReport = report;
vi.mock("@/lib/admin/adminRpc", async (orig) => ({ ...(await orig<object>()), callAdminRpc: vi.fn(async () => current) }));
vi.mock("@/components/admin/kit/SmoothChart", () => ({ SmoothChart: () => <div data-testid="chart" />, ChartLegend: () => null }));

import { ScreenPerformanceBoard } from "@/components/admin/ScreenPerformanceBoard";
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

describe("indicador Tela pronta no admin", () => {
  it("faixas: até 2 s boa, até 4 s atenção, acima lenta", () => {
    expect(perfTone(1999)).toBe("bom"); expect(perfTone(2000)).toBe("bom"); expect(perfTone(3500)).toBe("atencao");
    expect(perfTone(4001)).toBe("ruim"); expect(perfTone(null)).toBe("sem_dados");
  });
  it("nomes de tela amigáveis e tendência do último dia contra os anteriores", () => {
    expect(screenLabel("/app/metas")).toBe("Metas");
    expect(screenLabel("/app/mais/:id")).toMatch(/ \(detalhe\)$/);
    expect(screenLabel("/app/rota-nova")).toBe("/app/rota-nova");
    expect(Math.round(trendPct(report.daily)!)).toBe(55); // 2400 contra média 1550
    expect(trendPct(report.daily.slice(0, 2))).toBeNull();
  });
  it("a RPC admin aceita só _days", () => {
    expect(buildArgs("admin_perf_screens", { _days: 7, _tz: "x" })).toEqual({ _days: 7 });
  });
  it("mostra o indicador, as telas mais lentas primeiro e o corte por aparelho/versão", async () => {
    current = report;
    render(wrap(<ScreenPerformanceBoard days={7} />));
    await waitFor(() => expect(screen.getByText("Velocidade das telas")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Tela pronta (p75)")).toBeTruthy());
    expect(screen.getByText("1,7 s")).toBeTruthy();           // p75 das telas dentro do app
    expect(screen.getByText("78,5%")).toBeTruthy();           // aberturas rápidas
    const items = screen.getAllByText(/aberturas · mediana/).map((n) => n.closest("li")!.textContent ?? "");
    expect(items[0]).toContain("Metas");                      // mais lenta primeiro
    expect(screen.getByText(/iPhone\/iPad · app instalado/)).toBeTruthy();
    expect(screen.getByText("e2a19d7")).toBeTruthy();
    expect(screen.getByTestId("chart")).toBeTruthy();
  });
  it("sem medições: explica em vez de mostrar zeros", async () => {
    current = { ...report, overall: { ...report.overall, n: 0, users: 0 }, screens: [], daily: [], devices: [], builds: [] };
    render(wrap(<ScreenPerformanceBoard days={7} />));
    await waitFor(() => expect(screen.getByText(/Ainda sem medições/)).toBeTruthy());
  });
  it("o painel está no Cockpit e em Nino IA → Desempenho; a RPC é só para admin e a tabela não tem leitura direta", () => {
    expect(readFileSync("src/pages/admin/CustoLatencia.tsx", "utf8")).toContain("<ScreenPerformanceBoard");
    expect(readFileSync("src/pages/admin/Cockpit.tsx", "utf8")).toContain("<ScreenSpeedStrip />");
    const sql = readFileSync("supabase/migrations/20261019130000_client_perf_telas.sql", "utf8");
    expect(sql).toContain("is_current_user_admin()");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.client_perf_events from anon, authenticated");
  });
});
