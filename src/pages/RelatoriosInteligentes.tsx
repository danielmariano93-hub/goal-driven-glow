import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useReportV2, useReportV2Query } from "@/lib/reports/reportV2Client";
import { BridgeCard, CausesCard, MethodCard, PriorityAction, CashProjectionCard, CategoriesAndMerchants, CommitmentsCardV2, CompareControlV2, ConsumptionHero, ConsumptionProjectionCard, CurveChart, DriversCard, GoalsCardV2, MonthPicker, MonthlyResultCard, NetWorthCard, PatternsCard, QualityNotes, ReceivablesCardV2, RecommendationsCard, RecoverableCardV2, SavingsCardV2, SmallSpendCard, SplitCard, SummaryTrioV2, TabsV2, TopCategoriesV2, WeekdayCardV2 } from "@/components/reports/v2/ReportV2Parts";
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
  const { month, compare, tab, today, thisMonth, update } = useReportV2Query();
  const { data: rep, isLoading, isFetching, isError, refetch } = useReportV2(month, compare);
  const from = `${month}-01`;
  const to = month === thisMonth ? today : `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const rangeValid = Boolean(from <= to && to <= today);

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

  return (
    <div className="space-y-4 pt-2 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Seu resumo financeiro com insights práticos.</p>
        </div>
        <div className="flex shrink-0 gap-1.5 print:hidden">
          <button type="button" aria-label="Exportar CSV" title="Exportar CSV" onClick={() => void handleExportCsv()} disabled={exporting}
            className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground disabled:opacity-60">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </button>
          <button type="button" aria-label="Imprimir" title="Imprimir" onClick={() => window.print()} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground">
            <Printer size={15} />
          </button>
        </div>
      </header>

      <MonthPicker month={month} thisMonth={thisMonth} today={today} onPick={(m) => update({ month: m })} />
      <TabsV2 active={tab} onChange={(id) => update({ tab: id })} />

      {isLoading && !rep ? (
        <div className="grid place-items-center py-16" role="status" aria-live="polite">
          <Loader2 className="animate-spin text-muted-foreground" />
          <span className="sr-only">Calculando seu relatório</span>
        </div>
      ) : isError && !rep ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold">Não consegui montar o relatório agora</p>
          <p className="mt-1 text-xs text-muted-foreground">Seus dados estão seguros. Tente de novo em instantes.</p>
          <button type="button" onClick={() => void refetch()} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium">
            <RefreshCw size={12} /> Tentar de novo
          </button>
        </div>
      ) : rep ? (
        <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-60")} aria-busy={isFetching}>
          {tab === "geral" ? (
            <div role="tabpanel" id="painel-geral" aria-labelledby="aba-geral" className="space-y-3">
              {rep.overview ? (
                <>
                  {rep.overview.headline ? <p className="px-1 text-[15px] font-medium leading-snug">{rep.overview.headline}</p> : null}
                  <ConsumptionHero o={rep.overview} isCurrent={rep.isCurrentMonth} />
                  <SummaryTrioV2 o={rep.overview} />
                  <BridgeCard lines={rep.overview.bridge} />
                  <CausesCard o={rep.overview} />
                  <PriorityAction r={rep.recommendations} />
                  <CurveChart o={rep.overview} />
                  {rep.behavior ? <TopCategoriesV2 categories={rep.behavior.categories} onSeeAll={() => update({ tab: "comportamento" })} /> : null}
                </>
              ) : <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-[13px] text-muted-foreground">Ainda não há movimentações neste mês.</p>}
              <MethodCard meta={rep.meta} notes={rep.quality} />
            </div>
          ) : null}

          {tab === "comportamento" ? (
            <div role="tabpanel" id="painel-comportamento" aria-labelledby="aba-comportamento" className="space-y-3">
              {rep.behavior ? (
                <>
                  <CompareControlV2 compare={compare} onChange={(c) => update({ compare: c })} />
                  <DriversCard b={rep.behavior} />
                  <SplitCard b={rep.behavior} />
                  <PatternsCard b={rep.behavior} month={month} />
                  <CategoriesAndMerchants b={rep.behavior} compared={compare !== "none" && rep.behavior.previousLabel != null} month={month} />
                  <WeekdayCardV2 b={rep.behavior} />
                  <SmallSpendCard b={rep.behavior} />
                </>
              ) : <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-[13px] text-muted-foreground">Ainda não há gastos neste mês para analisar.</p>}
            </div>
          ) : null}

          {tab === "projecoes" ? (
            <div role="tabpanel" id="painel-projecoes" aria-labelledby="aba-projecoes" className="space-y-3">
              {!rep.isCurrentMonth ? <p className="rounded-2xl border border-dashed border-border bg-card p-3 text-[12.5px] text-muted-foreground">Projeções valem para o mês em andamento; abaixo, o que continua valendo hoje.</p> : null}
              <CashProjectionCard p={rep.projections} />
              <ConsumptionProjectionCard p={rep.projections} />
              <CommitmentsCardV2 p={rep.projections} />
              <ReceivablesCardV2 p={rep.projections} />
              <SavingsCardV2 p={rep.projections} />
              <RecoverableCardV2 p={rep.projections} />
              <RecommendationsCard r={rep.recommendations} month={month} />
              <QualityNotes notes={rep.quality.filter((q) => ["snapshot_stale", "cash_mismatch", "profile_stale"].includes(q.code))} />
            </div>
          ) : null}

          {tab === "evolucao" ? (
            <div role="tabpanel" id="painel-evolucao" aria-labelledby="aba-evolucao" className="space-y-3">
              <MonthlyResultCard e={rep.evolution} />
              <NetWorthCard e={rep.evolution} />
              <GoalsCardV2 e={rep.evolution} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
