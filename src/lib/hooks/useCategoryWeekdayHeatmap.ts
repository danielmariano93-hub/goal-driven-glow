// Leitura da janela comportamental de 90 dias para o mapa semanal.
// Uma única leitura paginada (`paged_select.v1`) + agregação em memória:
// nunca 35 queries, nunca truncamento silencioso em 1.000 linhas.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useAllCategories } from "@/lib/db/finance";
import { fetchAllPages } from "@/lib/db/pagedSelect";
import { TRANSACTION_FACT_SELECT } from "@/lib/engine/canonicalFacts";
import {
  computeCategoryWeekdayHeatmap,
  type CategoryWeekdayHeatmap,
  type HeatmapTransactionRow,
} from "@/lib/engine/categoryWeekdayHeatmap";

export const HEATMAP_TIMEZONE = "America/Sao_Paulo";
export const HEATMAP_WINDOW_DAYS = 90;
/** Folga de leitura: estorno e `behavioral_day` deslocado precisam da vizinhança. */
const READ_MARGIN_DAYS = 10;

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HEATMAP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shift(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}

export function heatmapWindow(windowDays = HEATMAP_WINDOW_DAYS) {
  const end = todayInSaoPaulo();
  return { start: shift(end, -(windowDays - 1)), end };
}

export function useCategoryWeekdayHeatmap(
  options: { windowDays?: number; topCategories?: number } = {},
): { data: CategoryWeekdayHeatmap | null; isLoading: boolean; error: unknown } {
  const { user } = useAuth();
  const windowDays = options.windowDays ?? HEATMAP_WINDOW_DAYS;
  const range = useMemo(() => heatmapWindow(windowDays), [windowDays]);
  const categoriesQuery = useAllCategories();

  const txQuery = useQuery({
    queryKey: ["category-weekday-heatmap", user?.id, range.start, range.end],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    queryFn: async () =>
      (await fetchAllPages<HeatmapTransactionRow>(
        (from, to) =>
          supabase
            .from("transactions")
            .select(TRANSACTION_FACT_SELECT)
            .gte("occurred_at", shift(range.start, -READ_MARGIN_DAYS))
            .lte("occurred_at", shift(range.end, READ_MARGIN_DAYS))
            .order("occurred_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as never,
        { source: "category_weekday_heatmap" },
      )).map((row) => ({ ...row, amount: Number(row.amount ?? 0) })),
  });

  const data = useMemo(() => {
    if (!txQuery.data) return null;
    return computeCategoryWeekdayHeatmap({
      transactions: txQuery.data,
      categories: categoriesQuery.data ?? [],
      range,
      timezone: HEATMAP_TIMEZONE,
      topCategories: options.topCategories ?? 5,
    });
  }, [txQuery.data, categoriesQuery.data, range, options.topCategories]);

  return {
    data,
    isLoading: txQuery.isLoading || categoriesQuery.isLoading,
    error: txQuery.error ?? categoriesQuery.error ?? null,
  };
}
