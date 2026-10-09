import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Compass, Footprints, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { HabitsWheel } from "@/components/habits/HabitsWheel";
import { EmotionAssociationCard } from "@/components/habits/EmotionAssociationCard";
import { PatternCard } from "@/components/habits/PatternCard";
import { logInsightEvent, useContextAnswerMutations, useContextAnswers, useHabitPatterns, useLimitDecision } from "@/lib/behavioral/habitPatterns";
import { dimensionSubject, patternSubject, type PatternAnswerKey } from "../../supabase/functions/_shared/proactive/habitContext";
import type { FeedbackAnswer } from "@/components/habits/DimensionPanel";
import { MoneyMoodTimeline } from "@/components/behavioral/MoneyMoodTimeline";
import { HabitTrend } from "@/components/behavioral/EvolutionParts";
import { useContestDimension, useObservedFeedback, useRemoveFeedback } from "@/lib/behavioral/observedFeedback";
import { behaviorHabitsReading, buildHabitDiscovery, moneyImpactOf, weekStartOf, type HabitDiscovery } from "@/lib/behavioral/behaviorEvolution";
import { useObservedSnapshots, useSaveObservedSnapshot } from "@/lib/behavioral/observedSnapshots";
import { todayISO } from "@/lib/engine/facts";
import { loadBehavioralEvolutionResilient } from "@/lib/behavioral/resilientClient";
import { BEHAVIOR_DIMENSIONS, type BehaviorDimensionKey } from "@/lib/behavioral/client";
import { BEHAVIOR_MAP_CADENCE_DAYS, saveBehavioralAssessmentV2, type AssessmentCycle, type ObservedBehaviorProfile } from "@/lib/behavioral/mapCycle";
import { loadBehavioralDashboardSnapshot, type BehavioralDashboardState } from "@/lib/behavioral/dashboardSnapshot";

const EMPTY_OBSERVED: ObservedBehaviorProfile = {
  overallScore: null,
  coverage: 0,
  asOf: null,
  dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, {
    score: null, confidence: "low", evidence: "Ainda não sei: sem dados suficientes.", source: "insufficient_data", state: "none",
  }])) as ObservedBehaviorProfile["dimensions"],
};

const EMPTY_CYCLE: AssessmentCycle = { cadenceDays: BEHAVIOR_MAP_CADENCE_DAYS, due: true, nextDueAt: null, daysRemaining: null, questionSetIndex: 0, questionSet: "wheel_set_a" };

async function loadDashboard(userId: string): Promise<BehavioralDashboardState> {
  try {
    return await loadBehavioralDashboardSnapshot({ v3: true });
  } catch (error) {
    console.error("[habits:v2:dashboard]", error);
    const fallback = await loadBehavioralEvolutionResilient(userId);
    return { ...fallback, observed: EMPTY_OBSERVED, cycle: EMPTY_CYCLE, degradedSources: [...new Set([...(fallback.degradedSources ?? []), "canonical_snapshot"])] };
  }
}

/** Ação possível por dimensão. Nada de desafios de 14/30 dias: um passo pequeno, no lugar certo. */
const NEXT_ACTION: Partial<Record<BehaviorDimensionKey, { label: string; to: string; ask: string }>> = {
  awareness: { label: "Fazer um check-in", to: "#checkin", ask: "Um check-in de 30 segundos ajuda o Nino a entender melhor como você se sente com o dinheiro." },
  planning: { label: "Ver minhas metas", to: "/app/metas", ask: "Rever uma meta que já existe costuma render mais do que criar outra." },
  control: { label: "Ver minhas metas", to: "/app/metas", ask: "Se algum limite não faz sentido para a sua rotina, ajustá-lo é melhor do que deixá-lo estourar." },
  consistency: { label: "Fazer um check-in", to: "#checkin", ask: "Registrar de vez em quando já mostra ao Nino o seu ritmo." },
  security: { label: "Ver reserva e investimentos", to: "/app/investimentos", ask: "Marcar qual investimento é a sua reserva deixa a leitura de segurança mais fiel." },
  wealth: { label: "Ver investimentos", to: "/app/investimentos", ask: "Conferir se os seus aportes estão todos lançados deixa esta leitura mais fiel." },
  calm: { label: "Fazer um check-in", to: "#checkin", ask: "Contar como foi o dia ajuda a separar o que é fase do que é padrão." },
  debt: { label: "Ver minhas dívidas", to: "/app/dividas", ask: "Olhar o plano de pagamento é um passo pequeno e reversível." },
};

