import { CheckCircle2, Clock3, FlaskConical, Loader2, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BehaviorExperiment,
  BehaviorExperimentTemplate,
  BehavioralEvolutionSnapshot,
} from "@/lib/behavioral/client";

function daysLeft(endsAt: string) {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
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
            return (
              <article key={experiment.id} className="rounded-[24px] border border-primary/20 bg-gradient-to-br from-card to-primary/5 p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><FlaskConical size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{experiment.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 size={11} /> {daysLeft(experiment.ends_at)} dias restantes</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">{Math.round(Number(experiment.progress))}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, Number(experiment.progress))}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{progressText(experiment)} · acompanhamento {manual ? "por registro" : "automático"}</p>
                  </div>
                </div>
                {manual ? (
                  <Button type="button" variant="outline" className="mt-3 min-h-10 w-full rounded-full text-xs font-semibold" disabled={busy === experiment.id} onClick={() => onLog(experiment)}>
                    {busy === experiment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Marcar uma ação feita
                  </Button>
                ) : (
                  <div className="mt-3 rounded-2xl bg-background/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    O Nino acompanha esse experimento usando os seus lançamentos/check-ins confirmados. Você não precisa marcar tarefa manualmente.
                  </div>
                )}
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
