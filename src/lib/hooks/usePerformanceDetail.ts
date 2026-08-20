import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAllTransactions, useCategories } from "@/lib/db/finance";
import { today as localToday } from "@/lib/engine/ninoClock";
import type { ComparisonMode } from "@/lib/engine/financialComparison";
import type { TransactionRow } from "@/lib/engine/facts";
import { buildPerformanceSnapshot } from "@/lib/nino/performanceSnapshots";

/**
 * Detalhe completo do acompanhamento para telas analíticas (relatórios):
 * highlights com decomposição, drivers e comparações do motor canônico.
 * Cálculo em memória, sem persistência — a Home usa o snapshot gravado.
 */
export function usePerformanceDetail(options?: { mode?: ComparisonMode }) {
  const { user } = useAuth();
  const mode: ComparisonMode = options?.mode ?? "MTD_EQUIVALENT";
  const txsQuery = useAllTransactions();
  const categoriesQuery = useCategories();
  const asOf = localToday(user as { timezone?: string | null } | null);

  const loading = txsQuery.isLoading || categoriesQuery.isLoading;

  const data = useMemo(() => {
    if (!txsQuery.data || !categoriesQuery.data) return null;
    const categoryNames = new Map<string, string>(
      categoriesQuery.data.map((c) => [c.id as string, c.name as string]),
    );
    return buildPerformanceSnapshot({
      performance: {
        txs: txsQuery.data as unknown as TransactionRow[],
        categoryNames,
        as_of: asOf,
        mode,
      },
      maxItems: 6,
    });
  }, [txsQuery.data, categoriesQuery.data, asOf, mode]);

  return { data, loading };
}
