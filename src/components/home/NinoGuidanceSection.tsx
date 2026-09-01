// Bloco editorial do Nino na Home (nino_home_editorial.v1).
// UMA orientação principal (Spotlight) + até três leituras compactas
// (Insight Stack) + acesso à superfície completa. Sem carrossel, sem swipe,
// sem dots: a Home apresenta a escolha, a profundidade fica na tela do Nino.
import { useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import { NinoEditorialSkeleton } from "@/components/home/nino/NinoEditorialSkeleton";
import { NinoInsightRow } from "@/components/home/nino/NinoInsightRow";
import { NinoSpotlightCard } from "@/components/home/nino/NinoSpotlightCard";
import { trackNinoEditorial } from "@/lib/analytics/ninoEditorial";
import { buildNinoHomeEditorialView } from "@/lib/nino/homeEditorial";
import { useNinoNextStep, useNinoNextStepDecision } from "@/lib/nino/nextStep";
import type { HomeDiagnosisView, NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import { notifyError } from "@/lib/ui/feedback";

type Props = {
  diagnosis: HomeDiagnosisView | null;
  context: NinoDiagnosisContext | null;
  loading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
};

export function NinoGuidanceSection({ diagnosis, context, loading, error, retrying, onRetry }: Props) {
  const nextStep = useNinoNextStep();
  const decision = useNinoNextStepDecision();
  const [accepted, setAccepted] = useState<string | null>(null);

  const view = useMemo(
    () => buildNinoHomeEditorialView({ context, diagnosis, nextStep: nextStep.data ?? null }),
    [context, diagnosis, nextStep.data],
  );

  if (loading) return <NinoEditorialSkeleton />;

  if (error) {
    return (
      <section aria-label="Orientação do Nino" className="rounded-[20px] border border-border bg-card p-4">
        <NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} />
      </section>
    );
  }

  if (!view.primary && view.supporting.length === 0) return null;

  return (
    <div className="space-y-5">
      {view.primary ? (
        <NinoSpotlightCard
          item={view.primary}
          accepting={decision.isPending}
          acceptedMessage={accepted}
          onAccept={() => {
            decision.mutate("accept", {
              onSuccess: (payload) => setAccepted(payload.message ?? "Combinado. Vou acompanhar esse passo com você."),
              onError: (e) => notifyError("Não consegui registrar sua decisão agora.", e instanceof Error ? e.message : undefined),
            });
          }}
        />
      ) : null}

      {view.supporting.length > 0 ? (
        <section aria-label="Também vale saber">
          <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Também vale saber</h3>
          <div className="divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-card">
            {view.supporting.map((item) => (
              <NinoInsightRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      <Link
        to="/app/nino"
        aria-label="Ver todas as orientações do Nino"
        onClick={() => trackNinoEditorial("nino_view_all", { surface: "home" })}
        className="-mt-1 inline-flex min-h-[24px] items-center gap-1 px-1 text-[14px] font-semibold text-primary underline-offset-4 hover:underline"
      >
        Ver todas no Nino
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </Link>

    </div>
  );
}
