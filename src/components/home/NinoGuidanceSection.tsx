// Hierarquia editorial da Home: no máximo UMA orientação principal do Nino.
// Quando o diagnóstico e o próximo passo são a mesma decisão, existe um único
// card. Quando são decisões diferentes, o risco vem primeiro e as leituras
// secundárias continuam na rotação já existente.
import { useMemo, useState } from "react";
import { NinoDecisionCard } from "@/components/home/NinoDecisionCard";
import { NinoGuidanceCard } from "@/components/home/NinoGuidanceCard";
import { composeNinoDecisionNarrative } from "@/lib/copy/decisionNarrative";
import { useNinoNextStep, useNinoNextStepDecision } from "@/lib/nino/nextStep";
import type { HomeDiagnosisView, NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { notifyError } from "@/lib/ui/feedback";

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

  return (
    <div className="space-y-4">
      {criticalFirst ? readings : null}
      {decisionCard}
      {criticalFirst ? null : readings}
    </div>
  );
}
