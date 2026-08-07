import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowsClockwise, CheckCircle, SpinnerGap, ThumbsDown, ThumbsUp, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { useNinoSituationFeedback, type FinancialSituationAction, type HomeDiagnosisView, type NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import { buildHomeGuidancePresentation } from "@/lib/nino/homeGuidance";
import { buildNinoReadingQueue } from "@/lib/nino/rotation";
import { diagnosisActionLabel, diagnosisRouteForSituation } from "@/lib/nino/actions";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";

type Props = {
  diagnosis: HomeDiagnosisView | null;
  context?: NinoDiagnosisContext | null;
  projection: SpendingProjection | null;
  loading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
  projectionAvailability?: "available" | "partial" | "unavailable";
};

/** Leituras já respondidas hoje não voltam a aparecer (cooldown local espelha o backend). */
function storageKey() {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return `nino-answered-${day}`;
}

function readAnswered(): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistAnswered(ids: string[]) {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(ids.slice(-50)));
  } catch {
    /* storage indisponível não pode quebrar a Home */
  }
}

export function NinoGuidanceCard({ diagnosis, context, projection, loading, error, retrying, onRetry, projectionAvailability = "available" }: Props) {
  const feedback = useNinoSituationFeedback();
  const [answered, setAnswered] = useState<string[]>(() => readAnswered());
  const [index, setIndex] = useState(0);
  const [savingFeedback, setSavingFeedback] = useState<null | "useful" | "not_useful">(null);
  const [noMoreReadings, setNoMoreReadings] = useState(false);

  const queue = useMemo(
    () => (context ? buildNinoReadingQueue(context, { suppressedIds: answered }) : []),
    [context, answered],
  );

  useEffect(() => {
    if (index > 0 && index >= queue.length) setIndex(Math.max(0, queue.length - 1));
  }, [index, queue.length]);

  const reading = queue[index] ?? null;
  // O fallback só existe quando o endpoint de contexto não respondeu. Quando
  // há contexto e o usuário já avaliou a principal, recolocá-la aqui anulava
  // a rotação e deixava o card permanentemente preso na mesma mensagem.
  const fallbackItem = context ? null : diagnosis?.primary ?? null;
  const item = reading?.situation ?? fallbackItem;

  const derivedAction = useMemo<FinancialSituationAction | null>(() => {
    if (!reading) return null;
    const isPrimary = diagnosis?.primary && reading.situation.id === diagnosis.primary.id;
    if (isPrimary) return diagnosis?.hasTrustedAction ? diagnosis.action : null;
    const title = diagnosisActionLabel(reading.situation, reading.action);
    if (!title) return null;
    return {
      id: `derived-${reading.situation.id}`,
      situation_id: reading.situation.id,
      action_type: "review",
      title,
      explanation: null,
      estimated_impact: null,
      route: diagnosisRouteForSituation(reading.situation, reading.action),
      priority: 0,
      status: "proposed",
    } as FinancialSituationAction;
  }, [reading, diagnosis]);

  const presentation = diagnosis
    ? buildHomeGuidancePresentation(
        diagnosis,
        projectionAvailability,
        reading ? { situation: reading.situation, action: derivedAction } : null,
      )
    : null;

  const advance = useCallback((situationId: string) => {
    setAnswered((prev) => {
      const next = prev.includes(situationId) ? prev : [...prev, situationId];
      persistAnswered(next);
      return next;
    });
    setNoMoreReadings(false);
    setIndex(0);
  }, []);

  const sendFeedback = useCallback(async (value: "useful" | "not_useful") => {
    if (!item) return;
    setSavingFeedback(value);
    try {
      await feedback.mutateAsync({ situationId: item.id, feedback: value, surface: "home" });
      notifySuccess(value === "useful" ? "Boa, vou priorizar leituras assim." : "Entendi, vou mostrar outra leitura.");
      advance(item.id);
    } catch (e) {
      notifyError("Não consegui salvar seu feedback agora.", e instanceof Error ? e.message : undefined);
    } finally {
      setSavingFeedback(null);
    }
  }, [advance, feedback, item]);

  const showNext = useCallback(() => {
    if (index + 1 < queue.length) {
      setNoMoreReadings(false);
      setIndex(index + 1);
      return;
    }
    setNoMoreReadings(true);
  }, [index, queue.length]);

  const action = presentation?.action ?? null;
  const critical = presentation?.severity === "critical";
  const attention = presentation?.severity === "attention";
  const Icon = critical || attention ? Warning : CheckCircle;
  const accent = critical ? "bg-destructive" : attention ? "bg-warning" : "bg-primary";
  const hasNext = index + 1 < queue.length;

  if (loading) return <section aria-label="Orientação do Nino" aria-busy="true" className="min-h-[82px] animate-pulse rounded-[18px] border border-border bg-card p-3.5"><div className="h-3 w-24 rounded bg-secondary" /><div className="mt-2 h-4 w-3/4 rounded bg-secondary" /></section>;
  if (error) return <section aria-label="Orientação do Nino" className="rounded-[18px] border border-border bg-card p-4"><NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} /></section>;
  if (!item || !presentation) return <section aria-label="Orientação do Nino" className="relative overflow-hidden rounded-[18px] border border-border bg-card p-3.5 pl-5"><span className="absolute inset-y-0 left-0 w-[3px] bg-warning" aria-hidden="true" /><p className="text-[10px] font-semibold text-primary">Orientação do Nino</p><h2 className="mt-1 font-display text-[15px] font-bold leading-5 text-foreground">{context && answered.length > 0 ? "Você já viu as leituras de hoje" : "Ainda estou formando uma leitura segura"}</h2><p className="mt-0.5 text-[12px] leading-[17px] text-muted-foreground">{context && answered.length > 0 ? "Novas leituras aparecem quando seus dados mudarem ou no próximo ciclo." : "Com mais movimentações, consigo explicar o que mudou sem tirar conclusões apressadas."}</p></section>;
  return (
    <section aria-label="Orientação do Nino" aria-live="polite" className="relative overflow-hidden rounded-[18px] border border-border bg-card p-3.5 pl-5 animate-fade-in">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-2"><Icon size={16} className={critical ? "text-destructive" : attention ? "text-warning" : "text-primary"} weight="duotone" /><p className="text-[11px] font-semibold text-foreground">Orientação do Nino</p><span className="sr-only">{critical ? "Crítico" : attention ? "Atenção" : "Informativo"}</span></div>
      <h2 className="mt-1 font-display text-[15px] font-bold leading-5 text-foreground">{presentation.title}</h2>
      {presentation.supportingText ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-muted-foreground">{presentation.supportingText}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-border pt-1.5">
        {action ? <Button asChild variant="ghost" size="sm" className="mr-auto h-8 px-0 text-[12px] text-primary"><Link to={action.route} onClick={() => feedback.mutate({ situationId: item.id, feedback: "acted", surface: "home" })}>{action.title}<ArrowRight weight="bold" /></Link></Button> : <span className="mr-auto" />}
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px] text-muted-foreground" disabled={savingFeedback !== null} onClick={() => void sendFeedback("useful")} aria-label="Marcar esta leitura como útil">
          {savingFeedback === "useful" ? <SpinnerGap className="animate-spin" /> : <ThumbsUp weight="duotone" />} Útil
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px] text-muted-foreground" disabled={savingFeedback !== null} onClick={() => void sendFeedback("not_useful")} aria-label="Marcar esta leitura como não útil">
          {savingFeedback === "not_useful" ? <SpinnerGap className="animate-spin" /> : <ThumbsDown weight="duotone" />} Não ajudou
        </Button>
        {hasNext ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px] text-muted-foreground" onClick={showNext} aria-label="Ver outra leitura do Nino">
            <ArrowsClockwise weight="duotone" /> Ver outra leitura
          </Button>
        ) : null}
        {noMoreReadings && !hasNext ? <span className="px-1 text-[10px] text-muted-foreground">Sem outras leituras agora.</span> : null}
      </div>
      {retrying ? <span className="sr-only"><SpinnerGap className="animate-spin" />Atualizando leitura</span> : null}
    </section>
  );
}
