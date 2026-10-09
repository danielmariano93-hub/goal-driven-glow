import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { BehaviorWheel } from "@/components/behavioral/BehaviorWheel";
import { MoneyMoodTimeline } from "@/components/behavioral/MoneyMoodTimeline";
import { ExperimentsBoard } from "@/components/behavioral/ExperimentsBoard";
import { BehavioralInsightsCard } from "@/components/emotions/BehavioralInsightsCard";
import { HabitDiscoveryCard, HabitTrend, MoneyImpactCard, VerdictStrip, WhatChanged } from "@/components/behavioral/EvolutionParts";
import { NextStepCard } from "@/components/behavioral/NextStepCard";
import type { NextStepFallback } from "@/lib/behavioral/nextStep";
import { useOpenWeekendCommitment } from "@/lib/behavioral/weekendCommitment";
import { useContestDimension, useObservedFeedback, useRemoveFeedback } from "@/lib/behavioral/observedFeedback";
import { behaviorHabitsReading, buildHabitDiscovery, DIMENSION_ACTION, moneyImpactOf, weekStartOf } from "@/lib/behavioral/behaviorEvolution";
import { useObservedSnapshots, useSaveObservedSnapshot } from "@/lib/behavioral/observedSnapshots";
import { todayISO } from "@/lib/engine/facts";
import { loadBehavioralEvolutionResilient } from "@/lib/behavioral/resilientClient";
import {
  BEHAVIOR_DIMENSIONS,
  startBehaviorExperiment,
  type BehaviorDimensionKey,
  type BehaviorExperimentTemplate,
} from "@/lib/behavioral/client";
import {
  BEHAVIOR_MAP_CADENCE_DAYS,
  saveBehavioralAssessmentV2,
  type AssessmentCycle,
  type ObservedBehaviorProfile,
} from "@/lib/behavioral/mapCycle";
import {
  loadBehavioralDashboardSnapshot,
  type BehavioralDashboardState,
} from "@/lib/behavioral/dashboardSnapshot";

const EMPTY_OBSERVED: ObservedBehaviorProfile = {
  overallScore: null,
  coverage: 0,
  asOf: null,
  dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((dimension) => [dimension.key, {
    score: null, confidence: "low", evidence: "Ainda não há evidência suficiente.", source: "insufficient_data",
  }])) as ObservedBehaviorProfile["dimensions"],
};

const EMPTY_CYCLE: AssessmentCycle = {
  cadenceDays: BEHAVIOR_MAP_CADENCE_DAYS,
  due: true,
  nextDueAt: null,
  daysRemaining: null,
  questionSetIndex: 0,
  questionSet: "wheel_set_a",
};

async function loadDashboardWithFallback(userId: string): Promise<BehavioralDashboardState> {
  try {
    return await loadBehavioralDashboardSnapshot();
  } catch (error) {
    console.error("[behavior:dashboard:canonical]", error);
    const fallback = await loadBehavioralEvolutionResilient(userId);
    return {
      ...fallback,
      observed: EMPTY_OBSERVED,
      cycle: EMPTY_CYCLE,
      degradedSources: [...new Set([...(fallback.degradedSources ?? []), "canonical_snapshot"])],
    };
  }
}

