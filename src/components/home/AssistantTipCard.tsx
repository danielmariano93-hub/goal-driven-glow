import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { copy } from "@/lib/copy/strings";
import { NinoErrorBlock } from "@/components/nino/NinoStateBlocks";
import {
  actionLabel,
  recordNinoExposure,
  safeRoute,
  useNinoAct,
  useNinoFeedback,
  useNinoHomeItem,
  useNinoRefresh,
} from "@/lib/nino/intelligence";

/** Dica da Home — sempre alimentada pela inteligência unificada do Nino. */
export function AssistantTipCard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useNinoHomeItem();
  const refresh = useNinoRefresh();
  const feedback = useNinoFeedback();
  const act = useNinoAct();
  const item = data?.item ?? null;

  useEffect(() => {
    if (item?.id) void recordNinoExposure(item.id, "home", 1, `kind=${item.kind}`);
  }, [item?.id, item?.kind]);

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

  const route = safeRoute(item.primary_action, "/app/nino");

  const send = async (kind: "useful" | "dismiss") => {
    if (!item.id) return;
    try {
      await feedback.mutateAsync({ itemId: item.id, feedback: kind, surface: "home" });
      toast.success(copy.tip.thanks);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section
      aria-label={copy.tip.header}
      className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
          {copy.tip.header}
        </p>
        <button
          type="button"
          aria-label="Atualizar leitura do Nino"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="grid h-7 w-7 place-items-center rounded-full transition hover:opacity-80 disabled:opacity-50"
          style={{ border: "1px solid var(--home-hairline)", color: "var(--home-text-2)" }}
        >
          {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>

      <h3
        className="mt-1.5 text-[14px] font-bold leading-snug"
        style={{ color: "var(--home-text-1)", letterSpacing: "-0.01em" }}
      >
        {item.title}
      </h3>
      <p className="mt-1 text-[12px] leading-snug line-clamp-3" style={{ color: "var(--home-text-2)" }}>
        {item.explanation || item.summary}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Link
          to={route}
          onClick={() => item.id && act.mutate({ itemId: item.id, surface: "home" })}
          className="inline-flex items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white transition hover:opacity-95"
          style={{ background: "var(--home-brand-ink)", height: 36 }}
        >
          {actionLabel(item.primary_action, "Ver detalhes", item.kind)}
        </Link>
        {item.id && (
          <>
            <button
              type="button"
              onClick={() => void send("useful")}
              className="text-[12px] font-semibold hover:underline"
              style={{ color: "var(--home-text-2)" }}
            >
              Útil
            </button>
            <button
              type="button"
              onClick={() => void send("dismiss")}
              className="text-[12px] font-semibold hover:underline"
              style={{ color: "var(--home-text-2)" }}
            >
              Agora não
            </button>
          </>
        )}
      </div>
    </section>
  );
}
