import { CalendarDays, CheckCircle2, Clock3, FlaskConical, Loader2, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BehaviorExperiment,
  BehaviorExperimentTemplate,
  BehavioralEvolutionSnapshot,
} from "@/lib/behavioral/client";

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

function progressText(experiment: BehaviorExperiment) {
  if (experiment.tracking_kind === "spend_reduction_pct") return `${Math.max(0, Number(experiment.current_value)).toFixed(0)}% de redução observada`;
  return `${Number(experiment.current_value).toFixed(0)} de ${Number(experiment.target_value).toFixed(0)}`;
}

export function ExperimentsBoard({
  snapshot,
  busy,
  onStart,
  onLog,
}: {
  snapshot: BehavioralEvolutionSnapshot;
  busy: string | null;
  onStart: (template: BehaviorExperimentTemplate) => Promise<void>;
  onLog: (experiment: BehaviorExperiment) => Promise<void>;
}) {
  const active = snapshot.activeExperiments;
  const completed = snapshot.experiments.filter((row) => row.status === "completed").slice(0, 3);
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
            const manual = experiment.tracking_kind === "manual";
            const timing = experimentTiming(experiment);
            const habitProgress = Math.max(0, Math.min(100, Number(experiment.progress)));
            return (
              <article key={experiment.id} className="overflow-hidden rounded-[26px] border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 shadow-card">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><FlaskConical size={19} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{experiment.title}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            {manual ? "Você registra as ações; o Nino acompanha a evolução." : "O Nino mede automaticamente usando seus dados confirmados."}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                          Dia {timing.elapsedDays} de {timing.durationDays}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-border/70 bg-background/75 p-3">
                    <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-muted-foreground">
                      <span className="flex items-center gap-1"><CalendarDays size={12} /> {formatDate(experiment.started_at)}</span>
                      <span className="flex items-center gap-1"><Clock3 size={12} /> {timing.remainingDays} dias restantes</span>
                      <span>{formatDate(experiment.ends_at)}</span>
                    </div>
                    <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary/45 transition-all duration-500" style={{ width: `${timing.timeProgress}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
                      <span>Início</span><span>Tempo do experimento</span><span>Fim</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Progresso do hábito</p>
                        <p className="mt-1 text-xs font-medium text-foreground">{progressText(experiment)}</p>
                      </div>
                      <span className="font-display text-xl font-bold text-primary">{Math.round(habitProgress)}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${habitProgress}%` }} />
                    </div>
                  </div>

                  {manual ? (
                    <Button type="button" variant="outline" className="mt-4 min-h-10 w-full rounded-full text-xs font-semibold" disabled={busy === experiment.id} onClick={() => onLog(experiment)}>
                      {busy === experiment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Marcar uma ação feita
                    </Button>
                  ) : (
                    <div className="mt-4 rounded-2xl bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      Você não precisa marcar tarefa manualmente. O progresso é recalculado a partir dos lançamentos e check-ins confirmados.
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {recommended.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {recommended.map((template) => (
            <article key={template.slug} className="rounded-[22px] border border-border bg-card p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary"><Target size={16} /></span>
                <span className="rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{template.duration_days} dias</span>
              </div>
              <p className="mt-3 text-sm font-semibold">{template.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{template.description}</p>
              <Button type="button" className="mt-3 min-h-10 w-full rounded-full text-xs font-semibold" disabled={busy === template.slug} onClick={() => onStart(template)}>
                {busy === template.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {String(template.config?.cta ?? "Testar")}
              </Button>
            </article>
          ))}
        </div>
      )}

      {active.length === 0 && recommended.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-border bg-card p-6 text-center">
          <FlaskConical className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Seu próximo experimento aparece depois do mapa comportamental</p>
          <p className="mt-1 text-xs text-muted-foreground">O Nino usa a dimensão que você quer fortalecer para evitar recomendações genéricas.</p>
        </div>
      ) : null}

      {completed.length > 0 && (
        <div className="rounded-[22px] border border-success/20 bg-success/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-success">Experimentos concluídos</p>
          <div className="mt-2 space-y-2">
            {completed.map((experiment) => (
              <div key={experiment.id} className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={14} className="shrink-0 text-success" />
                <span className="font-medium">{experiment.title}</span>
                <span className="ml-auto text-muted-foreground">100%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
