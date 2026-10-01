import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FlaskConical, Loader2, RotateCcw, Sparkles, Target, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BehaviorExperiment,
  BehaviorExperimentTemplate,
  BehavioralEvolutionSnapshot,
} from "@/lib/behavioral/client";
import { experimentOutcome } from "@/lib/behavioral/experimentOutcome";
import { evidenceItems, experimentCopy, progressLabel } from "@/lib/behavioral/experimentCopy";
import { useExperimentEvents, useUnlinkEvent } from "@/lib/behavioral/experimentEvidence";
import { EvidenceList, LinkTransactionSheet, PauseSheet, WeeklyReviewSheet } from "@/components/behavioral/ExperimentParts";

const DAY_MS = 86_400_000;

function experimentTiming(experiment: BehaviorExperiment) {
  const start = new Date(experiment.started_at).getTime();
  const end = new Date(experiment.ends_at).getTime();
  const now = Date.now();
  const durationMs = Math.max(DAY_MS, end - start);
  const durationDays = Math.max(1, Math.ceil(durationMs / DAY_MS));
  const elapsedMs = Math.max(0, Math.min(durationMs, now - start));
  const elapsedDays = Math.min(durationDays, Math.max(1, Math.floor(elapsedMs / DAY_MS) + 1));
  const remainingDays = Math.max(0, Math.ceil((end - now) / DAY_MS));
  const timeProgress = Math.max(0, Math.min(100, (elapsedMs / durationMs) * 100));
  return { durationDays, elapsedDays, remainingDays, timeProgress };
}

function formatDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
  }).format(date).replace(".", "");
}

function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function formatOutcomeValue(experiment: BehaviorExperiment, value: number | null) {
  if (value == null) return "—";
  if (experiment.tracking_kind === "spend_reduction_pct") return `${formatBRL(value)}/dia`;
  if (experiment.tracking_kind === "no_spend_days" || experiment.tracking_kind === "checkin_count") return value.toFixed(0);
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",");
}

function recommendationCopy(experiment: BehaviorExperiment) {
  const outcome = experimentOutcome(experiment);
  if (outcome.recommendation === "continue") {
    return { icon: CheckCircle2, title: "Vale manter por mais um ciclo", body: "O teste chegou ao objetivo. Repetir ajuda a descobrir se o comportamento se sustenta fora desta janela." };
  }
  if (outcome.recommendation === "switch") {
    return { icon: RotateCcw, title: "Melhor trocar a estratégia", body: "Este formato não entregou evidência suficiente de melhora. O aprendizado vale mais do que insistir no mesmo teste." };
  }
  return { icon: FlaskConical, title: "Ainda precisa de mais evidência", body: "O Nino ainda não tem uma comparação estável para sugerir manter ou trocar." };
}

