import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const invoke = vi.fn(async (_fn: string, o: { body: { action: string } }) => {
  const a = o.body.action;
  if (a === "goals") return { data: { ok: true, goals: [], history: null, adjustments: [] }, error: null };
  if (a === "dashboard") return { data: { dashboard: { version: "report_dashboard.v1" } }, error: null };
  if (a === "map") return { data: { ok: true, mapa: { indicators: [], questions_due: [], as_of: "2026-11-06" }, evidence: null }, error: null };
  return { data: null, error: new Error("x") };
});
const rpc = vi.fn(async (name: string) => ({ data: name === "mapa_enabled" ? true : null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string) => rpc(n), functions: { invoke: (f: string, o: { body: { action: string } }) => invoke(f, o) } } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/db/snapshotContract", async (orig) => ({ ...(await orig<object>()), assertSnapshotContract: () => undefined }));

import { routeToWarm, warmIdle, warmOnIntent, warmRoute, warmupAllowed } from "@/lib/perf/screenWarmup";
import { goalsOverviewOptions } from "@/lib/nino/spendingGoals";
import { dashboardQueryOptions, defaultDashboardQuery } from "@/lib/reports/dashboard/client";
import { todayISO } from "@/lib/engine/facts";

const actions = () => invoke.mock.calls.map((c) => c[1].body.action);
beforeEach(() => { invoke.mockClear(); rpc.mockClear(); });

describe("aquecimento das telas", () => {
  it("reconhece só as telas que esperam por função no servidor", () => {
    expect(routeToWarm("/app/metas")).toBe("metas");
    expect(routeToWarm("/app/mapa/")).toBe("mapa");
    expect(routeToWarm("/app/relatorios?p=3m")).toBe("relatorios");
    expect(routeToWarm("/app/lancamentos")).toBeNull();
    expect(routeToWarm("/app/metas/categoria/123")).toBeNull();
  });
  it("economia de dados e 2G não gastam rede", () => {
    expect(warmupAllowed({ saveData: true })).toBe(false);
    expect(warmupAllowed({ effectiveType: "2g" })).toBe(false);
    expect(warmupAllowed({ effectiveType: "4g" })).toBe(true);
    expect(warmupAllowed(undefined)).toBe(true);
  });
  it("ociosa: aquece Metas (panorama) e Mapa, não Relatórios", async () => {
    const qc = new QueryClient();
    await warmIdle(qc, "u1");
    expect(actions()).toContain("goals");
    expect(actions()).toContain("map");
    expect(actions()).not.toContain("dashboard");
  });
  it("ociosa: com economia de dados não chama nada", async () => {
    await warmIdle(new QueryClient(), "u1", { saveData: true });
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("o dado aquecido cai na MESMA chave que a tela usa (senão não adianta)", async () => {
    const qc = new QueryClient();
    await warmRoute(qc, "u1", "metas");
    expect(qc.getQueryData(goalsOverviewOptions("u1").queryKey)).toBeDefined();
    await warmRoute(qc, "u1", "relatorios");
    expect(qc.getQueryData(dashboardQueryOptions("u1", defaultDashboardQuery(todayISO())).queryKey)).toBeDefined();
  });
  it("a consulta padrão de Relatórios é este mês contra o período anterior", () => {
    const q = defaultDashboardQuery("2026-11-06");
    expect(q).toMatchObject({ preset: "month", compare: "previous", categoryIds: [], merchant: "" });
    expect(q.end <= "2026-11-06").toBe(true);
  });
  it("não busca de novo o que acabou de ser aquecido (toques repetidos)", async () => {
    const qc = new QueryClient();
    await warmRoute(qc, "u1", "relatorios");
    invoke.mockClear();
    await warmRoute(qc, "u1", "relatorios");
    expect(actions()).not.toContain("dashboard");
  });
  it("por intenção: link de Relatórios aquece; link de outra tela, não; sem usuário, não", async () => {
    const qc = new QueryClient();
    warmOnIntent(qc, undefined, "/app/relatorios");
    warmOnIntent(qc, "u1", "/app/lancamentos");
    expect(invoke).not.toHaveBeenCalled();
    warmOnIntent(qc, "u1", "/app/relatorios");
    await vi.waitFor(() => expect(actions()).toContain("dashboard"));
  });
  it("erro de rede nunca estoura para a tela", async () => {
    invoke.mockRejectedValueOnce(new Error("rede"));
    await expect(warmRoute(new QueryClient(), "u1", "relatorios")).resolves.toBeUndefined();
  });
});
