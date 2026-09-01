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

function GuidanceCarousel({ slides }: { slides: JSX.Element[] }) {
  const [emblaRef, embla] = useEmblaCarousel({ loop: true, align: "start" });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setIndex(embla.selectedScrollSnap());
    onSelect();
    embla.on("select", onSelect);
    embla.on("pointerDown", () => setPaused(true));
    return () => {
      embla.off("select", onSelect);
    };
  }, [embla]);

  useEffect(() => {
    if (!embla || paused) return;
    const timer = window.setInterval(() => embla.scrollNext(), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [embla, paused]);

  const goTo = useCallback(
    (i: number) => {
      setPaused(true);
      embla?.scrollTo(i);
    },
    [embla],
  );

  return (
    <div className="space-y-3">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {slides.map((slide, i) => (
            <div key={i} className="min-w-0 flex-[0_0_100%] pr-1">
              {slide}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ver orientação ${i + 1}`}
            aria-current={i === index}
            onClick={() => goTo(i)}
            className={cn(
              "h-2 rounded-full transition-all",
              i === index ? "w-6 bg-primary" : "w-2 bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}
