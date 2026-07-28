import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Loader2,
  MessageCircle,
  RefreshCw,
  Target,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  loadAdvisorReadiness,
  loadNinoContext,
  requestNinoRefresh,
  updateAdvisorAction,
} from "@/lib/nino/client";
import type { AdvisorReview } from "@/lib/nino/contracts";

function formatBRL(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value ?? 0));
}

export default function AssessorAcompanhamento() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");

  const query = useQuery({
    queryKey: ["nino-context"],
    queryFn: loadNinoContext,
    staleTime: 30_000,
  });

  const review = useMemo(() => {
    const reviews = query.data?.reviews ?? [];
    return reviews
      .filter((item) => item.period_kind === period)
      .sort((a, b) => b.period_start.localeCompare(a.period_start))[0] ?? null;
  }, [period, query.data]);

  const readiness = useQuery({
    queryKey: ["nino-advisor-readiness"],
    queryFn: loadAdvisorReadiness,
    staleTime: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: requestNinoRefresh,
    onSuccess: async () => {
      toast.success("Nino atualizado com seus dados mais recentes.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nino-context"] }),
        queryClient.invalidateQueries({ queryKey: ["nino-advisor-readiness"] }),
      ]);
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
      toast.success("Plano atualizado");
      await queryClient.invalidateQueries({ queryKey: ["nino-context"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-6">
        <p className="text-sm font-semibold">Não foi possível carregar o acompanhamento.</p>
        <p className="mt-1 text-xs text-muted-foreground">{(query.error as Error).message}</p>
      </div>
    );
  }

  const indicators = review?.summary.indicators ?? {};
  const actions = review?.actions ?? [];

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Acompanhamento do Nino</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Revisões objetivas, próximos passos e progresso das decisões financeiras.
        </p>
        <button
          type="button"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold disabled:opacity-60"
        >
          <RefreshCw size={13} className={refreshMutation.isPending ? "animate-spin" : ""} />
          {refreshMutation.isPending ? "Atualizando..." : "Atualizar agora"}
        </button>
        {(readiness.data?.weekly_last_generated_at || readiness.data?.monthly_last_generated_at) && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Última revisão semanal:{" "}
            {readiness.data?.weekly_last_generated_at
              ? new Date(readiness.data.weekly_last_generated_at).toLocaleString("pt-BR")
              : "ainda não gerada"}
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1">
        {([
          ["weekly", "Revisão semanal"],
          ["monthly", "Revisão mensal"],
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
            {readiness.data && !readiness.data.eligible
              ? "Ainda não há dados suficientes para uma revisão honesta"
              : "Sua primeira revisão está sendo preparada"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            O Nino só gera revisões quando os números representam a sua realidade. Nada de indicadores zerados.
          </p>
          {readiness.data && readiness.data.missing.length > 0 && (
            <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-xs text-muted-foreground">
              {readiness.data.missing.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          )}
          <button
            type="button"
            onClick={() => navigate("/app/assessor")}
            className="btn-brand mt-4 inline-flex items-center gap-2"
          >
            <MessageCircle size={15} /> Conversar com o Nino
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-5 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {new Date(`${review.period_start}T12:00:00`).toLocaleDateString("pt-BR")}
              {" a "}
              {new Date(`${review.period_end}T12:00:00`).toLocaleDateString("pt-BR")}
            </p>
            <h2 className="mt-2 text-lg font-bold">{review.summary.headline}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {review.summary.explanation}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Renda média" value={formatBRL(indicators.estimated_income)} />
              <Metric label="Folga estimada" value={formatBRL(indicators.savings_capacity)} />
              <Metric label="Patrimônio" value={formatBRL(indicators.net_worth)} />
              <Metric
                label="Taxa de poupança"
                value={`${Math.round(Number(indicators.savings_rate ?? 0) * 100)}%`}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">Próximos passos</h2>
                <p className="text-xs text-muted-foreground">Marque o andamento para o Nino acompanhar.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {actions.map((action) => {
                const done = action.status === "done";
                return (
                  <article
                    key={action.key}
                    className={`rounded-xl border p-4 ${
                      done ? "border-primary/30 bg-primary/5" : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        aria-label={done ? "Ação concluída" : "Marcar como concluída"}
                        disabled={actionMutation.isPending}
                        onClick={() => actionMutation.mutate({
                          review,
                          key: action.key,
                          status: done ? "in_progress" : "done",
                        })}
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                          done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {done ? <Check size={14} /> : <Circle size={12} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${done ? "line-through opacity-70" : ""}`}>
                          {action.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.detail}</p>
                        <button
                          type="button"
                          onClick={() => navigate(action.route || "/app")}
                          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                        >
                          Ver no app <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
