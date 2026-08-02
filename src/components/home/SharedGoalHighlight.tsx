import { Link } from "react-router-dom";
import { Users, ArrowRight } from "lucide-react";
import { useSharedGoals, useSharedGoalContribs } from "@/lib/db/sharedGoals";
import { computeGoalProgressFacts, formatBRL } from "@/lib/engine/facts";

/**
 * Destaque de meta conjunta na Home.
 * Mostra a meta conjunta ativa mais recente com progresso e CTA.
 * Não renderiza nada se não houver metas ativas.
 */
export function SharedGoalHighlight() {
  const { data: goals, isLoading } = useSharedGoals();
  const active = (goals ?? []).filter((g) => g.status === "active");
  const goal = active[0];
  const { data: contribs = [] } = useSharedGoalContribs(goal?.id);

  if (isLoading) return null;
  if (!goal) return null;

  const target = Number(goal.target_amount);
  const { total, pct } = computeGoalProgressFacts(
    target,
    goal.id,
    contribs.map((c) => ({ goal_id: goal.id, amount: Number(c.amount) })),
  );

  return (
    <Link
      to={`/app/metas-conjuntas/${goal.id}`}
      className="surface-card block p-4 transition-colors hover:border-primary"
      aria-label={`Abrir meta conjunta ${goal.title}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Users size={11} /> Meta conjunta
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{goal.title}</p>
        </div>
        <ArrowRight size={14} className="text-muted-foreground" />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-gradient-brand transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-[11px]">
        <span className="font-semibold tabular-nums">{formatBRL(total)}</span>{" "}
        <span className="text-muted-foreground">de {formatBRL(target)}</span>
      </p>
    </Link>
  );
}
