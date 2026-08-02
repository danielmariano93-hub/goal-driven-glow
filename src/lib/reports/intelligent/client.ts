/* eslint-disable @typescript-eslint/no-explicit-any */
// Acesso aos Relatórios Inteligentes. Somente leitura pela Data API (RLS já
// restringe ao dono) + geração on-demand pela Edge Function.
import { supabase } from "@/integrations/supabase/client";
import type { ReportPayload, ReportType } from "@/lib/reports/intelligent/types";

export interface ReportListItem {
  id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  status: string;
  health_score: number | null;
  executive_summary: string | null;
  data_quality_status: "ok" | "attention" | "insufficient";
  generated_at: string;
  viewed_at: string | null;
}

export interface ReportMetricRow {
  metric_key: string;
  metric_label: string;
  metric_value: number | null;
  metric_text: string | null;
  comparison_value: number | null;
  comparison_percentage: number | null;
  unit: string;
  sort_order: number;
}

export interface ReportHighlightRow {
  id: string;
  detector_key: string;
  type: string;
  title: string;
  body: string;
  confidence: string;
  category: string | null;
  cta_label: string | null;
  cta_route: string | null;
  evidence?: Record<string, unknown> | null;
  sort_order: number;

}

export interface ReportDetail extends ReportListItem {
  timezone: string;
  closing_text: string | null;
  text_source: "ai" | "deterministic";
  health_breakdown: Array<{ key: string; label: string; score: number; max: number; detail: string }>;
  data_quality_flags: Array<{ key: string; label: string; severity: string; detail: string }>;
  payload: ReportPayload;
  metrics: ReportMetricRow[];
  highlights: ReportHighlightRow[];
}

const LIST_COLUMNS =
  "id,report_type,period_start,period_end,status,health_score,executive_summary,data_quality_status,generated_at,viewed_at";

export async function listReports(): Promise<ReportListItem[]> {
  const { data, error } = await (supabase as any)
    .from("financial_reports")
    .select(LIST_COLUMNS)
    .order("period_start", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as unknown as ReportListItem[];
}

export async function getReport(id: string): Promise<ReportDetail | null> {
  const [reportRes, metricsRes, highlightsRes] = await Promise.all([
    (supabase as any)
      .from("financial_reports")
      .select(`${LIST_COLUMNS},timezone,closing_text,text_source,health_breakdown,data_quality_flags,payload`)
      .eq("id", id)
      .maybeSingle(),
    (supabase as any)
      .from("financial_report_metrics")
      .select("metric_key,metric_label,metric_value,metric_text,comparison_value,comparison_percentage,unit,sort_order")
      .eq("report_id", id)
      .order("sort_order", { ascending: true }),
    (supabase as any)
      .from("financial_report_highlights")
      .select("id,detector_key,type,title,body,confidence,category,cta_label,cta_route,evidence,sort_order")
      .eq("report_id", id)
      .order("sort_order", { ascending: true }),
  ]);
  if (reportRes.error) throw reportRes.error;
  if (!reportRes.data) return null;
  return {
    ...(reportRes.data as unknown as ReportDetail),
    metrics: (metricsRes.data ?? []) as unknown as ReportMetricRow[],
    highlights: (highlightsRes.data ?? []) as unknown as ReportHighlightRow[],
  };
}

export async function markReportViewed(id: string): Promise<void> {
  await supabase.rpc("mark_financial_report_viewed" as never, { p_report_id: id } as never);
}

export async function generateReportNow(reportType: ReportType): Promise<{ report_id?: string | null }> {
  const { data, error } = await supabase.functions.invoke("financial-reports-generate", {
    body: { report_type: reportType, force: true },
  });
  if (error) throw error;
  return (data ?? {}) as { report_id?: string | null };
}

/** Exclusão definitiva via RPC transacional (remove métricas, destaques e envios). */
export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_financial_report" as never, { p_report_id: id } as never);
  if (error) throw error;
}

export function periodLabel(item: Pick<ReportListItem, "report_type" | "period_start" | "period_end">): string {
  const short = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  if (item.report_type === "weekly") return `${short(item.period_start)} a ${short(item.period_end)}`;
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const month = Number(item.period_start.slice(5, 7)) - 1;
  return `${months[month]} de ${item.period_start.slice(0, 4)}`;
}
