import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Flame, Loader2, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { BehaviorWheel } from "@/components/behavioral/BehaviorWheel";
import { MoneyMoodTimeline } from "@/components/behavioral/MoneyMoodTimeline";
import { ExperimentsBoard } from "@/components/behavioral/ExperimentsBoard";
import { CoachHighlights } from "@/components/behavioral/CoachHighlights";
import { BehavioralInsightsCard } from "@/components/emotions/BehavioralInsightsCard";
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
  cadenceDays: 30,
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
  const weakest = dashboard.lowestDimension ? BEHAVIOR_DIMENSIONS.find((dimension) => dimension.key === dashboard.lowestDimension) : null;
  const strongest = dashboard.strongestDimension ? BEHAVIOR_DIMENSIONS.find((dimension) => dimension.key === dashboard.strongestDimension) : null;
  const checkins30 = dashboard.checkins.filter((row) => Date.now() - new Date(row.occurred_at).getTime() <= 30 * 86_400_000).length;
  const degraded = dashboard.degradedSources.length > 0;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-6 pb-24 pt-1">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Evolução</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Seu dinheiro, seus hábitos.</h1>
        <p className="mt-1 max-w-[620px] text-sm leading-relaxed text-muted-foreground">
          O Nino junta como você se sente, o que realmente acontece nas finanças e pequenos experimentos para ajudar você a mudar sem julgamento.
        </p>
      </header>

      {degraded ? (
        <section className="rounded-[20px] border border-primary/15 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Uma parte da análise está em modo seguro.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Seus registros principais continuam visíveis; apenas fontes auxiliares indisponíveis ficam sem estimativa.</p>
            </div>
            <button type="button" onClick={() => dashboardQuery.refetch()} className="shrink-0 text-[11px] font-semibold text-primary">Atualizar</button>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="mt-2 font-display text-xl font-bold">{latest ? Number(latest.overall_score).toFixed(1) : "—"}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Sua nota</p>
        </div>
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Eye className="h-4 w-4 text-success" />
          <p className="mt-2 font-display text-xl font-bold">{observed.overallScore == null ? "—" : observed.overallScore.toFixed(1)}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Nino observa · {observed.coverage}/8</p>
        </div>
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Flame className="h-4 w-4 text-brand-coral" />
          <p className="mt-2 font-display text-xl font-bold">{checkins30}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Check-ins 30d</p>
        </div>
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Target className="h-4 w-4 text-primary" />
          <p className="mt-2 font-display text-xl font-bold">{dashboard.activeExperiments.length}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Experimentos</p>
        </div>
      </section>

      {latest && (weakest || strongest) ? (
        <section className="rounded-[22px] border border-primary/15 bg-gradient-to-br from-primary/10 to-card p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {strongest ? <>Hoje você percebe <strong className="text-foreground">{strongest.label}</strong> como um ponto forte. </> : null}
            {weakest ? <>O Nino vai priorizar experiências pequenas em <strong className="text-foreground">{weakest.label}</strong>, sem transformar isso em cobrança.</> : null}
          </p>
        </section>
      ) : null}

      {dashboard.activeExperiments.length > 0 ? (
        <div id="experimentos" className="scroll-mt-24">
          <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onLog={logExperiment} />
        </div>
      ) : null}

      <EmotionalCheckinCard />
      <MoneyMoodTimeline snapshot={dashboard} />
      <BehaviorWheel
        latest={dashboard.latestAssessment}
        previous={dashboard.previousAssessment}
        assessments={dashboard.assessments}
        observed={observed}
        cycle={cycle}
        onSave={saveWheel}
        saving={assessmentSaving}
      />
      <CoachHighlights snapshot={dashboard} />

      {dashboard.activeExperiments.length === 0 ? (
        <div id="experimentos" className="scroll-mt-24">
          <ExperimentsBoard snapshot={dashboard} busy={experimentBusy} onStart={startExperiment} onLog={logExperiment} />
        </div>
      ) : null}

      <BehavioralInsightsCard />

      <section className="rounded-[22px] border border-border bg-secondary/25 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Como o Nino usa isso:</strong> sua nota é autopercepção; a leitura do Nino usa apenas evidências financeiras e histórico de check-ins com cobertura explícita. A comparação serve para orientar experimentos — não é diagnóstico psicológico e não trata correlação como causa.
      </section>
    </div>
  );
}
