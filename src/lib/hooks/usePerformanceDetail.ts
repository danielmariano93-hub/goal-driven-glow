import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { today as localToday } from "@/lib/engine/ninoClock";
import type { ComparisonMode } from "@/lib/engine/financialComparison";
import { buildPerformanceSnapshot } from "@/lib/nino/performanceSnapshots";
import { fetchDerivedPerformance, useLedgerVersion } from "@/lib/db/derivedViews";
import { qk } from "@/lib/db/queryKeys";

/**
 * Detalhe completo do acompanhamento para telas analíticas (relatórios):
 * highlights com decomposição, drivers e comparações do motor canônico —
 * calculados no servidor e apenas rankeados aqui. Sem histórico no cliente.
 */
export function usePerformanceDetail(options?: { mode?: ComparisonMode }) {
  const { user } = useAuth();
  const mode: ComparisonMode = options?.mode ?? "MTD_EQUIVALENT";
  const asOf = localToday(user as { timezone?: string | null } | null);
  const ledgerVersion = useLedgerVersion();

  const query = useQuery({
    queryKey: [...qk.performanceDetail, user?.id, mode, asOf, ledgerVersion.data ?? 0],
    // Espera a versão do ledger: sem isso a tela dispara uma leitura com
    // versão 0 e outra logo depois, dobrando requisição a cada abertura.
    enabled: !!user?.id && !ledgerVersion.isLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const derived = await fetchDerivedPerformance({ asOf, mode });
      return buildPerformanceSnapshot({
        precomputed: derived.result,
        performance: { as_of: asOf, mode },
        maxItems: 6,
      });
    },
  });

  return { data: query.data ?? null, loading: query.isLoading };
}
