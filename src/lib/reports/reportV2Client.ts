import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/engine/facts";
import { REPORT_V2_VERSION, type CompareKind, type ReportV2 } from "@/lib/engine/reportV2";

// Relatórios: mês, comparação e aba vivem na URL (link compartilhável, voltar funciona). O cálculo vem do servidor.

export const REPORT_TABS_V2 = [
  { id: "geral", label: "Visão geral" },
  { id: "comportamento", label: "Comportamento" },
  { id: "projecoes", label: "Projeções" },
  { id: "evolucao", label: "Evolução" },
] as const;
export type ReportTabV2 = (typeof REPORT_TABS_V2)[number]["id"];
export const parseTabV2 = (v: string | null): ReportTabV2 => (REPORT_TABS_V2.some((t) => t.id === v) ? (v as ReportTabV2) : "geral");

export const COMPARE_CHOICES: Array<{ id: CompareKind; label: string }> = [
  { id: "previous", label: "Mês anterior" },
  { id: "year", label: "Mesmo mês do ano passado" },
  { id: "none", label: "Sem comparação" },
];

export function useReportV2Query() {
  const [params, setParams] = useSearchParams();
  const today = useMemo(() => todayISO(), []);
  const thisMonth = today.slice(0, 7);
  const m = params.get("m");
  const month = m && /^\d{4}-\d{2}$/.test(m) && m <= thisMonth ? m : thisMonth;
  const cmp = params.get("cmp");
  const compare: CompareKind = cmp === "year" || cmp === "none" ? cmp : "previous";
  const tab = parseTabV2(params.get("aba"));
  const update = useCallback((patch: { month?: string; compare?: CompareKind; tab?: ReportTabV2 }) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (patch.month !== undefined) { if (patch.month === thisMonth) next.delete("m"); else next.set("m", patch.month); }
      if (patch.compare !== undefined) { if (patch.compare === "previous") next.delete("cmp"); else next.set("cmp", patch.compare); }
      if (patch.tab !== undefined) { if (patch.tab === "geral") next.delete("aba"); else next.set("aba", patch.tab); }
      return next;
    }, { replace: true });
  }, [setParams, thisMonth]);
  return { month, compare, tab, today, thisMonth, update };
}

export const reportV2QueryOptions = (userId: string | undefined, month: string, compare: CompareKind) => ({
  queryKey: ["report-v2", userId, month, compare] as const,
  staleTime: 60_000,
  retry: 1,
  queryFn: async (): Promise<ReportV2> => {
    const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "report_v2", month, compare } });
    if (error) throw error;
    const report = (data as { report?: ReportV2 } | null)?.report;
    if (!report || report.version !== REPORT_V2_VERSION) throw new Error("Relatório em formato inesperado.");
    return report;
  },
});

export function useReportV2(month: string, compare: CompareKind) {
  const { user } = useAuth();
  return useQuery<ReportV2>({ ...reportV2QueryOptions(user?.id, month, compare), enabled: !!user, placeholderData: keepPreviousData });
}
