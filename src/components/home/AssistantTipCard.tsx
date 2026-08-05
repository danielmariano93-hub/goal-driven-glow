import { ArrowRight, ChevronDown, Lightbulb, Loader2, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNinoExposure } from "@/hooks/useNinoExposure";
import { KIND_LABEL, actionLabel, safeRoute, useNinoAct, useNinoFeedback, type NinoItem } from "@/lib/nino/intelligence";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";

type InsightProps = { item: NinoItem | null; kind?: "item" | "stability"; loading?: boolean; error?: unknown; retrying?: boolean; onRetry?: () => void };

export function AssistantTipCard({ item, kind, loading, error, retrying, onRetry }: InsightProps) {
  const [open, setOpen] = useState(false);
  const feedback = useNinoFeedback();
  const exposureRef = useNinoExposure(item?.id, "home", 1, `home_editorial:${item?.kind ?? "none"}`);

  async function sendFeedback(value: "useful" | "not_useful") {
    if (!item?.id) return;
    try {
      await feedback.mutateAsync({ itemId: item.id, feedback: value, surface: "home" });
      toast.success(value === "useful" ? "Obrigado, isso ajuda o Nino." : "Anotado. O Nino ajusta as próximas leituras.");
    } catch (feedbackError) {
      toast.error((feedbackError as Error).message);
    }
  }

  if (loading) return <section aria-label="Leitura do Nino" className="min-h-[136px] rounded-[20px] border border-border/70 bg-card p-4" aria-busy="true"><div className="h-3 w-24 animate-pulse rounded bg-secondary" /><div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-secondary" /><div className="mt-2 h-3 w-full animate-pulse rounded bg-secondary" /></section>;
  if (error) return <section aria-label="Leitura do Nino"><NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} /></section>;
  if (!item) return <section aria-label="Leitura do Nino" className="rounded-[20px] border border-border/70 bg-card p-4"><p className="text-[10px] font-bold uppercase text-muted-foreground">Leitura do Nino</p><h2 className="mt-2 text-[15px] font-bold text-foreground">Ainda estou formando uma leitura segura</h2><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Com mais movimentações, consigo explicar o que mudou sem tirar conclusões apressadas.</p></section>;

  return (
    <section ref={exposureRef as React.RefObject<HTMLElement>} aria-label="Leitura do Nino" className="rounded-[20px] border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-primary"><Lightbulb className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase text-muted-foreground">Leitura do Nino</p><p className="text-[11px] font-semibold text-primary">{kind === "stability" ? "Situação estável" : KIND_LABEL[item.kind] ?? "Leitura principal"}</p></div></div>
      <h2 className="mt-3 text-[16px] font-bold leading-snug text-foreground">{item.title}</h2>
      {item.summary ? <p className="mt-1 text-[12px] font-medium text-foreground">{item.summary}</p> : null}
      {item.explanation ? <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.explanation}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {item.id ? <><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("useful")} className="rounded-full px-2 text-[11px] text-muted-foreground"><ThumbsUp /> Útil</Button><Button type="button" variant="ghost" size="sm" onClick={() => void sendFeedback("not_useful")} className="rounded-full px-2 text-[11px] text-muted-foreground"><ThumbsDown /> Não ajudou</Button></> : null}
        {item.evidence ? <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="ml-auto rounded-full px-2 text-[11px] text-muted-foreground">Como cheguei aqui <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} /></Button> : null}
      </div>
      {open ? <p className="mt-2 rounded-xl bg-secondary p-3 text-[11px] leading-relaxed text-muted-foreground">{String(item.evidence?.plain_language_reason ?? "Esta leitura combina suas movimentações recentes, seu histórico e os compromissos já conhecidos.")}</p> : null}
    </section>
  );
}

export function BestActionCard({ item, loading, onRefresh, refreshing }: { item: NinoItem | null; loading?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  const act = useNinoAct();
  const action = item?.primary_action ?? null;
  return <section aria-label="Melhor ação agora" className="rounded-[20px] border border-border/70 bg-card p-4"><p className="text-[10px] font-bold uppercase text-muted-foreground">Melhor ação agora</p>{loading ? <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando o próximo passo</div> : action ? <div className="mt-2 flex items-center justify-between gap-4"><div className="min-w-0"><h2 className="text-[15px] font-bold leading-snug text-foreground">{actionLabel(action, "Ver próximo passo", item?.kind)}</h2><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Acesse o ponto certo do app para agir sobre esta leitura.</p></div><Button asChild size="icon" className="shrink-0 rounded-full"><Link to={safeRoute(action, "/app/nino")} aria-label={actionLabel(action, "Abrir ação", item?.kind)} onClick={() => item?.id && act.mutate({ itemId: item.id, surface: "home" })}><ArrowRight /></Link></Button></div> : <div className="mt-2 flex items-center justify-between gap-4"><div><h2 className="text-[15px] font-bold text-foreground">Continuar acompanhando</h2><p className="mt-1 text-[12px] text-muted-foreground">Não há uma ação urgente recomendada agora.</p></div>{onRefresh ? <Button type="button" variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing} aria-label="Atualizar leitura do Nino" className="shrink-0 rounded-full">{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button> : null}</div>}</section>;
}
