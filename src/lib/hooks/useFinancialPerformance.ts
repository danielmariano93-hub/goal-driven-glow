import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useAllTransactions, useCategories } from "@/lib/db/finance";
import { qk } from "@/lib/db/queryKeys";
import { today as localToday } from "@/lib/engine/ninoClock";
import type { ComparisonMode } from "@/lib/engine/financialComparison";
import type { TransactionRow } from "@/lib/engine/facts";
import {
  loadOrComputePerformanceSnapshot,
  loadTopicAffinity,
  type PerformanceSnapshot,
} from "@/lib/nino/performanceSnapshots";

/**
 * Fonte única do acompanhamento (`advisor_core.v1`) para as superfícies do app.
 * A UI não calcula nada: recebe o snapshot já rankeado pelo Advisor.
 */
export function useFinancialPerformance(options?: { mode?: ComparisonMode; enabled?: boolean }) {
  const { user } = useAuth();
  const mode: ComparisonMode = options?.mode ?? "MTD_EQUIVALENT";
  const txsQuery = useAllTransactions();
  const categoriesQuery = useCategories();
  const asOf = localToday(user as { timezone?: string | null } | null);

  const ready = !!user?.id && !!txsQuery.data && !!categoriesQuery.data;

  return useQuery<PerformanceSnapshot | null>({
    queryKey: [...qk.advisorPerformance, user?.id, mode, asOf],
    enabled: ready && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return null;
      const categoryNames = new Map<string, string>(
        (categoriesQuery.data ?? []).map((c) => [c.id as string, c.name as string]),
      );
      const affinity = await loadTopicAffinity(user.id).catch(() => []);
      return await loadOrComputePerformanceSnapshot({
        userId: user.id,
        affinity,
        performance: {
          txs: (txsQuery.data ?? []) as unknown as TransactionRow[],
          categoryNames,
          as_of: asOf,
          mode,
        },
      });
    },
  });
}