export function ExperimentsBoard({
  snapshot,
  busy,
  onStart,
  onChanged,
}: {
  snapshot: BehavioralEvolutionSnapshot;
  busy: string | null;
  onStart: (template: BehaviorExperimentTemplate) => Promise<void>;
  /** Recarrega a página depois de vincular, desfazer, registrar pausa ou concluir revisão. */
  onChanged: () => Promise<void>;
}) {
  const active = snapshot.activeExperiments;
  const eventsQuery = useExperimentEvents(active.map((row) => row.id));
  const unlink = useUnlinkEvent(onChanged);
  const [sheet, setSheet] = useState<{ kind: "link" | "review" | "pause"; experiment: BehaviorExperiment } | null>(null);
  const closeSheet = (open: boolean) => { if (!open) setSheet(null); };
  const finished = snapshot.experiments
    .filter((row) => row.status === "completed" || row.status === "expired" || row.status === "abandoned")
    .slice(0, 3);
  const activeSlugs = new Set(active.map((row) => row.template_slug));
  const recommended = snapshot.recommendedTemplates.filter((template) => !activeSlugs.has(template.slug)).slice(0, 3);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Experimentos</p>
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Mude um comportamento por vez</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          O Nino propõe testes curtos e mede o antes e depois. Sem sequência punitiva e sem “falhou”: o resultado serve para aprender o que funciona para você.
        </p>
      </div>

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map((experiment) => {
            const copy = experimentCopy(experiment.template_slug);
            const timing = experimentTiming(experiment);
            const habitProgress = Math.max(0, Math.min(100, Number(experiment.progress)));
            const events = (eventsQuery.data ?? []).filter((e) => e.experiment_id === experiment.id);
            const items = evidenceItems(experiment.template_slug, events);
            const showEvidence = copy.mode !== "auto";
            return (
              <article key={experiment.id} className="overflow-hidden rounded-[26px] border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 shadow-card">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><FlaskConical size={19} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{experiment.title}</p>
                        <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                          Dia {timing.elapsedDays} de {timing.durationDays}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-foreground">{copy.what}</p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl bg-secondary/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">O que conta</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground">
                      {copy.counts.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{copy.measured}</p>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Progresso</p>
                        <p className="mt-1 text-xs font-medium text-foreground">{progressLabel(experiment.template_slug, Number(experiment.current_value), Number(experiment.target_value))}</p>
                      </div>
                      <span className="font-display text-xl font-bold text-primary">{Math.round(habitProgress)}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${habitProgress}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><CalendarDays size={11} /> {formatDate(experiment.started_at)}</span>
                      <span className="flex items-center gap-1"><Clock3 size={11} /> {timing.remainingDays} dias restantes</span>
                      <span>{formatDate(experiment.ends_at)}</span>
                    </div>
                  </div>

                  {showEvidence ? (
                    <div className="mt-4">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Já contou</p>
                      <EvidenceList items={items} busy={unlink.isPending} onUnlink={(eventId) => unlink.mutate({ eventId })} />
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {copy.mode === "auto_or_link" ? (
                      <>
                        {copy.route ? <Button asChild className="min-h-10 flex-1 rounded-full text-xs font-semibold"><Link to={copy.route.to}>{copy.route.label}</Link></Button> : null}
                        <Button type="button" variant="outline" className="min-h-10 flex-1 rounded-full text-xs font-semibold" onClick={() => setSheet({ kind: "link", experiment })}>{copy.linkLabel}</Button>
                      </>
                    ) : null}
                    {copy.mode === "auto_or_guided" ? (
                      <>
                        <Button type="button" className="min-h-10 flex-1 rounded-full text-xs font-semibold" onClick={() => setSheet({ kind: "review", experiment })}>Fazer a revisão guiada</Button>
                        {copy.route ? <Button asChild variant="outline" className="min-h-10 flex-1 rounded-full text-xs font-semibold"><Link to={copy.route.to}>{copy.route.label}</Link></Button> : null}
                      </>
                    ) : null}
                    {copy.mode === "manual_pause" ? (
                      <>
                        <Button type="button" className="min-h-10 flex-1 rounded-full text-xs font-semibold" onClick={() => setSheet({ kind: "pause", experiment })}>Registrar uma pausa</Button>
                        <Button type="button" variant="outline" className="min-h-10 flex-1 rounded-full text-xs font-semibold" onClick={() => setSheet({ kind: "link", experiment })}>{copy.linkLabel}</Button>
                      </>
                    ) : null}
                    {copy.mode === "auto" && copy.route ? (
                      copy.route.to.startsWith("#")
                        ? <Button asChild variant="outline" className="min-h-10 w-full rounded-full text-xs font-semibold"><a href={copy.route.to}>{copy.route.label}</a></Button>
                        : <Button asChild variant="outline" className="min-h-10 w-full rounded-full text-xs font-semibold"><Link to={copy.route.to}>{copy.route.label}</Link></Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {sheet?.kind === "link" ? (
        <LinkTransactionSheet experiment={sheet.experiment} open label={experimentCopy(sheet.experiment.template_slug).linkLabel ?? "Vincular um lançamento"} onOpenChange={closeSheet} onChanged={onChanged} />
      ) : null}
      {sheet?.kind === "review" ? (
        <WeeklyReviewSheet experiment={sheet.experiment} events={(eventsQuery.data ?? []).filter((e) => e.experiment_id === sheet.experiment.id)} open onOpenChange={closeSheet} onChanged={onChanged} />
      ) : null}
      {sheet?.kind === "pause" ? <PauseSheet experiment={sheet.experiment} open onOpenChange={closeSheet} onChanged={onChanged} /> : null}

      {recommended.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {recommended.map((template) => {
            const copy = experimentCopy(template.slug);
            return (
              <article key={template.slug} className="rounded-[22px] border border-border bg-card p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary"><Target size={16} /></span>
                  <span className="rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{template.duration_days} dias</span>
                </div>
                <p className="mt-3 text-sm font-semibold">{template.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground">{copy.what}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">O que conta</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                  {copy.counts.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{copy.measured}</p>
                <Button type="button" className="mt-3 min-h-10 w-full rounded-full text-xs font-semibold" disabled={busy === template.slug} onClick={() => onStart(template)}>
                  {busy === template.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {String(template.config?.cta ?? "Testar")}
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {active.length === 0 && recommended.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-border bg-card p-6 text-center">
          <FlaskConical className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Seu próximo experimento aparece depois do mapa comportamental</p>
          <p className="mt-1 text-xs text-muted-foreground">O Nino usa a dimensão que você quer fortalecer para evitar recomendações genéricas.</p>
        </div>
      ) : null}

      {finished.length > 0 && (
        <div className="space-y-2 rounded-[22px] border border-border bg-card p-4 shadow-card">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">O que os testes mostraram</p>
            <p className="mt-1 text-xs text-muted-foreground">Antes, depois e o próximo passo — sem tratar associação como causa.</p>
          </div>
          {finished.map((experiment) => {
            const outcome = experimentOutcome(experiment);
            const recommendation = recommendationCopy(experiment);
            const RecommendationIcon = recommendation.icon;
            const reduction = experiment.tracking_kind === "spend_reduction_pct" ? outcome.deltaPct ?? Number(experiment.current_value) : outcome.deltaPct;
            return (
              <article key={experiment.id} className="rounded-[20px] border border-border/80 bg-background/60 p-3.5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success"><CheckCircle2 size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{experiment.title}</p>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        {experiment.status === "completed" ? "Concluído" : experiment.status === "expired" ? "Encerrado" : "Interrompido"}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl bg-secondary/55 p-3">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Antes</p>
                        <p className="mt-1 font-display text-base font-bold">{formatOutcomeValue(experiment, outcome.baseline)}</p>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground" />
                      <div className="text-right">
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Durante o teste</p>
                        <p className="mt-1 font-display text-base font-bold">{formatOutcomeValue(experiment, outcome.current)}</p>
                      </div>
                    </div>

                    {reduction != null && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <TrendingDown size={14} className={reduction > 0 ? "text-success" : "text-muted-foreground"} />
                        <span className="font-semibold">{Math.abs(reduction).toFixed(0)}%</span>
                        <span className="text-muted-foreground">
                          {experiment.tracking_kind === "spend_reduction_pct"
                            ? reduction > 0 ? "menos gasto médio" : "sem redução de gasto"
                            : reduction > 0 ? "de melhora no indicador" : "de variação no indicador"}
                        </span>
                      </div>
                    )}

                    {outcome.savedTotal != null && outcome.savedTotal > 0 && (
                      <div className="mt-2 rounded-xl bg-success/8 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                        Efeito estimado: <strong>{formatBRL(outcome.savedTotal)} a menos</strong> no período, comparando o gasto médio diário anterior com o observado durante o teste.
                      </div>
                    )}

                    <div className="mt-3 flex items-start gap-2 border-t border-border/70 pt-3">
                      <RecommendationIcon size={15} className="mt-0.5 shrink-0 text-primary" />
                      <div>
                        <p className="text-xs font-semibold">{recommendation.title}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{recommendation.body}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
