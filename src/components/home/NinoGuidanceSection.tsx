// Hierarquia editorial da Home: no máximo UMA orientação visível por vez.
// Quando existe mais de uma leitura (decisão + leituras de apoio), elas entram
// num carrossel lateral com avanço automático — nunca empilhadas.
import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { NinoDecisionCard } from "@/components/home/NinoDecisionCard";
import { NinoGuidanceCard } from "@/components/home/NinoGuidanceCard";
import { composeNinoDecisionNarrative } from "@/lib/copy/decisionNarrative";
import { useNinoNextStep, useNinoNextStepDecision } from "@/lib/nino/nextStep";
import type { HomeDiagnosisView, NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { notifyError } from "@/lib/ui/feedback";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 9000;

type Props = {
  diagnosis: HomeDiagnosisView | null;
  context: NinoDiagnosisContext | null;
  projection: SpendingProjection | null;
  loading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
  projectionAvailability?: "available" | "partial" | "unavailable";
};

export function NinoGuidanceSection({ diagnosis, context, projection, loading, error, retrying, onRetry, projectionAvailability = "available" }: Props) {
  const nextStep = useNinoNextStep();
  const decision = useNinoNextStepDecision();
  const [accepted, setAccepted] = useState<string | null>(null);

  const narrative = useMemo(
    () =>
      composeNinoDecisionNarrative({
        situation: diagnosis?.primary ?? null,
        action: diagnosis?.hasTrustedAction ? diagnosis.action : null,
        nextStep: nextStep.data ?? null,
      }),
    [diagnosis, nextStep.data],
  );

  const criticalFirst = diagnosis?.primary?.severity === "critical" && !narrative?.sameDecision;
  const showDecision = Boolean(nextStep.data && narrative);
  const consolidated = Boolean(narrative?.sameDecision);

  const decisionCard = showDecision && narrative ? (
    <NinoDecisionCard
      narrative={narrative}
      accepting={decision.isPending}
      acceptedMessage={accepted}
      onAccept={() => {
        decision.mutate("accept", {
          onSuccess: (payload) => setAccepted(payload.message ?? "Combinado. Vou acompanhar esse passo com você."),
          onError: (e) => notifyError("Não consegui registrar sua decisão agora.", e instanceof Error ? e.message : undefined),
        });
      }}
    />
  ) : null;

  const readings = (
    <NinoGuidanceCard
      diagnosis={diagnosis}
      context={context}
      projection={projection}
      loading={loading}
      error={error}
      retrying={retrying}
      onRetry={onRetry}
      projectionAvailability={projectionAvailability}
      excludeSituationIds={consolidated && diagnosis?.primary ? [diagnosis.primary.id] : undefined}
      hideWhenEmpty={showDecision}
    />
  );

  const slides = criticalFirst ? [readings, decisionCard] : [decisionCard, readings];
  const visible = slides.filter(Boolean) as JSX.Element[];

  if (visible.length <= 1) {
    return <div className="space-y-4">{visible}</div>;
  }

  return <GuidanceCarousel slides={visible} />;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function GuidanceCarousel({ slides }: { slides: JSX.Element[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const [emblaRef, embla] = useEmblaCarousel({ loop: true, align: "center", containScroll: "trimSnaps", duration: 22 });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => {
      setIndex(embla.selectedScrollSnap());
      setCycle((value) => value + 1);
    };
    const onPointerDown = () => setPaused(true);
    onSelect();
    embla.on("select", onSelect);
    embla.on("pointerDown", onPointerDown);
    return () => {
      embla.off("select", onSelect);
      embla.off("pointerDown", onPointerDown);
    };
  }, [embla]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const autoplay = Boolean(embla) && !paused && !reducedMotion;

  useEffect(() => {
    if (!embla || !autoplay) return;
    const timer = window.setInterval(() => embla.scrollNext(), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [embla, autoplay]);

  const goTo = useCallback(
    (i: number) => {
      setPaused(true);
      embla?.scrollTo(i);
    },
    [embla],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setPaused(true);
      if (event.key === "ArrowLeft") embla?.scrollPrev();
      else embla?.scrollNext();
    },
    [embla],
  );

  return (
    <div
      role="group"
      aria-roledescription="carrossel"
      aria-label="Orientações do Nino"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onFocus={() => setPaused(true)}
      className="space-y-2.5 rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex items-stretch">
          {slides.map((slide, i) => (
            <div
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} de ${slides.length}`}
              aria-hidden={i !== index}
              className={cn(
                "min-w-0 flex-[0_0_100%] transition-opacity duration-200",
                i === index ? "opacity-100" : "opacity-40",
              )}
            >
              <div className="h-full">{slide}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ver orientação ${i + 1} de ${slides.length}`}
            aria-current={i === index}
            onClick={() => goTo(i)}
            className="inline-flex h-9 items-center justify-center px-1"
          >
            <span
              className={cn(
                "relative block h-1.5 overflow-hidden rounded-full transition-all duration-300",
                i === index ? "w-7 bg-primary/25" : "w-1.5 bg-border",
              )}
            >
              {i === index ? (
                <span
                  key={cycle}
                  aria-hidden="true"
                  className={cn("absolute inset-0 origin-left rounded-full bg-primary", autoplay && "animate-dot-progress")}
                  style={autoplay ? { animationDuration: `${AUTOPLAY_MS}ms` } : undefined}
                />
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

