import { Loader2 } from "lucide-react";
import { copy } from "@/lib/copy/strings";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import { NinoSituationCard } from "@/components/nino/NinoSituationCard";
import { useNinoDiagnosisContext } from "@/lib/nino/diagnosis";

/** Dica da Home — sempre alimentada pela inteligência unificada do Nino. */
export function AssistantTipCard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useNinoDiagnosisContext();
  const item = data?.primary_situation ?? null;

  if (isLoading) {
    return (
      <section
        aria-label={copy.tip.header}
        className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
        style={{ border: "1px solid var(--home-hairline)", minHeight: 108 }}
      >
        <div className="h-3 w-32 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
        <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
      </section>
    );
  }

  if (isError) {
    return (
      <section aria-label={copy.tip.header}>
        <NinoErrorBlock error={error} onRetry={() => void refetch()} retrying={isFetching} />
      </section>
    );
  }

  if (!item) return null;

  return (
    <section aria-label={copy.tip.header}>
      <NinoSituationCard situation={item} action={data?.primary_action} surface="home" compact />
    </section>
  );
}
