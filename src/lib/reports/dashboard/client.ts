import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/engine/facts";
import type { CompareMode, ReportDashboard } from "@/lib/engine/reportDashboard";

// Painel de Relatórios: o período, a comparação e os filtros vivem na URL
// (link compartilhável, botão voltar funciona). O cálculo vem do servidor.

export type PeriodPreset = "7d" | "30d" | "month" | "prev_month" | "3m" | "6m" | "12m" | "custom";

export const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Este mês" },
  { id: "prev_month", label: "Mês passado" },
  { id: "3m", label: "3 meses" },
  { id: "6m", label: "6 meses" },
  { id: "12m", label: "12 meses" },
  { id: "custom", label: "Personalizado" },
];

export const COMPARE_OPTIONS: Array<{ id: CompareMode; label: string }> = [
  { id: "previous", label: "Período anterior" },
  { id: "year", label: "Mesmo período do ano passado" },
  { id: "none", label: "Sem comparação" },
];

export type DashboardQuery = {
  preset: PeriodPreset;
  start: string;
  end: string;
  compare: CompareMode;
  categoryIds: string[];
  merchant: string;
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shiftMonthStart(iso: string, delta: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + delta, 1, 12));
  return d.toISOString().slice(0, 10);
}

const endOfMonth = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);

/** Intervalo de cada atalho. Períodos em andamento terminam hoje. */
export function presetRange(preset: Exclude<PeriodPreset, "custom">, today: string): { start: string; end: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "7d": return { start: addDays(today, -6), end: today };
    case "30d": return { start: addDays(today, -29), end: today };
    case "month": return { start: monthStart, end: today };
    case "prev_month": { const s = shiftMonthStart(monthStart, -1); return { start: s, end: endOfMonth(s) }; }
    case "3m": return { start: shiftMonthStart(monthStart, -2), end: today };
    case "6m": return { start: shiftMonthStart(monthStart, -5), end: today };
    case "12m": return { start: shiftMonthStart(monthStart, -11), end: today };
  }
}

const isPreset = (v: string | null): v is PeriodPreset => PERIOD_PRESETS.some((p) => p.id === v);
const isCompare = (v: string | null): v is CompareMode => COMPARE_OPTIONS.some((c) => c.id === v);
const isDate = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Estado do painel na URL: padrão = este mês até hoje vs. os mesmos dias do mês passado. */
export function useDashboardQuery() {
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => todayISO(), []);

  const query = useMemo<DashboardQuery>(() => {
    const presetParam = params.get("p");
    const preset: PeriodPreset = isPreset(presetParam) ? presetParam : "month";
    let range = preset === "custom" ? null : presetRange(preset, today);
    if (!range) {
      const s = params.get("s");
      const e = params.get("e");
      range = isDate(s) && isDate(e) && s <= e ? { start: s, end: e > today ? today : e } : presetRange("month", today);
    }
    const cmp = params.get("cmp");
    return {
      preset: preset === "custom" && !isDate(params.get("s")) ? "month" : preset,
      start: range.start,
      end: range.end,
      compare: isCompare(cmp) ? cmp : "previous",
      categoryIds: (params.get("cat") ?? "").split(",").filter(Boolean).slice(0, 30),
      merchant: (params.get("q") ?? "").slice(0, 60),
    };
  }, [params, today]);

  const update = useCallback((patch: Partial<DashboardQuery>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      const merged = { ...query, ...patch };
      if (merged.preset === "month") next.delete("p"); else next.set("p", merged.preset);
      if (merged.preset === "custom") { next.set("s", merged.start); next.set("e", merged.end); } else { next.delete("s"); next.delete("e"); }
      if (merged.compare === "previous") next.delete("cmp"); else next.set("cmp", merged.compare);
      if (merged.categoryIds.length) next.set("cat", merged.categoryIds.join(",")); else next.delete("cat");
      if (merged.merchant) next.set("q", merged.merchant); else next.delete("q");
      return next;
    }, { replace: true });
  }, [query, setParams]);

  return { query, update, today };
}

export function useReportDashboard(query: DashboardQuery) {
  const { user } = useAuth();
  return useQuery<ReportDashboard>({
    queryKey: ["report-dashboard", user?.id, query.start, query.end, query.compare, query.categoryIds.join(","), query.merchant],
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
    // Trocar de período mantém o painel anterior na tela até o novo chegar.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", {
        body: {
          action: "dashboard", start: query.start, end: query.end, compare: query.compare,
          category_ids: query.categoryIds, merchant: query.merchant,
        },
      });
      if (error) throw error;
      const dashboard = (data as { dashboard?: ReportDashboard } | null)?.dashboard;
      if (!dashboard || dashboard.version !== "report_dashboard.v1") throw new Error("Painel em formato inesperado.");
      return dashboard;
    },
  });
}
