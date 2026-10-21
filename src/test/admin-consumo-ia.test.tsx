import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildArgs } from "@/lib/admin/rpcContracts";
import { workloadLabel, type AiConsumption } from "@/lib/admin/aiConsumption";

const consumption: AiConsumption = {
  days: 7,
  totals: { calls: 56, tokens_in: 49517, tokens_out: 24065, cost_usd: 0.0219, failures: 2 },
  daily: [{ day: "2026-10-19", calls: 18, tokens_in: 14243, tokens_out: 7604, cost_usd: 0.0067 }],
  by_workload: [
    { workload: "PROACTIVE", calls: 28, tokens: 39979, cost_usd: 0.0143, failures: 0, avg_ms: 1774 },
    { workload: "ADVISOR_REPORTS", calls: 9, tokens: 7295, cost_usd: 0.0017, failures: 2, avg_ms: 1152 },
  ],
  by_model: [{ model: "openai/gpt-oss-120b", calls: 56, tokens: 73582, cost_usd: 0.0219, failures: 2, avg_ms: 1366 }],
  failures: [{ workload: "ADVISOR_REPORTS", error_code: "http_500", n: 2, last_at: "2026-10-19T13:00:00Z" }],
};
vi.mock("@/lib/admin/adminRpc", async (orig) => ({ ...(await orig<object>()), callAdminRpc: vi.fn(async () => consumption) }));
vi.mock("@/components/admin/kit/SmoothChart", () => ({ SmoothChart: () => <div data-testid="chart" />, ChartLegend: () => null }));

import { AiPerformance } from "@/pages/admin/CentralDeComando";
import type { CommandCenterData } from "@/lib/admin/commandCenter";

const zeroChat = {
  window_days: 7, cost_note: "nota",
  daily: [{ day: "2026-10-19", turns: 8, errors: 0, users: 1, p50: 900, p95: 1500, tokens_in: 0, tokens_out: 0, cost_usd: 0 }],
  totals: { turns: 8, cost: 0, tin: 0, tout: 0, users: 1, err_rate: 0 },
  by_model: [], by_path: [], by_channel: [], top_errors: [],
} as unknown as CommandCenterData;

describe("consumo de IA no admin", () => {
  it("com conversas sem IA, o painel explica e mostra o consumo real de todas as funções", async () => {
    render(<QueryClientProvider client={new QueryClient()}><AiPerformance data={zeroChat} /></QueryClientProvider>);
    expect(screen.getByText(/Nenhuma conversa usou IA neste período/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("ai-consumption")).toBeTruthy());
    expect(screen.getByText(/56 chamadas/)).toBeTruthy();
    expect(screen.getByText("Avisos e mensagens do Nino")).toBeTruthy();
    expect(screen.getByText("Relatórios (semanal e mensal)")).toBeTruthy();
  });
  it("rótulos e contrato da RPC", () => {
    expect(workloadLabel("CATEGORY_BACKGROUND")).toBe("Categorização automática");
    expect(workloadLabel("NOVA_FUNCAO")).toBe("nova funcao");
    expect(buildArgs("admin_ai_consumption", { _days: 7, x: 1 })).toEqual({ _days: 7 });
  });
  it("a função do banco exige admin e lê o ledger de todas as funções", () => {
    const mig = readFileSync("supabase/migrations/20261021150000_admin_ai_consumption.sql", "utf8");
    expect(mig).toMatch(/is_current_user_admin\(\)/);
    expect(mig).toMatch(/from public\.ai_usage_ledger/);
    expect(mig).toMatch(/revoke all on function public\.admin_ai_consumption\(integer\) from public, anon/);
  });
});
