import { Link } from "react-router-dom";
import { ArrowRight, Target } from "lucide-react";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";
import { formatBRL } from "@/lib/engine/facts";
import { PulseHero } from "./PulseHero";

const STATUS_BAR: Record<CategoryGoalEvaluation["status"], string> = {
  on_track: "bg-emerald-500",
  attention: "bg-amber-500",
  at_risk: "bg-orange-500",
  exceeded: "bg-red-500",
};

/**
 * Card de evolução financeira: mostra a meta de categoria mais relevante em
 * destaque; se não houver, exibe apenas o Pulso. Integração leve dos dois sinais.
 */
export function EvolucaoFinanceiraCard({ topGoal }: { topGoal: CategoryGoalEvaluation | null }) {
  return (
    <section
      aria-label="Evolução financeira"
      className="rounded-[20px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <p
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
      >
        Evolução financeira
      </p>

      {topGoal ? (
        <Link to="/app/metas" className="mt-2 block">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold" style={{ color: "var(--home-text-1)" }}>
              {topGoal.categoryName ?? "Meta de categoria"}
            </p>
            <ArrowRight size={14} style={{ color: "var(--home-text-3)" }} />
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${STATUS_BAR[topGoal.status]}`}
              style={{ width: `${Math.round(Math.min(1, Math.max(0, topGoal.utilizationPct)) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] tabular-nums" style={{ color: "var(--home-text-2)" }}>
            {formatBRL(topGoal.spent)} de {formatBRL(topGoal.limit)}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--home-text-3)" }}>{topGoal.message}</p>
        </Link>
      ) : (
        <Link
          to="/app/metas"
          className="mt-2 flex items-center gap-2 rounded-[14px] border border-dashed border-border px-3 py-2.5 text-left"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: "var(--home-surface-soft)", color: "var(--home-brand-violet)" }}>
            <Target size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold" style={{ color: "var(--home-text-1)" }}>Crie uma meta por categoria</span>
            <span className="block text-[11px]" style={{ color: "var(--home-text-3)" }}>Defina um teto e acompanhe seu ritmo aqui.</span>
          </span>
          <ArrowRight size={14} style={{ color: "var(--home-text-3)" }} />
        </Link>
      )}

      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--home-hairline)" }}>
        <PulseHero />
      </div>
    </section>
  );
}
