import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useDashboardQuery, useReportDashboard } from "@/lib/reports/dashboard/client";
import { periodTitle } from "@/lib/engine/reportDashboard";
import { CategoryBreakdown, EvolutionChart } from "@/components/reports/DashboardCharts";
import { AnticipationCard, ChangeWaterfall, DashboardHighlights, HabitScoreboard, KpiStrip, OtherInflowsCard, PeriodBar, VerdictCard } from "@/components/reports/DashboardParts";
import { ActNav, ActSection, ProjectionCard, REPORT_ACTS, parseAct, type ReportActId } from "@/components/reports/ReportActs";
import { ActionCard, CommitmentsCard, ConsumptionHero, CostSplitCards, CumulativeChart, GoalProgressCard, OpportunityTiles, ReceivableCard, SummaryTrio, TopCategories, VariationsCard, WeekdayCard } from "@/components/reports/StoryParts";
import { ExecutiveInsightCard } from "@/components/nino/ExecutiveInsightCard";
import { NinoSituationCard } from "@/components/nino/NinoSituationCard";
import { useNinoDiagnosisContext } from "@/lib/nino/diagnosis";
import { consolidateSituations } from "@/lib/nino/consolidate";
import { markNinoSeen } from "@/lib/nino/intelligence";
import { executiveForSection, useExecutiveInsights } from "@/lib/nino/executive";
import { notifyError } from "@/lib/ui/feedback";
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
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState<ReportActId>(parseAct(params.get("ato")));
  const goTo = (id: ReportActId) => {
    setActive(id);
    document.getElementById(`ato-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Leitura do Nino (motor canônico): alimenta os atos 2 e 3. O que não tiver dado some, sem bloco vazio.
  const executive = useExecutiveInsights();
  const diagnosis = useNinoDiagnosisContext();
  const briefing = executive.data;
  const mudancas = [...executiveForSection(briefing, "mudancas"), ...executiveForSection(briefing, "aprendizados")];
  const agora = executiveForSection(briefing, "agora");
  const antecipacoes = consolidateSituations(diagnosis.data?.anticipations ?? []);
  const pendencias = diagnosis.data?.operational_tasks ?? [];
  const historico = diagnosis.data?.closings ?? [];

  // Abrir a tela zera o "novidades" da aba Mais: badge e tela contam a mesma coleção editorial.
  useEffect(() => {
    if (!diagnosis.data) return;
    void markNinoSeen("nino", "all").then(() => {
      void qc.invalidateQueries({ queryKey: ["more-menu-context"] });
    });
  }, [diagnosis.data, qc]);

  // O painel já abre calculado: período, comparação e filtros vivem na URL.
  const { query, update, today } = useDashboardQuery();
  const { data: dash, isLoading, isFetching, isError, refetch } = useReportDashboard(query);
  // Link com ?ato= (vindo da Home, WhatsApp ou da antiga aba Nino) rola até a seção quando o painel já está na tela.
  const deepAct = params.get("ato");
  const hasDash = Boolean(dash);
  useEffect(() => {
    if (!hasDash || !deepAct || deepAct === "foi") return;
    document.getElementById(`ato-${parseAct(deepAct)}`)?.scrollIntoView({ block: "start" });
  }, [hasDash, deepAct]);

  // O atalho do topo acompanha a seção que está na tela.
  useEffect(() => {
    if (!hasDash || typeof IntersectionObserver === "undefined") return;
    const els = REPORT_ACTS.map((a) => document.getElementById(`ato-${a.id}`)).filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
      if (top) setActive(top.target.id.replace("ato-", "") as ReportActId);
    }, { rootMargin: "-20% 0px -60% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [hasDash]);

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
        .select("id,account_id,type,status,amount,occurred_at,competence_date,economic_competence_date,installment_anticipated,category_id,refund_of_transaction_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,description,friendly_description,categories(name)")
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

  const story = dash?.story ?? null;
  const previousLabel = dash?.previous ? periodTitle(dash.previous) : null;

  return (
    <div className="space-y-4 pt-2 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Como foi, o que mudou e para onde vai. Escolha o período e compare.
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
        <>
          <ActNav active={active} onChange={goTo} counts={{ mudou: mudancas.length, vai: agora.length + antecipacoes.length + pendencias.length }} />
          <div className={cn("space-y-8 transition-opacity", isFetching && "opacity-60")} aria-busy={isFetching}>
            <ActSection id="foi">
              {story?.habitual ? (
                <>
                  <ConsumptionHero d={dash} story={story} />
                  <SummaryTrio d={dash} future={dash.future} />
                  <CumulativeChart story={story} />
                  <TopCategories story={story} windowEnd={dash.period.end} />
                </>
              ) : (
                <>
                  <VerdictCard verdict={dash.verdict} filtered={dash.filtered} periodLabel={periodTitle(dash.period)} previousLabel={previousLabel} />
                  <KpiStrip d={dash} />
                  <EvolutionChart d={dash} />
                </>
              )}
              <AnticipationCard d={dash} />
              <OtherInflowsCard d={dash} />
            </ActSection>

            <ActSection id="mudou">
                {story ? (
                  <>
                    <CostSplitCards story={story} />
                    <VariationsCard story={story} />
                    <WeekdayCard story={story} />
                  </>
                ) : dash.change ? <ChangeWaterfall change={dash.change} /> : null}
                <CategoryBreakdown d={dash} />
                {mudancas.length > 0 ? (
                  <section className="space-y-3" aria-label="Leituras do Nino">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Leituras do Nino</p>
                    {mudancas.slice(0, 6).map((insight) => <ExecutiveInsightCard key={insight.key} insight={insight} />)}
                  </section>
                ) : briefing?.coverage.learning ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">O Nino precisa de pelo menos 3 meses de lançamentos para comparar você com o seu próprio padrão.</p>
                ) : null}
                <HabitScoreboard habits={dash.habits} trend={dash.trend} />
                {historico.length > 0 ? (
                  <section className="space-y-2" aria-label="Fechamentos anteriores">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fechamentos anteriores</p>
                    {historico.slice(0, 6).map((closing) => (
                      <details key={closing.id} className="rounded-2xl border border-border bg-card p-4">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                          <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />Fechamento até {new Date(`${closing.period_end}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{closing.closing_text || "Resumo consolidado do período."}</p>
                      </details>
                    ))}
                  </section>
                ) : null}
            </ActSection>

            <ActSection id="vai">
                <CommitmentsCard future={dash.future} />
                <ReceivableCard future={dash.future} />
                {story ? <OpportunityTiles story={story} /> : null}
                {story ? <ActionCard story={story} /> : null}
                <GoalProgressCard future={dash.future} />
                <ProjectionCard d={dash} />
                {agora.length > 0 ? (
                  <section className="space-y-3" aria-label="O que fazer agora">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">O que fazer agora</p>
                    {agora.map((insight, index) => <ExecutiveInsightCard key={insight.key} insight={insight} emphasis={index === 0} />)}
                  </section>
                ) : null}
                <DashboardHighlights highlights={dash.highlights} onAction={(route) => navigate(route)} />
                {antecipacoes.length > 0 ? (
                  <section className="space-y-3" aria-label="Prepare-se">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prepare-se</p>
                    {antecipacoes.slice(0, 5).map((item) => <NinoSituationCard key={item.id} situation={item} surface="relatorios:prepare-se" />)}
                  </section>
                ) : null}
                {pendencias.length > 0 ? (
                  <section className="space-y-2" aria-label="Pendências para organizar">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pendências para organizar</p>
                    {pendencias.map((item) => <NinoSituationCard key={item.id} situation={item} surface="relatorios:operacional" compact />)}
                  </section>
                ) : null}
            </ActSection>
          </div>
        </>
      ) : null}




    </div>
  );
}
