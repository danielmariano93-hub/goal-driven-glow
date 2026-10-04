import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { GuideTourSheet, type TourSpec } from "@/components/guide/GuideTourSheet";
import { featureTour, setupTour } from "@/lib/guide/tours";
import { FEATURE_GUIDES, featureStateKey, setupProgress } from "@/lib/guide/catalog";
import { useGuideState, useMarkGuide, useSetupStatus } from "@/lib/guide/useGuide";

export default function Guia() {
  const setup = useSetupStatus();
  const state = useGuideState();
  const mark = useMarkGuide();
  const [tour, setTour] = useState<{ spec: TourSpec; onFinish?: () => void } | null>(null);

  if (setup.isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const p = setupProgress(setup.data);
  const essential = p.items.filter((i) => i.essential);
  const more = p.items.filter((i) => !i.essential);

  return (
    <div className="space-y-6 pb-16">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Guia do Nino</h1>
        <p className="mt-1 text-sm text-muted-foreground">Primeiros passos e como usar cada funcionalidade.</p>
      </header>

      {setup.isError ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">Não consegui verificar o que você já configurou. Os tutoriais abaixo continuam disponíveis.</p>
      ) : (
        <section aria-labelledby="guia-setup">
          <div className="flex items-baseline justify-between">
            <h2 id="guia-setup" className="text-sm font-bold">Primeiros passos</h2>
            <span className="text-xs text-muted-foreground">{p.essentialDone} de {p.essentialTotal}</span>
          </div>
          <Progress value={(p.essentialDone / p.essentialTotal) * 100} className="mt-2 h-1.5" />
          <ul className="mt-3 space-y-2">
            {essential.map((item) => <SetupRow key={item.key} item={item} onOpen={() => setTour({ spec: setupTour(item) })} />)}
          </ul>
          <h3 className="mt-5 text-xs font-bold text-muted-foreground">Para ir além</h3>
          <ul className="mt-2 space-y-2">
            {more.map((item) => <SetupRow key={item.key} item={item} onOpen={() => setTour({ spec: setupTour(item) })} />)}
          </ul>
        </section>
      )}

      <section aria-labelledby="guia-features">
        <h2 id="guia-features" className="text-sm font-bold">Conheça as funcionalidades</h2>
        <ul className="mt-3 space-y-2">
          {FEATURE_GUIDES.map((g) => {
            const seen = !!state.data?.[featureStateKey(g.id)];
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left"
                  onClick={() => setTour({ spec: featureTour(g), onFinish: () => mark.mutate({ itemKey: featureStateKey(g.id), status: "completed" }) })}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {g.title}
                      {g.announce && !seen ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Novo</span> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">{g.summary}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <GuideTourSheet tour={tour?.spec ?? null} onClose={() => setTour(null)} onFinish={() => tour?.onFinish?.()} />
    </div>
  );
}

function SetupRow({ item, onOpen }: { item: ReturnType<typeof setupProgress>["items"][number]; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left">
        {item.completed
          ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-label="Concluído" />
          : <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-label="Pendente" />}
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${item.completed ? "text-muted-foreground line-through" : ""}`}>{item.title}</span>
          <span className="block text-xs text-muted-foreground">{item.why}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
