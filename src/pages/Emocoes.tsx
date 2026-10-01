import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { BehaviorWheel } from "@/components/behavioral/BehaviorWheel";
import { MoneyMoodTimeline } from "@/components/behavioral/MoneyMoodTimeline";
import { ExperimentsBoard } from "@/components/behavioral/ExperimentsBoard";
import { CoachHighlights } from "@/components/behavioral/CoachHighlights";
import { BehavioralInsightsCard } from "@/components/emotions/BehavioralInsightsCard";
import { BehaviorVerdictCard, HabitTrend, MoneyImpactCard, WhatChanged } from "@/components/behavioral/EvolutionParts";
import { buildBehaviorVerdict, compareDimensions, habitSeries, moneyImpactOf, pickBaseline, weekStartOf } from "@/lib/behavioral/behaviorEvolution";
import { useObservedSnapshots, useSaveObservedSnapshot } from "@/lib/behavioral/observedSnapshots";
import { todayISO } from "@/lib/engine/facts";
import { loadBehavioralEvolutionResilient } from "@/lib/behavioral/resilientClient";
import {
  BEHAVIOR_DIMENSIONS,
  logBehaviorExperiment,
  startBehaviorExperiment,
  type BehaviorDimensionKey,
  type BehaviorExperiment,
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

  async function logExperiment(experiment: BehaviorExperiment) {
    setExperimentBusy(experiment.id);
    try {
      const updated = await logBehaviorExperiment(experiment.id);
      toast.success(Number(updated.progress) >= 100 ? "Experimento concluído!" : "Ação registrada.");
      await refresh();
    } catch (error) {
      console.error("[behavior:experiment:log]", error);
      toast.error("Não deu para registrar essa ação agora.");
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

  // Snapshots anteriores (a semana atual é a leitura de agora, não um ponto de comparação).
  const thisWeek = weekStartOf();
  const history = (snapshotsQuery.data ?? []).filter((row) => row.week_start < thisWeek);
  const baseline = degraded ? null : pickBaseline(history, todayISO());
  const changes = compareDimensions(observed, baseline);
  const verdict = buildBehaviorVerdict(changes, baseline, observed.overallScore);
  const series = habitSeries(history, observed, thisWeek);
  const weeksOfHistory = new Set([...history.map((row) => row.week_start), thisWeek]).size;
  const impact = moneyImpactOf(dashboard.emotionSpend);

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-6 pb-24 pt-1">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Evolução</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Seus hábitos com dinheiro</h1>
        <p className="mt-1 max-w-[620px] text-sm leading-relaxed text-muted-foreground">
          O que melhorou, o que piorou, por quê e quanto isso pesa no seu bolso.
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

      <BehaviorVerdictCard verdict={verdict} overall={observed.overallScore} moodTrend14={dashboard.moodTrend14} />

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

      <WhatChanged changes={changes} hasBaseline={!!baseline} />
      <HabitTrend series={series} changes={changes} weeks={weeksOfHistory} reconstructedWeeks={history.filter((row) => row.methodology_version === "behavior_observed.v2_backfill").length} />
      <MoneyImpactCard impact={impact} />

      {dashboard.activeExperiments.length > 0 ? (
        <div id="experimentos" className="scroll-mt-24">
          <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onLog={logExperiment} />
        </div>
      ) : null}

      <div id="checkin" className="scroll-mt-24"><EmotionalCheckinCard /></div>
      <MoneyMoodTimeline snapshot={dashboard} />

      {dashboard.activeExperiments.length === 0 ? (
        <div id="experimentos" className="scroll-mt-24">
          <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onLog={logExperiment} />
        </div>
      ) : null}

      <CoachHighlights snapshot={dashboard} />
      <BehavioralInsightsCard hypotheses={dashboard.hypotheses} />

      <details className="rounded-[22px] border border-border bg-secondary/25 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Como o Nino calcula isso</summary>
        <p className="mt-2">
          Sua percepção vem das respostas do mapa. A leitura observada usa comportamento financeiro, uso do app, metas, reserva e check-ins, sempre com confiança explícita; cada dimensão mostra os componentes e o peso de cada um. Toda semana o Nino guarda essa leitura para comparar com a de agora. A comparação orienta experimentos: não é diagnóstico psicológico e não trata correlação como causa.
        </p>
      </details>
    </div>
  );
}
