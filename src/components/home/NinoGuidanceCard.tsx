import { ArrowRight, CheckCircle, SpinnerGap, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { useNinoSituationFeedback, type HomeDiagnosisView } from "@/lib/nino/diagnosis";
import { buildHomeGuidancePresentation } from "@/lib/nino/homeGuidance";

type Props = {
  diagnosis: HomeDiagnosisView | null;
  projection: SpendingProjection | null;
  loading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
  projectionAvailability?: "available" | "partial" | "unavailable";
};

export function NinoGuidanceCard({ diagnosis, projection, loading, error, retrying, onRetry, projectionAvailability = "available" }: Props) {
  const feedback = useNinoSituationFeedback();
  const item = diagnosis?.primary ?? null;
  const presentation = diagnosis ? buildHomeGuidancePresentation(diagnosis, projectionAvailability) : null;
  const action = presentation?.action ?? null;
  const critical = presentation?.severity === "critical";
  const attention = presentation?.severity === "attention";
  const Icon = critical || attention ? Warning : CheckCircle;
  const accent = critical ? "bg-destructive" : attention ? "bg-warning" : "bg-primary";

  if (loading) return <section aria-label="Orientação do Nino" aria-busy="true" className="min-h-[96px] animate-pulse rounded-[18px] border border-border bg-card p-4"><div className="h-3 w-24 rounded bg-secondary" /><div className="mt-3 h-4 w-3/4 rounded bg-secondary" /></section>;
  if (error) return <section aria-label="Orientação do Nino" className="rounded-[18px] border border-border bg-card p-4"><NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} /></section>;
  if (!item || !presentation) return <section aria-label="Orientação do Nino" className="relative overflow-hidden rounded-[18px] border border-border bg-card p-4 pl-5"><span className="absolute inset-y-0 left-0 w-[3px] bg-warning" aria-hidden="true" /><p className="text-[11px] font-semibold text-primary">Orientação do Nino</p><h2 className="mt-1.5 font-display text-base font-bold leading-5 text-foreground">Ainda estou formando uma leitura segura</h2><p className="mt-1 text-[13px] leading-[19px] text-muted-foreground">Com mais movimentações, consigo explicar o que mudou sem tirar conclusões apressadas.</p></section>;
  return (
    <section aria-label="Orientação do Nino" className="relative overflow-hidden rounded-[18px] border border-border bg-card p-4 pl-5 animate-fade-in">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-2"><Icon size={16} className={critical ? "text-destructive" : attention ? "text-warning" : "text-primary"} weight="duotone" /><p className="text-[11px] font-semibold text-foreground">Orientação do Nino</p><span className="sr-only">{critical ? "Crítico" : attention ? "Atenção" : "Informativo"}</span></div>
      <h2 className="mt-1.5 font-display text-base font-bold leading-5 text-foreground">{presentation.title}</h2>
      {presentation.supportingText ? <p className="mt-1 line-clamp-2 text-[13px] leading-[19px] text-muted-foreground">{presentation.supportingText}</p> : null}
      {action ? <Button asChild variant="ghost" size="sm" className="mt-1 min-h-10 px-0 text-[13px] text-primary"><Link to={action.route} onClick={() => feedback.mutate({ situationId: item.id, feedback: "acted", surface: "home" })}>{action.title}<ArrowRight weight="bold" /></Link></Button> : null}
      {retrying ? <span className="sr-only"><SpinnerGap className="animate-spin" />Atualizando leitura</span> : null}
    </section>
  );
}