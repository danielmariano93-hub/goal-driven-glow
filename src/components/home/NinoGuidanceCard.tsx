import { useState } from "react";
import { ArrowRight, CaretDown, CheckCircle, Info, SpinnerGap, ThumbsDown, ThumbsUp, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import { formatBRL } from "@/lib/engine/facts";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { useNinoSituationFeedback, type HomeDiagnosisView } from "@/lib/nino/diagnosis";

type Props = {
  diagnosis: HomeDiagnosisView | null;
  projection: SpendingProjection | null;
  loading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
};

const confidenceCopy: Record<SpendingProjection["confidence"], string | null> = {
  insufficient: "Estimativa inicial: ainda há poucos dias observados neste mês.",
  low: "Estimativa preliminar: a leitura fica mais precisa ao longo do mês.",
  medium: null,
  high: null,
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function ProjectionRows({ projection }: { projection: SpendingProjection }) {
  const rows = [
    ["Disponível hoje", projection.currentAvailableBalance],
    ["Entradas confirmadas", projection.confirmedFutureInflows],
    ["Compromissos conhecidos", -projection.upcomingConfirmedCommitments],
    ["Fatura deste mês", -projection.cardDueThisMonth],
    ["Gasto variável esperado", -projection.projectedVariableSpending],
  ] as const;
  return <div className="mt-3 rounded-xl bg-secondary p-3">{rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3 py-1 text-xs"><span className="text-muted-foreground">{label}</span><strong className="tabular-nums text-foreground">{formatBRL(value)}</strong></div>)}<div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-sm"><span className="font-semibold text-foreground">Saldo estimado</span><strong className="tabular-nums text-foreground">{formatBRL(projection.projectedEndBalance)}</strong></div></div>;
}

export function NinoGuidanceCard({ diagnosis, projection, loading, error, retrying, onRetry }: Props) {
  const [open, setOpen] = useState(false);
  const feedback = useNinoSituationFeedback();
  const item = diagnosis?.primary ?? null;
  const action = diagnosis?.hasTrustedAction ? diagnosis.action : null;
  const critical = item?.severity === "critical";
  const attention = item?.severity === "attention";
  const Icon = critical || attention ? Warning : CheckCircle;
  const accent = critical ? "bg-destructive" : attention ? "bg-warning" : "bg-primary";

  async function sendFeedback(value: "useful" | "not_useful") {
    if (!item) return;
    try {
      await feedback.mutateAsync({ situationId: item.id, feedback: value, surface: "home" });
      toast.success(value === "useful" ? "Obrigado, isso ajuda o Nino." : "Anotado. Vou ajustar as próximas leituras.");
    } catch (feedbackError) {
      toast.error((feedbackError as Error).message);
    }
  }

  if (loading) return <section aria-label="Orientação do Nino" aria-busy="true" className="min-h-[156px] animate-pulse rounded-2xl border border-border bg-card p-5"><div className="h-3 w-24 rounded bg-secondary" /><div className="mt-4 h-5 w-3/4 rounded bg-secondary" /><div className="mt-2 h-3 w-full rounded bg-secondary" /></section>;
  if (error) return <section aria-label="Orientação do Nino" className="rounded-2xl border border-border bg-card p-4"><NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} /></section>;
  if (!item) return <section aria-label="Orientação do Nino" className="relative overflow-hidden rounded-2xl border border-border bg-card p-5"><span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" /><p className="text-xs font-bold text-primary">Orientação do Nino</p><h2 className="mt-2 text-base font-bold text-foreground">Ainda estou formando uma leitura segura</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Com mais movimentações, consigo explicar o que mudou sem tirar conclusões apressadas.</p></section>;

  const confidenceNote = projection ? confidenceCopy[projection.confidence] : null;
  return (
    <section aria-label="Orientação do Nino" className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 animate-fade-in">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-2"><Icon className={critical ? "text-destructive" : attention ? "text-warning" : "text-primary"} weight="duotone" /><p className="text-xs font-bold text-foreground">Orientação do Nino</p></div>
      <h2 className="mt-3 text-lg font-bold leading-snug text-foreground">{item.one_line_summary || item.headline}</h2>
      {item.cause_summary ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.cause_summary}</p> : null}
      {diagnosis.counterpoint ? <p className="mt-3 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Também vale saber:</strong> {diagnosis.counterpoint.one_line_summary || diagnosis.counterpoint.headline}</p> : null}
      {item.consequence_summary ? <p className="mt-3 text-sm leading-relaxed text-foreground">{item.consequence_summary}</p> : null}
      {item.forecast_summary ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.forecast_summary}</p> : null}
      {confidenceNote ? <p className="mt-3 flex items-start gap-2 rounded-lg bg-secondary p-2.5 text-xs text-muted-foreground"><Info className="mt-0.5 shrink-0" />{confidenceNote}</p> : null}
      {action ? <div className="mt-4 border-t border-border pt-4"><p className="text-xs font-semibold text-muted-foreground">Melhor ação agora</p><h3 className="mt-1 text-sm font-bold text-foreground">{action.title}</h3>{action.explanation ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.explanation}</p> : null}{typeof action.estimated_impact === "number" ? <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">Impacto estimado: {formatBRL(action.estimated_impact)}</p> : null}<Button asChild className="mt-3 min-h-12 w-full rounded-xl sm:w-auto"><Link to={action.route} onClick={() => feedback.mutate({ situationId: item.id, feedback: "acted", surface: "home" })}>{action.title}<ArrowRight weight="bold" /></Link></Button></div> : null}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="min-h-11 w-full justify-between rounded-lg px-2 text-xs text-muted-foreground">Entender análise<CaretDown className={open ? "rotate-180 transition-transform" : "transition-transform"} /></Button></CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-xs leading-relaxed text-muted-foreground">
          {diagnosis.evidenceSummary ? <p>{diagnosis.evidenceSummary}</p> : null}
          {projection ? <ProjectionRows projection={projection} /> : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span>Leitura de {dateLabel(diagnosis.asOf) || "agora"}</span><div className="flex gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("useful")} disabled={feedback.isPending} className="rounded-full text-xs"><ThumbsUp />Útil</Button><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("not_useful")} disabled={feedback.isPending} className="rounded-full text-xs"><ThumbsDown />Não ajudou</Button></div></div>
        </CollapsibleContent>
      </Collapsible>
      {retrying ? <span className="sr-only"><SpinnerGap className="animate-spin" />Atualizando leitura</span> : null}
    </section>
  );
}