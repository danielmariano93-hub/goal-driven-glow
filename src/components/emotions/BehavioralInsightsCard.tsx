import { BrainCircuit, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { BehaviorHypothesis } from "@/lib/behavioral/client";

function evidenceLabel(confidence: number) {
  if (confidence >= 0.8) return "Evidência forte";
  if (confidence >= 0.65) return "Evidência moderada";
  return "Evidência inicial";
}

export function BehavioralInsightsCard({ hypotheses: rawHypotheses = [] }: { hypotheses?: BehaviorHypothesis[] }) {
  const navigate = useNavigate();
  const seen = new Set<string>();
  const hypotheses = rawHypotheses
    .filter((item) => ["pending", "confirmed", "partial"].includes(item.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((item) => {
      if (seen.has(item.kind)) return false;
      seen.add(item.kind);
      return true;
    })
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
          <p className="text-xs text-muted-foreground">Hipóteses explicáveis para você confirmar ou descartar. A força abaixo não é probabilidade.</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {hypotheses.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{item.title}</p>
                <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">{item.explanation}</p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {evidenceLabel(Number(item.confidence))}
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
