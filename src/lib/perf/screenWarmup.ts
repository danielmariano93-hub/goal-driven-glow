// Aquecimento das telas que dependem de função no servidor (cerca de 1 s cada): o dado é pedido ANTES da pessoa abrir a tela,
// em segundo plano. Quando ela chega, o dado já está no cache e a tela aparece completa (o "Tela pronta" só espera consulta sem dado).
//
// Duas fontes de aquecimento:
//  - ociosa: logo depois do app abrir, para as telas mais usadas (Metas e Mapa);
//  - por intenção: ao tocar/passar o mouse num link do app, para as demais (ex.: Relatórios), ganhando o tempo do toque ao abrir.
// Custo: umas poucas chamadas a mais por abertura do app. Não roda com "economia de dados" nem em conexão 2G.
import type { QueryClient } from "@tanstack/react-query";
import { todayISO } from "@/lib/engine/facts";
import { goalsOverviewOptions } from "@/lib/nino/spendingGoals";
import { snapshotQueryOptions } from "@/lib/hooks/useFinancialSnapshot";
import { dashboardQueryOptions, defaultDashboardQuery } from "@/lib/reports/dashboard/client";
import { prefetchMapa } from "@/lib/mapa/client";

/** Dado mais novo que isso não é buscado de novo (evita chamada repetida a cada toque). */
export const WARM_FRESH_MS = 60_000;

export type WarmRoute = "metas" | "mapa" | "relatorios";

export function routeToWarm(pathname: string): WarmRoute | null {
  const p = String(pathname ?? "").split("?")[0]!.split("#")[0]!.replace(/\/+$/, "");
  if (p === "/app/metas") return "metas";
  if (p === "/app/mapa") return "mapa";
  if (p === "/app/relatorios") return "relatorios";
  return null;
}

/** Economia de dados ou conexão muito lenta: não gasta rede com aquecimento. */
export function warmupAllowed(conn: { saveData?: boolean; effectiveType?: string } | undefined | null): boolean {
  if (!conn) return true;
  if (conn.saveData) return false;
  return !["slow-2g", "2g"].includes(String(conn.effectiveType ?? ""));
}

export async function warmRoute(qc: QueryClient, userId: string | undefined, route: WarmRoute): Promise<void> {
  if (!userId) return;
  try {
    if (route === "metas") {
      const today = todayISO();
      await Promise.all([
        qc.prefetchQuery({ ...goalsOverviewOptions(userId), staleTime: WARM_FRESH_MS }),
        qc.prefetchQuery({ ...snapshotQueryOptions(userId, { start: `${today.slice(0, 7)}-01`, end: today }), staleTime: WARM_FRESH_MS }),
      ]);
    } else if (route === "mapa") {
      await prefetchMapa(qc, userId);
    } else if (route === "relatorios") {
      await qc.prefetchQuery({ ...dashboardQueryOptions(userId, defaultDashboardQuery(todayISO())), staleTime: WARM_FRESH_MS });
    }
  } catch { /* só aquecimento: erro nunca aparece */ }
}

/** Logo depois do app abrir: as telas mais usadas. */
export async function warmIdle(qc: QueryClient, userId: string | undefined, conn?: Parameters<typeof warmupAllowed>[0]): Promise<void> {
  if (!userId || !warmupAllowed(conn)) return;
  await Promise.all([warmRoute(qc, userId, "metas"), warmRoute(qc, userId, "mapa")]);
}

/** Ao tocar num link do app: aquece a tela de destino, se ela for uma das que dependem do servidor. */
export function warmOnIntent(qc: QueryClient, userId: string | undefined, href: string | null | undefined, conn?: Parameters<typeof warmupAllowed>[0]): void {
  if (!userId || !href || !warmupAllowed(conn)) return;
  let pathname = href;
  try { pathname = new URL(href, "https://app.local").pathname; } catch { /* usa como veio */ }
  const route = routeToWarm(pathname);
  if (route) void warmRoute(qc, userId, route);
}
