import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnchorNav, MeuMesBody, MeuMesError, MeuMesHeader, MeuMesSkeleton, MonthPicker, scrollToChapter } from "@/components/reports/meumes/MeuMes";
import type { Anchor } from "@/lib/engine/reportEditorial";
import { useReportV2, useReportV2Query } from "@/lib/reports/reportV2Client";
import { BehaviorTab, EvolutionTab, OverviewTab, ProjectionsTab } from "@/components/reports/v2/tabs";
import { PeriodSelector, ReportError, ReportHeader, ReportSkeleton, ReportTabs } from "@/components/reports/v2/shell";
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
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useReportV2(month, compare);
  // Nunca mostrar números de outro mês durante o carregamento.
  const rep = data && data.month === month ? data : undefined;
  const [params] = useSearchParams();
  const legacy = params.get("versao") === "abas";
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

  if (legacy) return (
    <div className="mx-auto max-w-[1200px] space-y-3 pt-2 pb-8">
      <ReportHeader onExport={() => void handleExportCsv()} exporting={exporting} asOf={rep?.meta.asOf} />
      <PeriodSelector month={month} thisMonth={thisMonth} today={today} onPick={(m) => update({ month: m })} />
      <ReportTabs active={tab} onChange={(id) => update({ tab: id })} />

      {isLoading && !rep ? <ReportSkeleton /> : isError && !rep ? <ReportError onRetry={() => void refetch()} /> : rep ? (
        <div className={cn("transition-opacity", isFetching && "opacity-60")} aria-busy={isFetching}>
          {isError ? <p className="mb-3 rounded-xl bg-[#E9A23B]/10 px-3 py-2 text-xs leading-4">Mostrando a última versão carregada; a atualização falhou.</p> : null}
          {tab === "geral" ? <div role="tabpanel" id="painel-geral" aria-labelledby="aba-geral"><OverviewTab rep={rep} onTab={(t) => update({ tab: t })} /></div> : null}
          {tab === "comportamento" ? <div role="tabpanel" id="painel-comportamento" aria-labelledby="aba-comportamento"><BehaviorTab rep={rep} compare={compare} onCompare={(c) => update({ compare: c })} month={month} /></div> : null}
          {tab === "projecoes" ? <div role="tabpanel" id="painel-projecoes" aria-labelledby="aba-projecoes"><ProjectionsTab rep={rep} month={month} /></div> : null}
          {tab === "evolucao" ? <div role="tabpanel" id="painel-evolucao" aria-labelledby="aba-evolucao"><EvolutionTab rep={rep} /></div> : null}
        </div>
      ) : null}
    </div>
  );


  // Meu mês (padrão). `?versao=abas` mantém o layout anterior como reversão.
  return (
    <div className="mx-auto max-w-[1120px] pt-2 pb-10">
      <MeuMesHeader onExport={() => void handleExportCsv()} exporting={exporting} />
      <MonthPicker month={month} thisMonth={thisMonth} today={today} onPick={(m) => update({ month: m })} />
      <AnchorNav watch={rep} />
      <InitialAnchor ready={!!rep} />
      {!rep && (isLoading || isFetching) ? <MeuMesSkeleton /> : !rep && isError ? <MeuMesError onRetry={() => void refetch()} /> : rep ? (
        <div aria-busy={isFetching}>
          {isError ? <p role="status" className="mt-3 rounded-xl bg-[#E9A23B]/10 px-3 py-2 text-xs leading-4">Sem conexão com o servidor: mostrando os dados carregados às {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p> : null}
          <MeuMesBody rep={rep} compare={compare} onCompare={(c) => update({ compare: c })} month={month} />
        </div>
      ) : null}
    </div>
  );
}

const LEGACY_TO_ANCHOR: Record<string, Anchor> = { geral: "momento", comportamento: "habitos", projecoes: "futuro", evolucao: "evolucao", foi: "momento", mudou: "gastos", vai: "futuro" };

/** Links antigos (?aba=, ?ato=) e #âncora levam ao capítulo certo, uma vez, quando o conteúdo existe. */
function InitialAnchor({ ready }: { ready: boolean }) {
  const [params] = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    const target = (hash || LEGACY_TO_ANCHOR[params.get("aba") ?? ""] || LEGACY_TO_ANCHOR[params.get("ato") ?? ""]) as Anchor | undefined;
    if (target && target !== "momento") requestAnimationFrame(() => scrollToChapter(target));
  }, [ready, params]);
  return null;
}
