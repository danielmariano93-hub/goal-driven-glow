import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useDashboardQuery, useReportDashboard } from "@/lib/reports/dashboard/client";
import { periodTitle } from "@/lib/engine/reportDashboard";
import { CategoryBreakdown, EvolutionChart } from "@/components/reports/DashboardCharts";
import { ChangeWaterfall, DashboardHighlights, HabitScoreboard, KpiStrip, OtherInflowsCard, PeriodBar, VerdictCard } from "@/components/reports/DashboardParts";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";
import { supabase } from "@/integrations/supabase/client";
import { filterCanonicalReportTransactions, filterPeriod, toCsv, type ReportTxn } from "@/lib/reports/aggregations";
import { cn } from "@/lib/utils";

function addDaysIso(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Piso de carga do CSV: compra de cartão do ciclo anterior tem competência
 * dentro do período exportado, então o fetch recua e o corte final é por
 * competência (`reporting_competence.v1`).
 */
function csvLoadFloor(from: string): string {
  return addDaysIso(from, -75);
}


export default function RelatoriosInteligentes() {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  // O painel já abre calculado: período, comparação e filtros vivem na URL.
  const { query, update, today } = useDashboardQuery();
  const { data: dash, isLoading, isFetching, isError, refetch } = useReportDashboard(query);
  const from = query.start;
  const to = query.end;
  const rangeValid = Boolean(from && to && from <= to && to <= today);

  /** CSV do período selecionado — os mesmos lançamentos que o relatório enxerga. */
  async function handleExportCsv() {
    if (!rangeValid) {
      notifyError("Escolha um período válido para exportar.");
      return;
    }
    setExporting(true);
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,account_id,type,status,amount,occurred_at,competence_date,category_id,refund_of_transaction_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,description,friendly_description,categories(name)")
        // Margem para trás: compra de cartão do ciclo anterior tem competência
        // dentro do período. O recorte final é feito por competência.
        .gte("occurred_at", csvLoadFloor(from))
        .lte("occurred_at", to)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      type RawTxn = Record<string, unknown> & { categories?: { name?: string | null } | null };
      const txns = ((data ?? []) as unknown as RawTxn[]).map((t) => ({
        ...(t as object),
        amount: Number(t.amount),
        category_name: t.categories?.name ?? null,
      }) as unknown as ReportTxn);
      const rows = filterCanonicalReportTransactions(filterPeriod(txns, from, to));
      if (rows.length === 0) {
        notifyError("Não há lançamentos nesse período para exportar.");
        return;
      }
      const csv = toCsv(rows.map((t) => ({
        data: t.occurred_at,
        competencia: t.competence_date ?? t.occurred_at,
        tipo: t.type,
        valor: t.amount,
        categoria: t.category_name ?? "",
        descricao: (t as unknown as { friendly_description?: string | null; description?: string | null }).friendly_description
          ?? (t as unknown as { description?: string | null }).description ?? "",
      })));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notifyError("Não consegui exportar agora. Tente novamente em instantes.");
    } finally {
      setExporting(false);
    }
  }

  const previousLabel = dash?.previous ? periodTitle(dash.previous) : null;

  return (
    <div className="space-y-4 pt-2 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Como você está, para onde vai o dinheiro e o que mudou. Escolha o período e compare.
          </p>
        </div>
        <div className="flex shrink-0 gap-2 print:hidden">
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"
          >
            <Printer size={12} /> Imprimir
          </button>
        </div>
      </header>

      <PeriodBar
        query={query}
        onChange={update}
        categories={dash?.filterOptions.categories ?? []}
        today={today}
        comparisonAvailable={dash?.coverage.comparisonAvailable ?? true}
      />

      {isLoading && !dash ? (
        <div className="grid place-items-center py-16" role="status" aria-live="polite">
          <Loader2 className="animate-spin text-muted-foreground" />
          <span className="sr-only">Calculando seu painel</span>
        </div>
      ) : isError && !dash ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold">Não consegui montar o painel agora</p>
          <p className="mt-1 text-xs text-muted-foreground">Seus dados estão seguros. Tente de novo em instantes.</p>
          <button type="button" onClick={() => void refetch()} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium">
            <RefreshCw size={12} /> Tentar de novo
          </button>
        </div>
      ) : dash ? (
        <div className={cn("space-y-4 transition-opacity", isFetching && "opacity-60")} aria-busy={isFetching}>
          <VerdictCard verdict={dash.verdict} filtered={dash.filtered} periodLabel={periodTitle(dash.period)} previousLabel={previousLabel} />
          <KpiStrip d={dash} />
          <OtherInflowsCard d={dash} />
          <DashboardHighlights highlights={dash.highlights} onAction={(route) => navigate(route)} />
          <EvolutionChart d={dash} />
          <CategoryBreakdown d={dash} />
          {dash.change ? <ChangeWaterfall change={dash.change} /> : null}
          <HabitScoreboard habits={dash.habits} trend={dash.trend} />
        </div>
      ) : null}




    </div>
  );
}
