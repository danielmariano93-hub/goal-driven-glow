import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useDashboardQuery, useReportDashboard } from "@/lib/reports/dashboard/client";
import { periodTitle } from "@/lib/engine/reportDashboard";
import { CategoryBreakdown, EvolutionChart } from "@/components/reports/DashboardCharts";
import { KpiStrip, PeriodBar, VerdictCard } from "@/components/reports/DashboardParts";
import { ActionCard, CommitmentsCard, ConsumptionHero, CostSplitCards, CumulativeChart, GoalProgressCard, MerchantsList, MonthSelector, OpportunityTiles, ReceivableCard, ReportTabs, StorySection, SummaryTrio, TopCategories, VariationsCard, WeekdayCard, parseTab, type ReportTabId } from "@/components/reports/StoryParts";
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
  const [exporting, setExporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("aba"));
  const setTab = (id: ReportTabId) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id === "geral") next.delete("aba"); else next.set("aba", id);
      return next;
    }, { replace: true });
  };

  // O painel já abre calculado: período, comparação e filtros vivem na URL.
  const { query, update, today } = useDashboardQuery();
  const { data: dash, isLoading, isFetching, isError, refetch } = useReportDashboard(query);
  const from = query.start;
  const to = query.end;
  const rangeValid = Boolean(from && to && from <= to && to <= today);

  // Link com ?ato= (Home, WhatsApp, antiga aba Nino) rola até a seção quando o painel já está na tela.
  const deepAct = params.get("ato");
  const hasDash = Boolean(dash);
  useEffect(() => {
    if (!hasDash || tab !== "geral" || !deepAct || deepAct === "foi") return;
    document.getElementById(deepAct === "vai" ? "ato-vai" : "ato-mudou")?.scrollIntoView({ block: "start" });
  }, [hasDash, deepAct, tab]);

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
  const hasChanges = Boolean(story && (story.split || story.variations.length > 0 || story.weekday));
  const future = dash?.future ?? null;
  const hasFuture = Boolean(future && (future.commitments || future.receivable || future.goal)) || Boolean(story && (story.sustainableSavings || story.recoverable || story.action));

  return (
    <div className="space-y-4 pt-2 pb-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Seu resumo financeiro com insights práticos.</p>
      </header>

      <MonthSelector
        start={from} end={to} today={today}
        onPick={(r) => update(r.isCurrent ? { preset: "month" } : { preset: "custom", start: r.start, end: r.end })}
      />
      <ReportTabs active={tab} onChange={setTab} />

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
          {tab === "geral" ? (
            <div role="tabpanel" id="painel-geral" aria-labelledby="aba-geral" className="space-y-6">
              <div className="space-y-3">
                {story?.habitual ? (
                  <>
                    <ConsumptionHero d={dash} story={story} />
                    <SummaryTrio d={dash} story={story} future={dash.future} />
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
              </div>

              {hasChanges && story ? (
                <StorySection id="ato-mudou" title="O que mudou no seu mês" subtitle="Comparado ao seu padrão, veja onde estão as principais mudanças no seu consumo.">
                  <CostSplitCards story={story} />
                  <VariationsCard story={story} />
                  <WeekdayCard story={story} />
                </StorySection>
              ) : null}

              {hasFuture ? (
                <StorySection id="ato-vai" title="Para onde você vai" subtitle="Projeção dos próximos 30 dias e oportunidades para melhorar o seu resultado.">
                  <CommitmentsCard future={future} />
                  <ReceivableCard future={future} />
                  {story ? <OpportunityTiles story={story} /> : null}
                  {story ? <ActionCard story={story} /> : null}
                  <GoalProgressCard future={future} />
                </StorySection>
              ) : null}
            </div>
          ) : null}

          {tab === "categorias" ? (
            <div role="tabpanel" id="painel-categorias" aria-labelledby="aba-categorias" className="space-y-3">
              <CategoryBreakdown d={dash} />
            </div>
          ) : null}

          {tab === "estabelecimentos" ? (
            <div role="tabpanel" id="painel-estabelecimentos" aria-labelledby="aba-estabelecimentos" className="space-y-3">
              <MerchantsList d={dash} />
            </div>
          ) : null}

          {tab === "mais" ? (
            <div role="tabpanel" id="painel-mais" aria-labelledby="aba-mais" className="space-y-4">
              <PeriodBar query={query} onChange={update} categories={dash.filterOptions.categories} today={today} comparisonAvailable={dash.coverage.comparisonAvailable} />
              <div className="flex gap-2 print:hidden">
                <button type="button" onClick={() => void handleExportCsv()} disabled={exporting} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs disabled:opacity-60">
                  {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} CSV
                </button>
                <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs">
                  <Printer size={12} /> Imprimir
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
