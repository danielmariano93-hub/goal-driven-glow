import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { qk } from "@/lib/db/queryKeys";
import { today as localToday } from "@/lib/engine/ninoClock";
import type { ComparisonMode } from "@/lib/engine/financialComparison";
import { fetchDerivedPerformance, useLedgerVersion } from "@/lib/db/derivedViews";
import {
  loadOrComputePerformanceSnapshot,
  readPerformanceSnapshot,
  loadTopicAffinity,
  type PerformanceSnapshot,
} from "@/lib/nino/performanceSnapshots";

/**
 * Fonte única do acompanhamento (`advisor_core.v1`) para as superfícies do app.
 * A UI não calcula nada e o dispositivo não baixa o ledger: o motor canônico
 * roda no servidor (`finance-derived`) e o cliente só aplica o ranking do
 * Advisor sobre o resultado compacto.
 */
export function useFinancialPerformance(options?: { mode?: ComparisonMode; enabled?: boolean }) {
  const { user } = useAuth();
  const mode: ComparisonMode = options?.mode ?? "MTD_EQUIVALENT";
  const asOf = localToday(user as { timezone?: string | null } | null);
  const ledgerVersion = useLedgerVersion();

  return useQuery<PerformanceSnapshot | null>({
    queryKey: [...qk.advisorPerformance, user?.id, mode, asOf, ledgerVersion.data ?? 0],
    // Espera a versão do ledger: sem isso a tela dispara uma leitura com
    // versão 0 e outra logo depois, dobrando requisição a cada abertura.
    enabled: !!user?.id && options?.enabled !== false && !ledgerVersion.isLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return null;
      const cached = await readPerformanceSnapshot(user.id, asOf, mode).catch(() => null);
      if (cached) return cached;
      const derived = await fetchDerivedPerformance({ asOf, mode });
      const affinity = await loadTopicAffinity(user.id).catch(() => []);
      return await loadOrComputePerformanceSnapshot({
        userId: user.id,
        affinity,
        precomputed: derived.result,
        performance: { as_of: asOf, mode },
      });
    },
  });
}
