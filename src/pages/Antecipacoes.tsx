import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CalendarClock, Loader2, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { failureDescription, invokeEdge } from "@/lib/edge/invoke";

type PatternRow = {
  id: string;
  detector: string;
  pattern_key: string;
  label: string;
  status: string;
  sample_size: number;
  baseline_value: number;
  pattern_value: number;
  uplift_pct: number;
  absolute_delta: number;
  confidence: number;
  data_coverage: number;
  last_seen_at: string | null;
};

type OpportunityRow = {
  id: string;
  detector: string;
  kind: string;
  severity: string;
  status: string;
  opportunity_date: string;
  title: string;
  body: string;
  utility_score: number;
  confidence: number;
  channel_target: string;
  dry_run: boolean;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_LABEL: Record<string, string> = {
  candidate: "Em observação",
  validated: "Confirmado",
  active: "Ativo",
  weakened: "Perdendo força",
  expired: "Encerrado",
  muted: "Silenciado",
  scheduled: "Agendado",
  revalidating: "Revalidando",
  ready: "Pronto",
  suppressed: "Não enviado",
  dispatched: "Comunicado",
  missed: "Perdido",
  cancelled: "Cancelado",
};

async function loadData() {
  const [patterns, opportunities] = await Promise.all([
    supabase.from("behavioral_patterns")
      .select("id,detector,pattern_key,label,status,sample_size,baseline_value,pattern_value,uplift_pct,absolute_delta,confidence,data_coverage,last_seen_at")
      .order("confidence", { ascending: false }).limit(30),
    supabase.from("anticipation_opportunities")
      .select("id,detector,kind,severity,status,opportunity_date,title,body,utility_score,confidence,channel_target,dry_run")
      .order("opportunity_date", { ascending: false }).limit(20),
  ]);
  if (patterns.error) throw new Error(patterns.error.message);
  if (opportunities.error) throw new Error(opportunities.error.message);
  return {
    patterns: (patterns.data ?? []) as unknown as PatternRow[],
    opportunities: (opportunities.data ?? []) as unknown as OpportunityRow[],
  };
}

type RunDiagnostics = {
  transaction_facts: number;
  daily_facts: number;
  detectors_eligible: string[];
  patterns_validated: number;
  opportunities_scheduled: number;
  quality?: { ok?: boolean; coverage?: number; days_with_data?: number; window_days?: number; reasons?: string[] };
  skipped?: string;
  errors?: string[];
};

const BLOCK_REASON_LABEL: Record<string, string> = {
  no_active_detectors: "Nenhum detector está ativo neste momento.",
  anticipation_disabled_by_user: "As antecipações estão desligadas nas suas preferências.",
  low_coverage: "Muitos lançamentos ainda estão sem categoria.",
  few_days: "Ainda há poucos dias com movimento registrado.",
  short_window: "A janela de histórico ainda é curta para concluir um padrão.",
  detectors_not_eligible: "Os dados ainda não atingem o mínimo exigido pelos detectores.",
};

function describeBlock(diag: RunDiagnostics | null): string | null {
  if (!diag) return null;
  const skipped = diag.skipped ?? "";
  if (!skipped) return null;
  if (skipped.startsWith("quality_gate:")) {
    const reasons = skipped.slice("quality_gate:".length).split("|").filter(Boolean);
    const parts = reasons.map((r) => BLOCK_REASON_LABEL[r] ?? r);
    return parts.length > 0 ? parts.join(" ") : BLOCK_REASON_LABEL.detectors_not_eligible;
  }
  return BLOCK_REASON_LABEL[skipped] ?? skipped;
}

export default function Antecipacoes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["antecipacoes"], queryFn: loadData });
  const [diag, setDiag] = useState<RunDiagnostics | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, failure } = await invokeEdge<{ runs?: RunDiagnostics[] }>("anticipation-tick", { self: true, only: ["run"] });
      if (failure) throw new Error(failureDescription(failure));
      return (data?.runs ?? [])[0] ?? null;
    },

    onSuccess: async (run) => {
      setDiag(run);
      await queryClient.invalidateQueries({ queryKey: ["antecipacoes"] });
      if (!run) {
        toast.error("O recálculo não retornou resultado. Tente novamente em alguns minutos.");
        return;
      }
      if (run.errors && run.errors.length > 0) {
        toast.error("O recálculo terminou com erro ao gravar seus dados comportamentais.");
        return;
      }
      const block = describeBlock(run);
      if (block) {
        toast.info(`Nada novo por enquanto. ${block}`);
        return;
      }
      if (run.patterns_validated === 0 && run.opportunities_scheduled === 0) {
        toast.info(`Analisei ${run.daily_facts} dia(s) de movimento e ainda não fechei nenhum padrão.`);
        return;
      }
      toast.success(
        `${run.patterns_validated} padrão(ões) confirmado(s) e ${run.opportunities_scheduled} antecipação(ões) programada(s).`,
      );
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível recalcular agora."),
  });


  const active = useMemo(
    () => (query.data?.patterns ?? []).filter((p) => p.status === "validated" || p.status === "active"),
    [query.data],
  );
  const watching = useMemo(
    () => (query.data?.patterns ?? []).filter((p) => p.status !== "validated" && p.status !== "active"),
    [query.data],
  );

  if (query.isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Antecipação</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Padrões que o Nino observa</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Aqui ficam os comportamentos repetidos que o Nino usa para avisar você antes do gasto acontecer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold disabled:opacity-60"
        >
          {refresh.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Atualizar
        </button>
      </header>

      {query.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm">
          Não foi possível carregar seus padrões agora.
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Padrões confirmados</h2>
        </div>
        {active.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Ainda não há padrão confirmado. O Nino só afirma um comportamento quando ele se repete com dados
            categorizados suficientes — continue registrando e isso aparece por aqui.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {active.map((pattern) => (
              <article key={pattern.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{pattern.label}</p>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {STATUS_LABEL[pattern.status] ?? pattern.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nesses dias você costuma gastar {BRL.format(Number(pattern.pattern_value))} contra{" "}
                  {BRL.format(Number(pattern.baseline_value))} do seu padrão — diferença de{" "}
                  {BRL.format(Number(pattern.absolute_delta))}.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Amostra: {pattern.sample_size} dias · Confiança {Math.round(Number(pattern.confidence) * 100)}% ·
                  Cobertura {Math.round(Number(pattern.data_coverage) * 100)}%
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-amber-600" />
          <h2 className="text-sm font-semibold">Próximas antecipações</h2>
        </div>
        {(query.data?.opportunities ?? []).length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Nenhuma antecipação programada no momento.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(query.data?.opportunities ?? []).map((item) => (
              <article key={item.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(`${item.opportunity_date}T12:00:00`).toLocaleDateString("pt-BR")} · utilidade{" "}
                  {Math.round(Number(item.utility_score) * 100)}%{item.dry_run ? " · simulação" : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {watching.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Em observação</h2>
          </div>
          <div className="mt-3 space-y-2">
            {watching.map((pattern) => (
              <div key={pattern.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3">
                <p className="min-w-0 truncate text-xs">{pattern.label}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{STATUS_LABEL[pattern.status] ?? pattern.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        Transferências entre suas contas, pagamentos de fatura, aplicações e resgates ficam fora desses padrões —
        eles olham apenas consumo real.
      </p>
    </div>
  );
}
