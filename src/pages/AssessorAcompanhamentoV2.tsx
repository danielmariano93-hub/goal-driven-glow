import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Info,
  Loader2,
  MessageCircle,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  loadAdvisorReadiness,
  loadNinoContext,
  requestNinoRefresh,
  updateAdvisorAction,
} from "@/lib/nino/client";
import type { AdvisorReview } from "@/lib/nino/contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

export default function AssessorAcompanhamentoV2({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialPeriod = searchParams.get("period") === "monthly" ? "monthly" : "weekly";
  const [period, setPeriod] = useState<"weekly" | "monthly">(initialPeriod);

  const contextQuery = useQuery({
    queryKey: ["nino-context"],
    queryFn: loadNinoContext,
    staleTime: 30_000,
  });
  const readinessQuery = useQuery({
    queryKey: ["nino-advisor-readiness"],
    queryFn: loadAdvisorReadiness,
    staleTime: 30_000,
  });

  const review = useMemo(() => (contextQuery.data?.reviews ?? [])
    .filter((item) => item.period_kind === period)
    .sort((a, b) => b.period_start.localeCompare(a.period_start))[0] ?? null,
  [contextQuery.data, period]);

  const refreshMutation = useMutation({
    mutationFn: requestNinoRefresh,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nino-context"] }),
        queryClient.invalidateQueries({ queryKey: ["nino-advisor-readiness"] }),
      ]);
      toast.success("Revisões recalculadas com os dados mais recentes.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const actionMutation = useMutation({
    mutationFn: async (args: {
      review: AdvisorReview;
      key: string;
      status: "in_progress" | "done" | "dismissed";
    }) => updateAdvisorAction({
      reviewId: args.review.id,
      actionKey: args.key,
      status: args.status,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nino-context"] });
      toast.success("Próximo passo atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (contextQuery.isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (contextQuery.isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-6">
        <p className="text-sm font-semibold">Não foi possível carregar o acompanhamento.</p>
        <p className="mt-1 text-xs text-muted-foreground">{(contextQuery.error as Error).message}</p>
      </div>
    );
  }

  const indicators = review?.summary.indicators ?? {};
  const highlights = review?.summary.highlights ?? [];
  const actions = review?.actions ?? [];
  const expenseChange = review ? number(indicators.expense_change_pct) : 0;
  const selectedLastGenerated = period === "weekly"
    ? readinessQuery.data?.weekly_last_generated_at
    : readinessQuery.data?.monthly_last_generated_at;

  return (
    <div className="space-y-6 pb-10">
      {!embedded && <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Acompanhamento do Nino</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Seu plano de ação financeiro: o que mudou, quanto isso representa e qual decisão tomar agora.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshMutation.isPending ? "animate-spin" : ""} />
            {refreshMutation.isPending ? "Atualizando..." : "Atualizar agora"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {selectedLastGenerated
              ? `Atualizada em ${new Date(selectedLastGenerated).toLocaleString("pt-BR")}`
              : "Ainda não gerada para este período"}
          </span>
        </div>
      </header>}

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1">
        {([
          ["weekly", "Revisão semanal"],
          ["monthly", "Fechamento mensal"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setPeriod(value)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
              period === value ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!review ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-sm font-semibold">
            {readinessQuery.data && !readinessQuery.data.eligible
              ? "Ainda não há dados suficientes para uma revisão honesta"
              : "A revisão está pronta para ser calculada"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            O Nino não mostra indicadores zerados nem diagnósticos genéricos. A revisão só aparece quando existem fatos suficientes.
          </p>
          {readinessQuery.data && readinessQuery.data.missing.length > 0 && (
            <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-xs text-muted-foreground">
              {readinessQuery.data.missing.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || readinessQuery.data?.eligible === false}
              className="btn-brand inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={14} /> Gerar revisão
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/assessor")}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold"
            >
              <MessageCircle size={14} /> Conversar com o Nino
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-5 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {formatDate(review.period_start)} a {formatDate(review.period_end)}
            </p>
            <h2 className="mt-2 text-lg font-bold">{review.summary.headline}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{review.summary.explanation}</p>

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Entradas" value={BRL.format(number(indicators.income))} />
              <Metric label="Despesas" value={BRL.format(number(indicators.expense))} />
              <Metric
                label="Resultado do período"
                value={BRL.format(number(indicators.net))}
                tone={number(indicators.net) >= 0 ? "positive" : "negative"}
              />
              {period === "weekly" ? (
                <Metric
                  label="Vs. semana anterior"
                  value={`${expenseChange > 0 ? "+" : ""}${Math.round(expenseChange)}%`}
                  tone={expenseChange <= 0 ? "positive" : "negative"}
                  icon={expenseChange <= 0 ? TrendingDown : TrendingUp}
                />
              ) : (
                <Metric
                  label="Taxa de poupança"
                  value={indicators.savings_rate == null ? "—" : `${Math.round(number(indicators.savings_rate) * 100)}%`}
                  tone={number(indicators.savings_rate) >= 0 ? "positive" : "negative"}
                />
              )}
            </div>
          </section>

          {highlights.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                <h2 className="text-sm font-semibold">Highlights para mudar o jogo</h2>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {highlights.map((highlight) => (
                  <li key={highlight} className="rounded-xl border border-border/60 bg-secondary/50 px-3 py-2.5 leading-relaxed">{highlight}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">Próximos passos concretos</h2>
                <p className="text-xs text-muted-foreground">Cada ação explica o motivo, o valor envolvido e onde começar.</p>
              </div>
            </div>

            {actions.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                Nenhuma ação prioritária foi identificada neste período. Isso é melhor do que preencher a tela com recomendações genéricas.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {actions.map((action) => {
                  const done = action.status === "done";
                  const impact = number(action.evidence?.estimated_impact);
                  return (
                    <article
                      key={action.key}
                      className={`rounded-xl border p-4 ${done ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={done ? "Ação concluída" : "Marcar como concluída"}
                          disabled={actionMutation.isPending}
                          onClick={() => actionMutation.mutate({ review, key: action.key, status: done ? "in_progress" : "done" })}
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                            done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          }`}
                        >
                          {done ? <Check size={14} /> : <Circle size={12} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-semibold ${done ? "line-through opacity-70" : ""}`}>{action.title}</p>
                            {impact > 0 && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                impacto estimado: {BRL.format(impact)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.detail}</p>
                          <button
                            type="button"
                            onClick={() => navigate(action.route || "/app")}
                            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                          >
                            Abrir dados relacionados <ChevronRight size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {(review.summary.limitations ?? []).length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Como esta revisão foi calculada</p>
              <ul className="mt-2 space-y-1">
                {(review.summary.limitations ?? []).map((item) => <li key={item}>• {item}</li>)}
              </ul>
              <p className="mt-2">Fórmula: {review.formula_version}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
  icon?: typeof TrendingUp;
}) {
  const toneClass = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-amber-700" : "";
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 flex items-center gap-1 text-sm font-bold ${toneClass}`}>
        {Icon && <Icon size={13} />} {value}
      </p>
    </div>
  );
}
