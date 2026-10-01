import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookmarkPlus, ChevronRight, Download, FileText, Loader2, Printer, RefreshCw, Trash2 } from "lucide-react";
import { listReports, generateReportNow, deleteReport, periodLabel, type ReportListItem } from "@/lib/reports/intelligent/client";
import { useDashboardQuery, useReportDashboard } from "@/lib/reports/dashboard/client";
import { periodTitle } from "@/lib/engine/reportDashboard";
import { CategoryBreakdown, EvolutionChart } from "@/components/reports/DashboardCharts";
import { ChangeWaterfall, DashboardHighlights, HabitScoreboard, KpiStrip, PeriodBar, VerdictCard } from "@/components/reports/DashboardParts";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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


function scoreTone(score: number | null) {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 7.5) return "bg-emerald-500/10 text-emerald-600";
  if (score >= 5) return "bg-amber-500/10 text-amber-600";
  return "bg-rose-500/10 text-rose-600";
}

function typeLabel(type: ReportListItem["report_type"]): string {
  if (type === "weekly") return "Semana";
  if (type === "custom") return "Período";
  return "Mês";
}

export default function RelatoriosInteligentes() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // O painel já abre calculado: período, comparação e filtros vivem na URL.
  const { query, update, today } = useDashboardQuery();
  const { data: dash, isLoading, isFetching, isError, refetch } = useReportDashboard(query);
  const from = query.start;
  const to = query.end;
  const rangeValid = Boolean(from && to && from <= to && to <= today);

  async function load() {
    try {
      setItems(await listReports());
    } catch {
      notifyError("Não consegui carregar seus relatórios.");
      setItems([]);
    }
  }

  useEffect(() => { void load(); }, []);

  /** Guarda o período que está na tela como relatório salvo (com a leitura do Nino). */
  async function handleSave() {
    setSaving(true);
    try {
      const res = await generateReportNow("custom", { start: from, end: to });
      notifySuccess("Relatório salvo.");
      await load();
      if (res?.report_id) navigate(`/app/relatorios/${res.report_id}`);
    } catch {
      notifyError("Não consegui salvar o relatório agora. Tente novamente em instantes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteReport(pendingDelete.id);
      setItems((prev) => (prev ?? []).filter((r) => r.id !== pendingDelete.id));
      notifySuccess("Relatório excluído.");
      setPendingDelete(null);
    } catch {
      notifyError("Não consegui excluir esse relatório agora.");
    } finally {
      setDeleting(false);
    }
  }

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
          <DashboardHighlights highlights={dash.highlights} onAction={(route) => navigate(route)} />
          <EvolutionChart d={dash} />
          <CategoryBreakdown d={dash} />
          {dash.change ? <ChangeWaterfall change={dash.change} /> : null}
          <HabitScoreboard habits={dash.habits} trend={dash.trend} />
          <div className="flex justify-center print:hidden">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary px-4 py-2 text-xs font-semibold text-primary disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <BookmarkPlus size={12} />} Salvar este relatório com a leitura do Nino
            </button>
          </div>
        </div>
      ) : null}

      <details className="group rounded-2xl border border-border bg-card print:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          Relatórios salvos{items ? ` (${items.length})` : ""}
          <ChevronRight size={16} className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="border-t border-border p-3">
      {items === null ? (
        <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileText size={20} />
          </span>
          <p className="mt-3 text-sm font-semibold">Nenhum relatório ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Todo domingo à noite e no fim de cada mês o Nino fecha o período e publica o relatório aqui.
            Você também pode gerar agora, inclusive de um período escolhido por você.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="relative">
              <button
                onClick={() => navigate(`/app/relatorios/${r.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-primary/40"
              >
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold", scoreTone(r.health_score))}>
                  {r.health_score === null ? "—" : r.health_score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {typeLabel(r.report_type)} · {periodLabel(r)}
                    </span>
                    {!r.viewed_at && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">novo</span>}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">
                    {r.executive_summary ?? "Relatório disponível."}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(r)}
                aria-label={`Excluir relatório de ${periodLabel(r)}`}
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

        </div>
      </details>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este relatório?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `O relatório de ${periodLabel(pendingDelete)} e sua leitura do Nino serão apagados. Seus lançamentos não são afetados e você pode gerar o período novamente depois.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Manter</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void handleDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
