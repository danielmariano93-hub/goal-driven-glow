import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronRight, FileText, Loader2, Sparkles, Trash2 } from "lucide-react";
import { listReports, generateReportNow, deleteReport, periodLabel, type ReportListItem } from "@/lib/reports/intelligent/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";
import { cn } from "@/lib/utils";

function scoreTone(score: number | null) {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 7.5) return "bg-emerald-500/10 text-emerald-600";
  if (score >= 5) return "bg-amber-500/10 text-amber-600";
  return "bg-rose-500/10 text-rose-600";
}

export default function RelatoriosInteligentes() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [generating, setGenerating] = useState<"weekly" | "monthly" | "monthly_partial" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setItems(await listReports());
    } catch (e) {
      notifyError("Não consegui carregar seus relatórios.");
      setItems([]);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleGenerate(type: "weekly" | "monthly" | "monthly_partial") {
    setGenerating(type);
    try {
      const res = await generateReportNow(type);
      notifySuccess("Relatório gerado.");
      await load();
      if (res?.report_id) navigate(`/app/relatorios-inteligentes/${res.report_id}`);
    } catch {
      notifyError("Não consegui gerar o relatório agora. Tente novamente em instantes.");
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

  return (
    <div className="space-y-5 pt-2 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios inteligentes</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Fechamentos semanais e mensais com leitura do Nino — e o retrato do mês em andamento quando você quiser.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleGenerate("weekly")}
          disabled={generating !== null}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "weekly" ? <Loader2 size={16} className="animate-spin text-primary" /> : <CalendarDays size={16} className="text-primary" />}
          Gerar da última semana
        </button>
        <button
          onClick={() => handleGenerate("monthly")}
          disabled={generating !== null}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "monthly" ? <Loader2 size={16} className="animate-spin text-primary" /> : <Sparkles size={16} className="text-primary" />}
          Gerar do último mês
        </button>
        <button
          onClick={() => handleGenerate("monthly_partial")}
          disabled={generating !== null}
          className="col-span-2 flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-left text-xs font-semibold shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          {generating === "monthly_partial" ? <Loader2 size={16} className="animate-spin text-primary" /> : <Sparkles size={16} className="text-primary" />}
          <span>
            Gerar o mês em andamento
            <span className="ml-1 font-normal text-muted-foreground">números reais até hoje, com projeção</span>
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
            Você também pode gerar agora usando os botões acima.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="relative">
              <button
                onClick={() => navigate(`/app/relatorios-inteligentes/${r.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-primary/40"
              >
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold", scoreTone(r.health_score))}>
                  {r.health_score === null ? "—" : r.health_score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {r.report_type === "weekly" ? "Semana" : "Mês"} · {periodLabel(r)}
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
