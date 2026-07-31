import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, ChevronRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { loadNinoContext } from "@/lib/nino/client";

export function BehavioralInsightsCard() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["nino-context"],
    queryFn: loadNinoContext,
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const hypotheses = (query.data?.hypotheses ?? [])
    .filter((item) => ["pending", "confirmed", "partial"].includes(item.status))
    .slice(0, 3);

  if (hypotheses.length === 0) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Inteligência comportamental</h2>
            <p className="text-xs text-muted-foreground">
              Ainda não há amostra suficiente para identificar padrões confiáveis.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">Sinais percebidos pelo Nino</h2>
          <p className="text-xs text-muted-foreground">Hipóteses explicáveis para você confirmar ou descartar.</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {hypotheses.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.explanation}</p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px]">
                {Math.round(Number(item.confidence) * 100)}%
              </span>
            </div>
          </article>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate("/app/assessor/acompanhamento")}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
      >
        Revisar hipóteses <ChevronRight size={13} />
      </button>
    </section>
  );
}
