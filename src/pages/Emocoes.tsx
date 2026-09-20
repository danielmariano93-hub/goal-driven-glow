import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, Flame, Loader2, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { BehaviorWheel } from "@/components/behavioral/BehaviorWheel";
import { MoneyMoodTimeline } from "@/components/behavioral/MoneyMoodTimeline";
import { ExperimentsBoard } from "@/components/behavioral/ExperimentsBoard";
import { CoachHighlights } from "@/components/behavioral/CoachHighlights";
import { BehavioralInsightsCard } from "@/components/emotions/BehavioralInsightsCard";
import {
  BEHAVIOR_DIMENSIONS,
  loadBehavioralEvolution,
  logBehaviorExperiment,
  saveBehavioralAssessment,
  startBehaviorExperiment,
  type BehaviorDimensionKey,
  type BehaviorExperiment,
  type BehaviorExperimentTemplate,
} from "@/lib/behavioral/client";

export default function Emocoes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [experimentBusy, setExperimentBusy] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["behavioral-evolution", user?.id],
    enabled: !!user,
    queryFn: () => loadBehavioralEvolution(user!.id),
    staleTime: 15_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["behavioral-evolution"] }),
      qc.invalidateQueries({ queryKey: ["emotional_checkins"] }),
      qc.invalidateQueries({ queryKey: ["emotional-today"] }),
      qc.invalidateQueries({ queryKey: ["nino-context"] }),
    ]);
  };

  async function saveWheel(scores: Record<BehaviorDimensionKey, number>) {
    setAssessmentSaving(true);
    try {
      await saveBehavioralAssessment(scores);
      toast.success("Seu mapa foi atualizado.", { description: "As recomendações agora usam essa nova percepção." });
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

  if (query.isLoading) {
    return <div className="grid min-h-[45vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (query.error || !query.data) {
    return (
      <div className="rounded-[24px] border border-border bg-card p-6 text-center">
        <BrainCircuit className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">Não conseguimos carregar sua evolução agora.</p>
        <button type="button" onClick={() => query.refetch()} className="mt-3 text-xs font-semibold text-primary">Tentar novamente</button>
      </div>
    );
  }

  const snapshot = query.data;
  const latest = snapshot.latestAssessment;
  const weakest = snapshot.lowestDimension ? BEHAVIOR_DIMENSIONS.find((dimension) => dimension.key === snapshot.lowestDimension) : null;
  const strongest = snapshot.strongestDimension ? BEHAVIOR_DIMENSIONS.find((dimension) => dimension.key === snapshot.strongestDimension) : null;
  const checkins30 = snapshot.checkins.filter((row) => Date.now() - new Date(row.occurred_at).getTime() <= 30 * 86_400_000).length;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-6 pb-24 pt-1">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Evolução</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Seu dinheiro, seus hábitos.</h1>
        <p className="mt-1 max-w-[620px] text-sm leading-relaxed text-muted-foreground">
          O Nino junta como você se sente, o que realmente acontece nas finanças e pequenos experimentos para ajudar você a mudar sem julgamento.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="mt-2 font-display text-xl font-bold">{latest ? Number(latest.overall_score).toFixed(1) : "—"}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Mapa atual</p>
        </div>
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Flame className="h-4 w-4 text-brand-coral" />
          <p className="mt-2 font-display text-xl font-bold">{checkins30}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Check-ins 30d</p>
        </div>
        <div className="rounded-[20px] border border-border bg-card p-3 shadow-card">
          <Target className="h-4 w-4 text-success" />
          <p className="mt-2 font-display text-xl font-bold">{snapshot.activeExperiments.length}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Experimentos</p>
        </div>
      </section>

      {latest && (weakest || strongest) ? (
        <section className="rounded-[22px] border border-primary/15 bg-gradient-to-br from-primary/7 to-card p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {strongest ? <>Hoje você percebe <strong className="text-foreground">{strongest.label}</strong> como um ponto forte. </> : null}
            {weakest ? <>O Nino vai priorizar experiências pequenas em <strong className="text-foreground">{weakest.label}</strong>, sem transformar isso em cobrança.</> : null}
          </p>
        </section>
      ) : null}

      <EmotionalCheckinCard />
      <MoneyMoodTimeline snapshot={snapshot} />
      <BehaviorWheel latest={snapshot.latestAssessment} previous={snapshot.previousAssessment} onSave={saveWheel} saving={assessmentSaving} />
      <CoachHighlights snapshot={snapshot} />

      <div id="experimentos" className="scroll-mt-24">
        <ExperimentsBoard snapshot={snapshot} busy={experimentBusy} onStart={startExperiment} onLog={logExperiment} />
      </div>

      <BehavioralInsightsCard />

      <section className="rounded-[22px] border border-border bg-secondary/25 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Como o Nino usa isso:</strong> suas notas são autopercepção; lançamentos são fatos; padrões são hipóteses com amostra mínima. O produto não faz diagnóstico psicológico e não trata correlação como causa.
      </section>
    </div>
  );
}
