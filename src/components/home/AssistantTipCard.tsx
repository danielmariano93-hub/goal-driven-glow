import { ArrowRight, CaretDown, Lightbulb, SpinnerGap, ArrowClockwise, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import { diagnosisRouteForSituation } from "@/lib/nino/actions";
import { useNinoSituationFeedback, type HomeDiagnosisView } from "@/lib/nino/diagnosis";
import { formatBRL } from "@/lib/engine/facts";

type InsightProps = { diagnosis: HomeDiagnosisView | null; loading?: boolean; error?: unknown; retrying?: boolean; onRetry?: () => void };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function AssistantTipCard({ diagnosis, loading, error, retrying, onRetry }: InsightProps) {
  const [open, setOpen] = useState(false);
  const feedback = useNinoSituationFeedback();
  const item = diagnosis?.primary ?? null;

  async function sendFeedback(value: "useful" | "not_useful") {
    if (!item?.id) return;
    try {
      await feedback.mutateAsync({ situationId: item.id, feedback: value, surface: "home" });
      toast.success(value === "useful" ? "Obrigado, isso ajuda o Nino." : "Anotado. O Nino ajusta as próximas leituras.");
    } catch (feedbackError) {
      toast.error((feedbackError as Error).message);
    }
  }

  if (loading) return <section aria-label="Leitura do Nino" className="min-h-[124px] rounded-[20px] border border-primary/15 bg-gradient-brand-soft p-4" aria-busy="true"><div className="h-3 w-24 animate-pulse rounded bg-primary/10" /><div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-primary/10" /><div className="mt-2 h-3 w-full animate-pulse rounded bg-primary/10" /></section>;
  if (error) return <section aria-label="Leitura do Nino"><NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} /></section>;
  if (!item) return <section aria-label="Leitura do Nino" className="rounded-[20px] border border-primary/15 bg-gradient-brand-soft p-4"><p className="text-[10px] font-bold uppercase text-primary">Leitura do Nino</p><h2 className="mt-2 text-[15px] font-bold text-foreground">Ainda estou formando uma leitura segura</h2><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Com mais movimentações, consigo explicar o que mudou sem tirar conclusões apressadas.</p></section>;

  return (
    <section aria-label="Leitura do Nino" className="rounded-[20px] border border-primary/15 bg-gradient-brand-soft p-4 shadow-sm animate-fade-in">
      <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Lightbulb className="h-4 w-4" weight="duotone" /></span><div><p className="text-[10px] font-bold uppercase text-primary">Leitura do Nino</p><p className="text-[10px] text-muted-foreground">Confiança {Math.round(diagnosis.diagnosisConfidence * 100)}%{dateLabel(diagnosis.asOf) ? ` · ${dateLabel(diagnosis.asOf)}` : ""}</p></div></div>
      <h2 className="mt-3 text-[16px] font-bold leading-snug text-foreground">{item.one_line_summary || item.headline}</h2>
      {item.cause_summary ? <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.cause_summary}</p> : null}
      {diagnosis.counterpoint ? <p className="mt-2 border-l-2 border-primary/30 pl-2 text-[11px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Também vale saber:</span> {diagnosis.counterpoint.one_line_summary || diagnosis.counterpoint.headline}</p> : null}
      {diagnosis.isStale ? <p className="mt-2 text-[11px] font-medium text-warning-foreground">Esta leitura precisa ser atualizada.</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {item.id ? <><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("useful")} className="rounded-full px-2 text-[11px] text-muted-foreground"><ThumbsUp /> Útil</Button><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("not_useful")} className="rounded-full px-2 text-[11px] text-muted-foreground"><ThumbsDown /> Não ajudou</Button></> : null}
        {diagnosis.evidenceSummary || item.consequence_summary || item.forecast_summary ? <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="ml-auto rounded-full px-2 text-[11px] text-muted-foreground">Entender leitura <CaretDown className={open ? "rotate-180 transition-transform" : "transition-transform"} /></Button> : null}
      </div>
      {open ? <div className="mt-2 space-y-1 rounded-md bg-background/70 p-3 text-[11px] leading-relaxed text-muted-foreground">{diagnosis.evidenceSummary ? <p>{diagnosis.evidenceSummary}</p> : null}{item.consequence_summary ? <p><span className="font-semibold text-foreground">Consequência:</span> {item.consequence_summary}</p> : null}{item.forecast_summary ? <p><span className="font-semibold text-foreground">Daqui para frente:</span> {item.forecast_summary}</p> : null}</div> : null}
    </section>
  );
}

export function BestActionCard({ diagnosis, loading, onRefresh, refreshing }: { diagnosis: HomeDiagnosisView | null; loading?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  const feedback = useNinoSituationFeedback();
  const situation = diagnosis?.primary ?? null;
  const action = diagnosis?.hasTrustedAction ? diagnosis.action : null;
  const route = situation && action ? diagnosisRouteForSituation(situation, action) : null;
  return <section aria-label="Melhor ação agora" className="relative overflow-hidden rounded-[20px] bg-gradient-brand-dark p-4 text-primary-foreground shadow-hero animate-fade-in"><span className="absolute inset-x-0 top-0 h-1 bg-gradient-brand" aria-hidden="true" /><p className="text-[10px] font-bold uppercase text-primary-foreground/65">Melhor ação agora</p>{loading ? <div className="mt-3 flex items-center gap-2 text-[12px] text-primary-foreground/70"><SpinnerGap className="h-4 w-4 animate-spin" /> Buscando o próximo passo</div> : action && situation && route ? <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><h2 className="text-[15px] font-bold leading-snug">{action.title}</h2>{action.explanation ? <p className="mt-1 text-[12px] leading-relaxed text-primary-foreground/70">{action.explanation}</p> : null}{typeof action.estimated_impact === "number" ? <p className="mt-1 text-[11px] font-semibold tabular-nums text-primary-foreground/85">Impacto estimado: {formatBRL(action.estimated_impact)}</p> : null}</div><Button asChild variant="secondary" className="min-h-11 rounded-full"><Link to={route} onClick={() => feedback.mutate({ situationId: situation.id, feedback: "acted", surface: "home" })}>{action.title}<ArrowRight weight="bold" /></Link></Button></div> : <div className="mt-2 flex items-center justify-between gap-4"><div><h2 className="text-[15px] font-bold">Continuar acompanhando</h2><p className="mt-1 text-[12px] text-primary-foreground/70">Não há uma ação confiável recomendada agora.</p></div>{onRefresh ? <Button type="button" variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing} aria-label="Atualizar leitura do Nino" className="h-11 w-11 shrink-0 rounded-full text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">{refreshing ? <SpinnerGap className="animate-spin" /> : <ArrowClockwise />}</Button> : null}</div>}</section>;
}