function DiscoveryHero({ discovery, onOpen }: { discovery: HabitDiscovery; onOpen: (key: BehaviorDimensionKey) => void }) {
  return (
    <section aria-label="A principal descoberta" className="rounded-[26px] border border-primary/25 bg-primary/5 p-5 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-primary"><Compass size={13} aria-hidden /> O que o Nino descobriu</p>
      <h2 className="mt-2 font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">{discovery.title}</h2>
      {discovery.kind === "perception_gap" && discovery.self != null && discovery.observed != null ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-card/80 p-2.5"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Como você se vê</dt><dd className="mt-0.5 font-display text-2xl font-bold tabular-nums">{discovery.self.toFixed(1).replace(".", ",")}</dd></div>
          <div className="rounded-2xl bg-card/80 p-2.5"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">O que os registros mostram</dt><dd className="mt-0.5 font-display text-2xl font-bold tabular-nums">{discovery.observed.toFixed(1).replace(".", ",")}</dd></div>
        </dl>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{discovery.body}</p>
      {discovery.dimension ? (
        <button type="button" onClick={() => onOpen(discovery.dimension!)} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">
          Ver como o Nino chegou a essa leitura <ArrowRight size={14} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

export default function HabitsV2() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<BehaviorDimensionKey | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ["behavioral-dashboard", "v3", user?.id],
    enabled: !!user,
    queryFn: () => loadDashboard(user!.id),
    staleTime: 10_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const patternsQuery = useHabitPatterns();
  const limitDecision = useLimitDecision();
  const contextAnswers = useContextAnswers(todayISO());
  const ctx = useContextAnswerMutations();
  const snapshotsQuery = useObservedSnapshots();
  const feedbackQuery = useObservedFeedback(user?.id, todayISO());
  const contest = useContestDimension(user?.id);
  const removeContest = useRemoveFeedback(user?.id);
  useSaveObservedSnapshot(dashboardQuery.data?.observed ?? null, !!dashboardQuery.data && dashboardQuery.data.degradedSources.length === 0);

  // Âncora "#checkin": abre a camada de detalhes antes de rolar.
  useEffect(() => {
    const onHash = () => { if (window.location.hash === "#checkin") setDetailsOpen(true); };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!user || dashboardQuery.isLoading) {
    return <div className="grid min-h-[45vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  const dashboard = dashboardQuery.data;
  if (!dashboard) {
    return (
      <div className="mx-auto w-full max-w-[820px] pb-24 pt-1">
        <section className="rounded-[24px] border border-border bg-card p-6 text-center shadow-card">
          <p className="text-sm font-semibold">Não foi possível carregar seus hábitos agora.</p>
          <button type="button" onClick={() => dashboardQuery.refetch()} className="mt-3 text-sm font-semibold text-primary">Tentar novamente</button>
        </section>
      </div>
    );
  }

  const observed = dashboard.observed;
  const cycle = dashboard.cycle ?? EMPTY_CYCLE;
  const latest = dashboard.latestAssessment;
  const degraded = dashboard.degradedSources.length > 0;
  const feedback = feedbackQuery.data ?? {};
  const contested = new Set(Object.keys(feedback) as BehaviorDimensionKey[]);
  const thisWeek = weekStartOf();
  const { baseline, changes, series, weeksOfHistory, reconstructedWeeks } = behaviorHabitsReading({
    profile: observed, snapshots: snapshotsQuery.data ?? [], today: todayISO(), thisWeek, degraded, contested,
  });
  const notComparable = new Set(changes.filter((c) => c.notComparable).map((c) => c.key));
  const discovery = buildHabitDiscovery({
    profile: observed, perception: (latest?.scores as Partial<Record<BehaviorDimensionKey, number>> | undefined) ?? null, changes, contested,
  });

  const weakest = BEHAVIOR_DIMENSIONS
    .map((d) => ({ key: d.key, label: d.label, dim: observed.dimensions[d.key] }))
    .filter((r) => r.dim?.state === "sufficient" && r.dim.score != null && r.dim.confidence !== "low" && (r.dim.score as number) < 5 && !contested.has(r.key))
    .sort((a, b) => (a.dim.score as number) - (b.dim.score as number))[0];
  const action = weakest ? NEXT_ACTION[weakest.key] : undefined;

  const selectDimension = (key: BehaviorDimensionKey | null) => {
    setSelected(key);
    if (key) logInsightEvent(`dimension:${key}`, "dimension_opened", { state: observed.dimensions[key]?.state ?? null });
  };
  const openDimension = (key: BehaviorDimensionKey) => {
    selectDimension(key);
    window.setTimeout(() => document.getElementById(`dimensao-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["behavioral-dashboard"] }),
      qc.invalidateQueries({ queryKey: ["behavioral-evolution"] }),
      qc.invalidateQueries({ queryKey: ["emotional_checkins"] }),
      qc.invalidateQueries({ queryKey: ["emotional-today"] }),
    ]);
  };

  async function saveMap(scores: Record<BehaviorDimensionKey, number>) {
    setSaving(true);
    try {
      await saveBehavioralAssessmentV2(scores, observed, cycle.questionSet);
      toast.success("Seu mapa foi atualizado.");
      await refresh();
    } catch (error) {
      console.error("[habits:v2:assessment]", error);
      toast.error("Não deu para salvar seu mapa agora.");
      throw error;
    } finally { setSaving(false); }
  }

  async function answer(key: BehaviorDimensionKey, a: FeedbackAnswer) {
    const dim = observed.dimensions[key];
    try {
      await contest.mutateAsync({ dimension: key, weekStart: thisWeek, observedScore: dim?.score ?? null, observedConfidence: dim?.score != null ? dim.confidence : null, reason: a.reason, note: a.note, verdict: a.verdict });
      toast.success(a.verdict === "yes" ? "Anotado, obrigado." : "Anotado.", { description: a.verdict === "yes" ? undefined : "O Nino passa a tratar essa leitura como incerta por 30 dias." });
    } catch (error) {
      console.error("[habits:v2:feedback]", error);
      toast.error("Não deu para registrar agora.");
    }
  }

  async function removeAnswer(key: BehaviorDimensionKey) {
    try { await removeContest.mutateAsync(key); toast.success("Resposta desfeita."); }
    catch (error) { console.error("[habits:v2:feedback:remove]", error); toast.error("Não deu para desfazer agora."); }
  }

  // Fluxo principal: no máximo 2 descobertas no total (AC-06): até 2 padrões; sem padrão, a leitura da roda ocupa o lugar do primeiro.
  const patterns = patternsQuery.data?.shown ?? [];
  const mainPattern = patterns[0] ?? null;
  const secondPattern = patterns[1] ?? null;
  const patternBusy = limitDecision.accept.isPending || limitDecision.decline.isPending || ctx.answer.isPending || ctx.clear.isPending;
  const failToast = (error: unknown, tag: string) => { console.error(`[habits:v2:${tag}]`, error); toast.error("Não deu para registrar agora."); };
  const renderPattern = (pattern: (typeof patterns)[number]) => (
    <PatternCard
      key={pattern.id}
      pattern={pattern}
      commitments={patternsQuery.data?.commitments ?? {}}
      busy={patternBusy}
      onAnswer={async (categories: string[], key: PatternAnswerKey) => {
        try { await ctx.answer.mutateAsync({ subjects: categories.map(patternSubject), question: "planned_vs_spontaneous", answers: [key] }); }
        catch (error) { failToast(error, "context:answer"); }
      }}
      onClearAnswer={async (categories: string[]) => {
        try { await ctx.clear.mutateAsync({ subjects: categories.map(patternSubject), question: "planned_vs_spontaneous" }); }
        catch (error) { failToast(error, "context:clear"); }
      }}
      onAccept={async (suggestion, target) => {
        try {
          await limitDecision.accept.mutateAsync({ suggestion, target });
          logInsightEvent(pattern.id, "accepted", { category: suggestion.category, target });
          toast.success("Combinado registrado.", { description: "Na segunda o Nino conta como foi." });
        } catch (error) { failToast(error, "limit:accept"); }
      }}
      onDecline={async (suggestion) => {
        try { await limitDecision.decline.mutateAsync({ category: suggestion.category, friday: suggestion.friday }); logInsightEvent(pattern.id, "declined", { category: suggestion.category }); }
        catch (error) { failToast(error, "limit:decline"); }
      }}
      onUndo={async (suggestion) => {
        try { await limitDecision.decline.mutateAsync({ category: suggestion.category, friday: suggestion.friday }); logInsightEvent(pattern.id, "undone", { category: suggestion.category }); toast.success("Combinado desfeito."); }
        catch (error) { failToast(error, "limit:undo"); }
      }}
    />
  );
  const hasPatternAction = patterns.some((p) => p.actions.length > 0 || p.skip_actions.length > 0);

  // Medições diretas × estimativas antigas (só um resumo; o gráfico fica sob demanda).
  const since30 = Date.now() - 30 * 86_400_000;
  const recentCheckins = (dashboard.checkins ?? []).filter((c) => new Date(c.occurred_at).getTime() >= since30);
  const directCount = recentCheckins.filter((c) => c.financial_calm_score != null).length;
  const estimatedCount = recentCheckins.length - directCount;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5 pb-24 pt-1" data-habits-v2>
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Seus hábitos com dinheiro</h1>
      </header>

      {degraded ? (
        <p className="rounded-[20px] border border-primary/15 bg-primary/5 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Uma parte da análise está em modo seguro; a comparação com o passado fica pausada até a leitura completa voltar.{" "}
          <button type="button" onClick={() => dashboardQuery.refetch()} className="font-semibold text-primary">Atualizar</button>
        </p>
      ) : null}

      {/* A principal descoberta é um comportamento recorrente quando há um; senão, a leitura da roda. */}
      {mainPattern ? (
        <section aria-label="A principal descoberta" className="space-y-1">
          <p className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary"><Compass size={13} aria-hidden /> O que o Nino descobriu</p>
          {renderPattern(mainPattern)}
        </section>
      ) : (
        <DiscoveryHero discovery={discovery} onOpen={openDimension} />
      )}

      <HabitsWheel
        selected={selected}
        onSelect={selectDimension}
        weighsFor={(key) => contextAnswers.data?.get(`${dimensionSubject(key)}|what_weighs`) ?? null}
        onWeighs={async (key, keys) => {
          try { await ctx.answer.mutateAsync({ subjects: [dimensionSubject(key)], question: "what_weighs", answers: keys }); logInsightEvent(`dimension:${key}`, "dimension_answered", { n: keys.length }); toast.success("Anotado."); }
          catch (error) { failToast(error, "context:weighs"); }
        }}
        onClearWeighs={async (key) => {
          try { await ctx.clear.mutateAsync({ subjects: [dimensionSubject(key)], question: "what_weighs" }); }
          catch (error) { failToast(error, "context:weighs:clear"); }
        }}
        latest={latest}
        observed={observed}
        cycle={cycle}
        onSaveMap={saveMap}
        saving={saving}
        baseline={baseline ? { date: baseline.week_start, scores: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, baseline.dimensions[d.key]?.score ?? null])) } : null}
        notComparable={notComparable}
        feedback={feedback}
        feedbackBusy={contest.isPending || removeContest.isPending}
        onAnswer={answer}
        onRemoveFeedback={removeAnswer}
      />

      {secondPattern ? (
        <section aria-label="Outro padrão relevante" className="space-y-1">
          <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Outro padrão relevante</p>
          {renderPattern(secondPattern)}
        </section>
      ) : null}

      {weakest && action && !hasPatternAction ? (
        <section aria-label="Uma ação possível" className="rounded-[26px] border border-border bg-card p-5 shadow-card">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><Footprints size={13} aria-hidden /> Se quiser, um passo pequeno</p>
          <p className="mt-2 text-sm leading-relaxed">
            {discovery.dimension === weakest.key
              ? action.ask
              : <><strong>{weakest.label}</strong> também merece um olhar — {weakest.dim.record?.observed[0]?.replace(/\.$/, "") ?? weakest.dim.evidence.replace(/\.$/, "")}. {action.ask}</>}
          </p>
          {action.to.startsWith("#")
            ? <button type="button" onClick={() => { setDetailsOpen(true); window.setTimeout(() => document.getElementById("checkin")?.scrollIntoView({ behavior: "smooth" }), 80); }} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></button>
            : <Link to={action.to} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></Link>}
        </section>
      ) : null}

      <details open={detailsOpen} onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-[22px] border border-border bg-card shadow-card">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-semibold">
          Histórico e análises detalhadas
        </summary>
        <div className="space-y-5 border-t border-border p-4">
          <div id="checkin" className="scroll-mt-24"><EmotionalCheckinCard /></div>
          <EmotionAssociationCard impact={moneyImpactOf(dashboard.emotionSpend)} onAskContext={() => document.getElementById("checkin")?.scrollIntoView({ behavior: "smooth" })} />
          <details className="rounded-[22px] border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-semibold">Histórico dos seus registros de tranquilidade</summary>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Nos últimos 30 dias: {directCount} {directCount === 1 ? "medição direta" : "medições diretas"} (você informou) e {estimatedCount} {estimatedCount === 1 ? "estimativa" : "estimativas"} de registros antigos. As estimativas não entram na nota.
            </p>
            <div className="mt-3"><MoneyMoodTimeline snapshot={dashboard} /></div>
          </details>
          <HabitTrend series={series} changes={changes} weeks={weeksOfHistory} reconstructedWeeks={reconstructedWeeks} />
          <div className="rounded-2xl bg-secondary/25 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Como o Nino lê isso</p>
            <p className="mt-1">Uma nota só aparece quando há evidência suficiente; com base parcial o Nino mostra o que viu, sem nota, e sem dados diz “ainda não sei”. Abrir telas do app não conta como hábito. As leituras são associações, não diagnóstico: o Nino não deduz emoção nem causa a partir de extratos. Método {observed.methodologyVersion ?? "behavior_observed.v3"}.</p>
          </div>
        </div>
      </details>

      <p className="text-center text-[10px] text-muted-foreground/70" data-testid="build-marker">
        Versão da tela: {typeof __APP_BUILD_SHA__ === "string" ? __APP_BUILD_SHA__ : "dev"} · hábitos v2
      </p>
    </div>
  );
}