export default function Emocoes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [experimentBusy, setExperimentBusy] = useState<string | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ["behavioral-dashboard", user?.id],
    enabled: !!user,
    queryFn: () => loadDashboardWithFallback(user!.id),
    staleTime: 10_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const snapshotsQuery = useObservedSnapshots();
  const weekendCommitment = useOpenWeekendCommitment(user?.id, todayISO());
  const feedbackQuery = useObservedFeedback(user?.id, todayISO());
  const contest = useContestDimension(user?.id);
  const removeContest = useRemoveFeedback(user?.id);
  useSaveObservedSnapshot(
    dashboardQuery.data?.observed ?? null,
    !!dashboardQuery.data && dashboardQuery.data.degradedSources.length === 0,
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["behavioral-dashboard"] }),
      qc.invalidateQueries({ queryKey: ["behavioral-evolution"] }),
      qc.invalidateQueries({ queryKey: ["behavioral-map-state"] }),
      qc.invalidateQueries({ queryKey: ["emotional_checkins"] }),
      qc.invalidateQueries({ queryKey: ["emotional-today"] }),
      qc.invalidateQueries({ queryKey: ["nino-context"] }),
    ]);
  };

  const dashboard = dashboardQuery.data;
  const observed = dashboard?.observed ?? EMPTY_OBSERVED;
  const observedMeta = observed as ObservedBehaviorProfile & {
    methodologyVersion?: string;
    overallConfidence?: "low" | "medium" | "high";
    historyDays?: number;
  };
  const cycle = dashboard?.cycle ?? EMPTY_CYCLE;

  async function saveWheel(scores: Record<BehaviorDimensionKey, number>) {
    setAssessmentSaving(true);
    try {
      await saveBehavioralAssessmentV2(scores, observed, cycle.questionSet);
      toast.success("Seu mapa foi atualizado.", { description: `O Nino salvou sua leitura e programou uma nova revisão em ${cycle.cadenceDays} dias.` });
      await refresh();
    } catch (error) {
      console.error("[behavior:assessment]", error);
      toast.error("Não deu para salvar seu mapa agora.");
      throw error;
    } finally { setAssessmentSaving(false); }
  }

  async function startExperiment(template: BehaviorExperimentTemplate) {
    setExperimentBusy(template.slug);
    try {
      await startBehaviorExperiment(template.slug);
      toast.success("Experimento iniciado.", { description: "O Nino vai acompanhar o que for mensurável automaticamente." });
      await refresh();
    } catch (error) {
      console.error("[behavior:experiment:start]", error);
      toast.error("Não deu para iniciar esse experimento agora.");
    } finally { setExperimentBusy(null); }
  }

  if (!user || dashboardQuery.isLoading) {
    return <div className="grid min-h-[45vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!dashboard) {
    return (
      <div className="mx-auto w-full max-w-[820px] pb-24 pt-1">
        <section className="rounded-[24px] border border-border bg-card p-6 text-center shadow-card">
          <p className="text-sm font-semibold">Não foi possível carregar sua evolução agora.</p>
          <button type="button" onClick={() => dashboardQuery.refetch()} className="mt-3 text-sm font-semibold text-primary">Tentar novamente</button>
        </section>
      </div>
    );
  }

  const latest = dashboard.latestAssessment;
  const degraded = dashboard.degradedSources.length > 0;
  const confidence = observedMeta.overallConfidence ?? "low";
  const confidenceLabel = confidence === "high" ? "alta" : confidence === "medium" ? "média" : "baixa";
  const maturing = observed.coverage > 0 && confidence !== "high";

  // Contestações vigentes ("isso não representa minha realidade"): a nota não muda, mas não vira descoberta nem veredito.
  const feedback = feedbackQuery.data ?? {};
  const contested = new Set(Object.keys(feedback) as BehaviorDimensionKey[]);

  // Snapshots anteriores (a semana atual é a leitura de agora, não um ponto de comparação).
  const thisWeek = weekStartOf();
  const { baseline, changes, verdict, series, weeksOfHistory, reconstructedWeeks, baselineReconstructed } = behaviorHabitsReading({
    profile: observed, snapshots: snapshotsQuery.data ?? [], today: todayISO(), thisWeek, degraded, contested,
  });
  const impact = moneyImpactOf(dashboard.emotionSpend);

  // Descoberta (a primeira coisa que a página diz) e a próxima escolha possível.
  const discovery = buildHabitDiscovery({ profile: observed, perception: (latest?.scores as Partial<Record<BehaviorDimensionKey, number>> | undefined) ?? null, changes, contested });
  const weakest = [...changes]
    .filter((c) => c.score != null && c.confidence !== "low" && (c.score as number) < 5)
    .sort((a, b) => (a.score as number) - (b.score as number))[0];
  const nextStepFallback: NextStepFallback = weakest
    ? { ...DIMENSION_ACTION[weakest.key], reason: `${weakest.label} é onde há mais espaço agora (${(weakest.score as number).toFixed(1).replace(".", ",")}). Um passo pequeno aqui costuma mexer mais na sua leitura do que vários ao mesmo tempo.` }
    : null;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-6 pb-24 pt-1">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Evolução</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Seus hábitos com dinheiro</h1>
        <p className="mt-1 max-w-[620px] text-sm leading-relaxed text-muted-foreground">
          O que seus comportamentos revelam, por que importa e onde você pode evoluir.
        </p>
      </header>

      {degraded ? (
        <section className="rounded-[20px] border border-primary/15 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Uma parte da análise está em modo seguro.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Seus registros principais continuam visíveis; a comparação com o passado fica pausada até a leitura completa voltar.</p>
            </div>
            <button type="button" onClick={() => dashboardQuery.refetch()} className="shrink-0 text-[11px] font-semibold text-primary">Atualizar</button>
          </div>
        </section>
      ) : maturing ? (
        <p className="rounded-[20px] border border-primary/15 bg-primary/5 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Leitura em amadurecimento.</strong> Confiança geral {confidenceLabel}{observedMeta.historyDays ? ` com ${observedMeta.historyDays} dias de histórico` : ""}. As notas já servem de sinal, mas podem mudar conforme entram novos dados.
        </p>
      ) : null}

      {dashboard.momentSignal ? (
        <section className="rounded-[22px] border border-brand-coral/25 bg-brand-coral/5 p-4" aria-label="Sinal do momento">
          <p className="text-sm font-semibold">{dashboard.momentSignal.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{dashboard.momentSignal.body}</p>
          <Link to="/app/planejamento" className="mt-2 inline-block text-xs font-semibold text-primary">Antes de comprar</Link>
        </section>
      ) : null}

      <HabitDiscoveryCard discovery={discovery} />

      <BehaviorWheel
        latest={latest}
        previous={dashboard.previousAssessment}
        assessments={dashboard.assessments}
        observed={observed}
        cycle={cycle}
        onSave={saveWheel}
        saving={assessmentSaving}
        baseline={baseline ? { date: baseline.week_start, scores: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, baseline.dimensions[d.key]?.score ?? null])) } : null}
      />

      <NextStepCard commitment={weekendCommitment.data ?? null} fallback={nextStepFallback} />

      <VerdictStrip verdict={verdict} baselineReconstructed={baselineReconstructed} />
      <WhatChanged
        changes={changes}
        hasBaseline={!!baseline}
        feedback={feedback}
        contestBusy={contest.isPending || removeContest.isPending}
        onContest={async (key, input) => {
          const dim = observed.dimensions[key];
          try {
            await contest.mutateAsync({ dimension: key, weekStart: thisWeek, observedScore: dim?.score ?? null, observedConfidence: dim?.confidence ?? null, reason: input.reason, note: input.note });
            toast.success("Anotado.", { description: "O Nino passa a tratar essa nota como incerta por 30 dias." });
          } catch (error) {
            console.error("[behavior:feedback]", error);
            toast.error("Não deu para registrar agora.");
          }
        }}
        onRemoveContest={async (key) => {
          try {
            await removeContest.mutateAsync(key);
            toast.success("Contestação desfeita.");
          } catch (error) {
            console.error("[behavior:feedback:remove]", error);
            toast.error("Não deu para desfazer agora.");
          }
        }}
      />

      <BehavioralInsightsCard hypotheses={dashboard.hypotheses} />

      <MoneyImpactCard impact={impact} />

      {dashboard.activeExperiments.length > 0 ? (
        <div id="experimentos" className="scroll-mt-24">
          <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onChanged={refresh} />
        </div>
      ) : null}

      <div id="checkin" className="scroll-mt-24"><EmotionalCheckinCard /></div>
      <MoneyMoodTimeline snapshot={dashboard} />

      <details className="space-y-3">
        <summary className="cursor-pointer rounded-[22px] border border-border bg-card px-4 py-3 text-sm font-semibold shadow-card">Ver a evolução semana a semana</summary>
        <HabitTrend series={series} changes={changes} weeks={weeksOfHistory} reconstructedWeeks={reconstructedWeeks} />
      </details>

      {dashboard.activeExperiments.length === 0 ? (
        <details id="experimentos" className="scroll-mt-24 rounded-[22px] border border-border bg-card p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-semibold">Experimentos opcionais de 30 dias</summary>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Testes curtos para quem quer mudar um comportamento por vez. Comece por uma escolha pequena do bloco acima; os experimentos servem para aprofundar.</p>
          <div className="mt-3">
            <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onChanged={refresh} />
          </div>
        </details>
      ) : null}

      <p className="text-center text-[10px] text-muted-foreground/70" data-testid="build-marker">
        Versão da tela: {typeof __APP_BUILD_SHA__ === "string" ? __APP_BUILD_SHA__ : "dev"}
        {typeof __APP_BUILD_AT__ === "string" ? ` · publicada em ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(__APP_BUILD_AT__))}` : ""}
      </p>

      <details className="rounded-[22px] border border-border bg-secondary/25 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Como o Nino calcula isso</summary>
        <p className="mt-2">
          Sua percepção vem das respostas do mapa. A leitura observada usa comportamento financeiro, uso do app, metas, reserva e check-ins, sempre com confiança explícita; cada dimensão mostra os componentes e o peso de cada um. Toda semana o Nino guarda essa leitura para comparar com a de agora. A comparação orienta experimentos: não é diagnóstico psicológico e não trata correlação como causa.
        </p>
      </details>
    </div>
  );
}
