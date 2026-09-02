// Bloco editorial do Nino na Home (nino_home_editorial.v3).
// UMA orientação principal (Spotlight) + até três leituras compactas
// (Insight Stack) + acesso à superfície completa. Sem carrossel, sem swipe,
// sem dots: a Home apresenta a escolha, a profundidade fica na tela do Nino.
// Cada elemento permite pedir outra leitura — substituição neutra, no lugar.
import { useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import { NinoEditorialSkeleton } from "@/components/home/nino/NinoEditorialSkeleton";
import { NinoInsightRow } from "@/components/home/nino/NinoInsightRow";
import { NinoSpotlightCard } from "@/components/home/nino/NinoSpotlightCard";
import { trackNinoEditorial } from "@/lib/analytics/ninoEditorial";
import { buildNinoHomeEditorialView } from "@/lib/nino/homeEditorial";
import { useNinoEditorialRotation } from "@/lib/nino/editorialRotation";
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

  const rotation = useNinoEditorialRotation(view);

  if (loading) return <NinoEditorialSkeleton />;

  if (error) {
    return (
      <section aria-label="Orientação do Nino" className="rounded-[20px] border border-border bg-card p-4">
        <NinoErrorBlock error={error} onRetry={onRetry} retrying={retrying} />
      </section>
    );
  }

  const primary = rotation.primary;

  if (!primary) return null;


  return (
    <div className="space-y-3.5">
      {primary ? (
        <NinoSpotlightCard
          item={primary}
          accepting={decision.isPending}
          acceptedMessage={accepted}
          canRequestNext={rotation.canReplacePrimary}
          requestNextNotice={rotation.primaryNotice}
          onRequestNext={() => {
            const replacement = rotation.replacePrimary();
            // Pedir outra leitura NÃO é dispensa: só sinal editorial neutro.
            trackNinoEditorial("nino_primary_next_requested", {
              surface: "home",
              current_item_id: primary.id,
              replacement_item_id: replacement?.id ?? null,
              semantic_type: primary.semanticType,
              position: 0,
              action: "view_next_requested",
            });
          }}
          onAccept={() => {
            decision.mutate("accept", {
              onSuccess: (payload) => setAccepted(payload.message ?? "Combinado. Vou acompanhar esse passo com você."),
              onError: (e) => notifyError("Não consegui registrar sua decisão agora.", e instanceof Error ? e.message : undefined),
            });
          }}
        />
      ) : null}

      {/* A Home mostra UMA orientação. Explorar outras leituras acontece pelo
          "Outra orientação" do próprio card ou na tela do Nino. */}


      <Link
        to="/app/nino"
        aria-label="Ver todas as orientações do Nino"
        onClick={() => trackNinoEditorial("nino_view_all", { surface: "home" })}
        className="-mt-0.5 inline-flex min-h-[22px] items-center gap-1 px-1 text-[12.5px] font-semibold text-primary underline-offset-4 hover:underline"
      >
        Ver todas no Nino
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </Link>

    </div>
  );
}
