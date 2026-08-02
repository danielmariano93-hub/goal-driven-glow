import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Info, Loader2, Printer, Sparkles } from "lucide-react";
import ReportHealthGauge from "@/components/relatorios/ReportHealthGauge";
import ReportMetricsGrid from "@/components/relatorios/ReportMetricsGrid";
import ReportHighlightList from "@/components/relatorios/ReportHighlightList";
import ReportCharts from "@/components/relatorios/ReportCharts";
import { getReport, markReportViewed, periodLabel, type ReportDetail } from "@/lib/reports/intelligent/client";
import { notifyError } from "@/lib/ui/feedback";
import { cn } from "@/lib/utils";

export default function RelatorioInteligenteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDetail | null | "missing">(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await getReport(id);
        setReport(data ?? "missing");
        if (data) void markReportViewed(id);
      } catch {
        notifyError("Não consegui abrir este relatório.");
        setReport("missing");
      }
    })();
  }, [id]);

  if (report === null) {
    return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  }
  if (report === "missing") {
    return (
      <div className="space-y-4 pt-2">
        <p className="text-sm text-muted-foreground">Relatório não encontrado.</p>
        <button onClick={() => navigate("/app/relatorios-inteligentes")} className="text-sm font-semibold text-primary">
          Voltar para o histórico
        </button>
      </div>
    );
  }

  const quality = report.data_quality_flags ?? [];
  const breakdown = report.health_breakdown ?? [];

  return (
    <div className="space-y-5 pt-2 pb-10 print:pb-0" id="report-print-area">
      <header className="space-y-2">
        <button
          onClick={() => navigate("/app/relatorios-inteligentes")}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground print:hidden"
        >
          <ArrowLeft size={14} /> Histórico
        </button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              Relatório {report.report_type === "weekly" ? "semanal" : "mensal"}
            </h1>
            <p className="text-xs text-muted-foreground">{periodLabel(report)} · período fechado</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 print:hidden">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold shadow-card disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Atualizar dados
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold shadow-card"
            >
              <Printer size={14} /> PDF
            </button>
          </div>

        </div>
      </header>

      <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 shadow-card">
        <ReportHealthGauge score={report.health_score ?? 0} />
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
          {breakdown.map((c) => (
            <li key={c.key} className="text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {c.score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/{c.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, (c.score / c.max) * 100))}%` }}
                />
              </div>
              <p className="mt-0.5 text-muted-foreground">{c.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {report.executive_summary && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Leitura do Nino</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{report.executive_summary}</p>
          {report.closing_text && (
            <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed">{report.closing_text}</p>
          )}
        </section>
      )}

      {quality.length > 0 && (
        <section className={cn(
          "rounded-2xl border p-4",
          report.data_quality_status === "insufficient" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5",
        )}>
          <div className="flex items-center gap-2">
            <Info size={15} className={report.data_quality_status === "insufficient" ? "text-rose-600" : "text-amber-600"} />
            <h2 className="text-sm font-semibold">Confiança dos dados</h2>
          </div>
          <ul className="mt-2 space-y-1">
            {quality.map((f) => (
              <li key={f.key} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{f.label}.</span> {f.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Números do período</h2>
        <ReportMetricsGrid metrics={report.metrics} />
      </section>

      {report.payload && <ReportCharts payload={report.payload} />}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">O que merece sua atenção</h2>
        <ReportHighlightList highlights={report.highlights} />
      </section>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Gerado em {new Date(report.generated_at).toLocaleString("pt-BR")} ·
        números calculados pelo motor financeiro único do Meu Nino
        {report.text_source === "deterministic" ? " · texto gerado em modo determinístico" : ""}.
      </p>
    </div>
  );
}
