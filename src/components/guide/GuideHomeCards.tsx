import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Sparkles, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Progress } from "@/components/ui/progress";
import { GuideTourSheet, type TourSpec } from "@/components/guide/GuideTourSheet";
import { featureTour, setupTour } from "@/lib/guide/tours";
import {
  SETUP_DISMISS_KEY, featureStateKey, pendingAnnouncements, setupProgress, shouldShowSetupCard,
} from "@/lib/guide/catalog";
import { useGuideState, useMarkGuide, useSetupStatus } from "@/lib/guide/useGuide";

/**
 * No Início: primeiros passos enquanto o essencial não estiver feito; depois,
 * no máximo UMA novidade por vez. Nada aparece se a leitura falhar (sem ruído).
 */
export function GuideHomeCards() {
  const { user } = useAuth();
  const setup = useSetupStatus();
  const state = useGuideState();
  const mark = useMarkGuide();
  const [tour, setTour] = useState<{ spec: TourSpec; onFinish: () => void } | null>(null);

  if (!setup.data || !state.data) return null;

  if (shouldShowSetupCard(setup.data, state.data)) {
    const p = setupProgress(setup.data);
    const next = p.next;
    return (
      <section aria-label="Primeiros passos" className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">Primeiros passos no Nino</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.essentialDone} de {p.essentialTotal} concluídos</p>
          </div>
          <button
            type="button"
            aria-label="Dispensar primeiros passos"
            className="rounded-full p-1 text-muted-foreground hover:bg-background/60"
            onClick={() => mark.mutate({ itemKey: SETUP_DISMISS_KEY, status: "dismissed" })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Progress value={(p.essentialDone / p.essentialTotal) * 100} className="mt-3 h-1.5" />
        {next ? (
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-3 rounded-xl bg-background p-3 text-left"
            onClick={() => setTour({ spec: setupTour(next), onFinish: () => undefined })}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-primary">Próximo passo</span>
              <span className="block truncate text-sm font-semibold">{next.title}</span>
              <span className="block text-xs text-muted-foreground">{next.why}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ) : null}
        <Link to="/app/guia" className="mt-2 inline-block text-xs font-semibold text-primary">Ver todos os passos</Link>
        <GuideTourSheet tour={tour?.spec ?? null} onClose={() => setTour(null)} onFinish={() => tour?.onFinish()} />
      </section>
    );
  }

  const news = pendingAnnouncements(state.data, user?.created_at)[0];
  if (!news) return null;
  const key = featureStateKey(news.id);
  return (
    <section aria-label="Novidade" className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Novidade</p>
          <h2 className="text-sm font-bold">{news.title}</h2>
          <p className="text-xs text-muted-foreground">{news.summary}</p>
          <div className="mt-2 flex gap-3">
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setTour({ spec: featureTour(news), onFinish: () => mark.mutate({ itemKey: key, status: "completed" }) })}>
              Ver como funciona
            </button>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => mark.mutate({ itemKey: key, status: "dismissed" })}>
              Agora não
            </button>
          </div>
        </div>
      </div>
      <GuideTourSheet
        tour={tour?.spec ?? null}
        onClose={() => { if (tour) mark.mutate({ itemKey: key, status: "seen" }); setTour(null); }}
        onFinish={() => tour?.onFinish()}
      />
    </section>
  );
}
