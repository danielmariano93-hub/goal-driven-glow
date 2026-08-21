import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, TrendingUp } from "lucide-react";
import {
  useGoals,
  useContributions,
  useInvestments,
  useCategories,
  useLedgerWindow,
} from "@/lib/db/finance";
import { computeGoalProgress, formatBRL, todayISO } from "@/lib/engine/facts";
import { GoalStrategyCard } from "@/components/metas/GoalStrategyCard";
import { buildStrategyBase, buildStrategyForGoal } from "@/lib/goals/strategyInputs";

export default function MetaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { data: goals, isLoading } = useGoals();
  const { data: contribs } = useContributions();
  const { data: investments } = useInvestments();
  const { data: categories } = useCategories();
  const { data: txs } = useLedgerWindow();

  const goal = (goals ?? []).find((g) => g.id === id) ?? null;
  const numericTxs = useMemo(() => (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })), [txs]);
  const catNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories ?? []) map[c.id] = c.name;
    return map;
  }, [categories]);
  const strategyBase = useMemo(() => buildStrategyBase(numericTxs as never, catNameById), [numericTxs, catNameById]);

  const goalContribs = useMemo(
    () => (contribs ?? []).filter((c) => c.goal_id === id),
    [contribs, id],
  );
  const linkedInvestments = useMemo(
    () => (investments ?? []).filter((i) => i.goal_id === id),
    [investments, id],
  );

  if (isLoading) {
    return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!goal) {
    return (
      <div className="pt-2">
        <Link to="/app/metas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeft size={14} /> Metas</Link>
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium">Esta meta não está mais disponível.</p>
        </div>
      </div>
    );
  }

  const prog = computeGoalProgress(goal, contribs ?? [], investments ?? []);
  const donationThisMonth = goalContribs
    .filter((c) => c.occurred_at.slice(0, 7) === todayISO().slice(0, 7))
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const strategy = buildStrategyForGoal(
    { name: goal.name, target_amount: Number(goal.target_amount), target_date: goal.target_date },
    prog.total,
    goalContribs.map((c) => ({ amount: Number(c.amount), occurred_at: c.occurred_at })),
    strategyBase,
  );

  return (
    <div className="pb-8 pt-2">
      <Link to="/app/metas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowLeft size={14} /> Metas</Link>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">{goal.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Meta: {formatBRL(Number(goal.target_amount))}
        {goal.target_date ? ` · até ${new Date(goal.target_date + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
      </p>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-brand transition-all" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
        </div>
        <p className="mt-2 text-sm">
          <span className="font-semibold tabular-nums">{formatBRL(prog.total)}</span>{" "}
          <span className="text-muted-foreground">de {formatBRL(Number(goal.target_amount))} · faltam {formatBRL(prog.remaining)}</span>
        </p>
        {prog.investedLinked > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Investido vinculado: <span className="font-medium text-foreground tabular-nums">{formatBRL(prog.investedLinked)}</span>
            {prog.contributed > 0 ? ` · Aportes: ${formatBRL(prog.contributed)}` : ""}
          </p>
        )}
        {goal.kind === "donation" ? (
          <p className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-[11px] leading-4 text-success">
            {donationThisMonth >= Number(goal.monthly_target ?? 0) && Number(goal.monthly_target ?? 0) > 0
              ? "Você cumpriu seu compromisso de generosidade neste mês. Continue no seu ritmo."
              : `${formatBRL(donationThisMonth)} destinados neste mês.`}
          </p>
        ) : null}

        {goal.kind !== "donation" && Number(goal.target_amount) > 0 ? (
          <GoalStrategyCard strategy={strategy} />
        ) : null}

        <Link to={`/app/metas?goal=${goal.id}`} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          <TrendingUp size={12} /> Guardar dinheiro
        </Link>
      </section>

      {linkedInvestments.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Investimentos vinculados</p>
          <ul className="mt-2 divide-y divide-border">
            {linkedInvestments.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="truncate text-muted-foreground">{i.name ?? "Investimento"}</span>
                <span className="font-semibold tabular-nums">{formatBRL(Number(i.current_value))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Valores guardados</p>
          <span className="text-[11px] text-muted-foreground">{goalContribs.length}</span>
        </div>
        {goalContribs.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nenhum aporte registrado ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {goalContribs.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="text-muted-foreground">{new Date(c.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                <span className="font-semibold tabular-nums">{formatBRL(Number(c.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
