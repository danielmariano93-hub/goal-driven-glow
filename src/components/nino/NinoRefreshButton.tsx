import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { NinoRpcError, useNinoRefresh, type NinoRefreshSummary } from "@/lib/nino/intelligence";
import { updatedAtLabel } from "@/lib/nino/format";

/**
 * Botão Atualizar com estados inequívocos:
 * pressão, processando, sucesso (após refetch), erro com retry e horário da última atualização.
 */
export function NinoRefreshButton({ asOf }: { asOf?: string | null }) {
  const refresh = useNinoRefresh();
  const [last, setLast] = useState<NinoRefreshSummary | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const busy = refresh.isPending;

  const run = () => {
    if (busy) return;
    setFailed(null);
    refresh.mutate(undefined, {
      onSuccess: (summary) => {
        setLast(summary);
        const changed = summary.created + summary.updated + summary.superseded + summary.expired;
        toast.success("Leituras atualizadas agora", {
          description: changed
            ? `${summary.created} novas · ${summary.updated} atualizadas · ${summary.superseded + summary.expired} encerradas`
            : "Nenhuma mudança desde a última leitura.",
        });
      },
      onError: (e) => {
        const message =
          e instanceof NinoRpcError && e.kind === "auth"
            ? "Sua sessão expirou. Entre novamente."
            : "Não conseguimos atualizar agora.";
        setFailed(message);
        toast.error(message, { description: "Seus dados anteriores continuam na tela." });
      },
    });
  };

  const stamp = last?.at ?? asOf ?? null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? "Atualizando leituras do Nino" : "Atualizar leituras do Nino"}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-3.5 text-[12px] font-semibold text-muted-foreground transition active:scale-[0.97] active:bg-muted disabled:opacity-70"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : last ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {busy ? "Atualizando…" : "Atualizar"}
      </button>

      <p aria-live="polite" className="text-right text-[10px] font-medium" style={{ color: "var(--home-text-3)" }}>
        {busy
          ? "Recalculando leituras…"
          : failed
            ? failed
            : stamp
              ? updatedAtLabel(stamp)
              : ""}
      </p>
      {failed && (
        <button
          type="button"
          onClick={run}
          className="text-[11px] font-semibold underline"
          style={{ color: "var(--home-text-2)" }}
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
