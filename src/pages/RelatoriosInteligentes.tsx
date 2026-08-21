import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronRight, Download, FileText, Loader2, Printer, Sparkles, Trash2 } from "lucide-react";
import { listReports, generateReportNow, deleteReport, periodLabel, type ReportListItem } from "@/lib/reports/intelligent/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";
import { supabase } from "@/integrations/supabase/client";
import { filterCanonicalReportTransactions, filterPeriod, toCsv, type ReportTxn } from "@/lib/reports/aggregations";
import { resolvePeriodRange } from "@/lib/ui/periodStore";
import { cn } from "@/lib/utils";

type QuickType = "weekly" | "monthly" | "monthly_partial";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function shortLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
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
  const [generating, setGenerating] = useState<QuickType | "custom" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const initial = useMemo(() => resolvePeriodRange(), []);
  const [from, setFrom] = useState(initial.start);
  const [to, setTo] = useState(initial.end);
  const today = isoToday();
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

  async function handleGenerate(type: QuickType) {
    setGenerating(type);
    try {
      const res = await generateReportNow(type);
      notifySuccess("Relatório gerado.");
      await load();
      if (res?.report_id) navigate(`/app/relatorios/${res.report_id}`);
    } catch {
      notifyError("Não consegui gerar o relatório agora. Tente novamente em instantes.");
    } finally {
      setGenerating(null);
    }
  }

  async function handleGenerateCustom() {
    if (!rangeValid) {
      notifyError("Escolha um período válido, terminando hoje ou antes.");
      return;
    }
    setGenerating("custom");
    try {
      const res = await generateReportNow("custom", { start: from, end: to });
      notifySuccess("Relatório do período gerado.");
      setPickerOpen(false);
      await load();
      if (res?.report_id) navigate(`/app/relatorios/${res.report_id}`);
    } catch {
      notifyError("Não consegui gerar o relatório desse período. Revise as datas e tente de novo.");
    } finally {
      setGenerating(null);
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
        .select("id,account_id,type,status,amount,occurred_at,category_id,refund_of_transaction_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,description,friendly_description,categories(name)")
        .gte("occurred_at", from)
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

  function applyPreset(kind: "month" | "previousMonth" | "7d" | "30d") {
    const now = new Date();
    if (kind === "month") {
      setFrom(`${today.slice(0, 7)}-01`);
      setTo(today);
      return;
    }
    if (kind === "previousMonth") {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      setFrom(iso(first));
      setTo(iso(last));
      return;
    }
    setFrom(addDaysIso(today, kind === "7d" ? -6 : -29));
    setTo(today);
  }

  const busy = generating !== null;

  return (
    <div className="space-y-5 pt-2 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A leitura do Nino sobre o período que você escolher — semana fechada, mês fechado, mês em andamento ou datas livres.
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

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => void handleGenerate("weekly")}
          disabled={busy}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "weekly" ? <Loader2 size={16} className="animate-spin text-primary" /> : <CalendarDays size={16} className="text-primary" />}
          Última semana
        </button>
        <button
          onClick={() => void handleGenerate("monthly")}
          disabled={busy}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "monthly" ? <Loader2 size={16} className="animate-spin text-primary" /> : <Sparkles size={16} className="text-primary" />}
          Último mês
        </button>
        <button
          onClick={() => void handleGenerate("monthly_partial")}
          disabled={busy}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "monthly_partial" ? <Loader2 size={16} className="animate-spin text-primary" /> : <Sparkles size={16} className="text-primary" />}
          <span>
            Mês em andamento
            <span className="block font-normal text-muted-foreground">números reais até hoje</span>
          </span>
        </button>
        <button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="flex items-center gap-2 rounded-2xl border border-primary/40 bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary disabled:opacity-60"
        >
          {generating === "custom" ? <Loader2 size={16} className="animate-spin text-primary" /> : <CalendarDays size={16} className="text-primary" />}
          <span>
            Escolher período
            <span className="block font-normal text-muted-foreground">{shortLabel(from)} a {shortLabel(to)}</span>
          </span>
        </button>
      </div>

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

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Relatório de um período</SheetTitle>
            <SheetDescription>
              Escolha as datas e o Nino fecha exatamente esse intervalo, comparando com os mesmos dias imediatamente anteriores.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-full text-xs" onClick={() => applyPreset("month")}>Este mês</Button>
            <Button type="button" variant="outline" className="h-10 rounded-full text-xs" onClick={() => applyPreset("previousMonth")}>Mês passado</Button>
            <Button type="button" variant="outline" className="h-10 rounded-full text-xs" onClick={() => applyPreset("7d")}>Últimos 7 dias</Button>
            <Button type="button" variant="outline" className="h-10 rounded-full text-xs" onClick={() => applyPreset("30d")}>Últimos 30 dias</Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              De
              <input
                type="date"
                value={from}
                max={to || today}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 h-11 w-full rounded-[14px] border border-border bg-background px-3 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Até
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 h-11 w-full rounded-[14px] border border-border bg-background px-3 text-sm"
              />
            </label>
          </div>

          <Button
            onClick={() => void handleGenerateCustom()}
            disabled={!rangeValid || busy}
            className="mt-4 w-full rounded-full"
          >
            {generating === "custom" ? "Gerando…" : "Gerar relatório do período"}
          </Button>
        </SheetContent>
      </Sheet>

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
