import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Loader2, Target, TrendingUp, Users, ArrowRight, Sliders, Info } from "lucide-react";
import { toast } from "sonner";
import {
  useGoals,
  useSaveGoal,
  useDeleteGoal,
  useContributions,
  useAddContribution,
  useDeleteContribution,
  useAccounts,
  useInvestments,
  useCategories,
  useAllTransactions,
  useCategorySpendingGoals,
  useSaveCategorySpendingGoal,
  useDeleteCategorySpendingGoal,
  useUpdateCategorySpendingGoalStatus,
  type GoalRow,
  type CategorySpendingGoalRow,
} from "@/lib/db/finance";
import {
  useSharedGoals,
  useCreateSharedGoal,
  useAcceptSharedGoalInvite,
  useDeclineSharedGoalInvite,
  usePendingSharedGoalInvites,
} from "@/lib/db/sharedGoals";
import { goalSchema, contributionSchema } from "@/lib/validation/finance";
import { behavioralMetricAmount, computeGoalProgress, formatBRL, todayISO } from "@/lib/engine/facts";
import { evaluateCategoryGoal } from "@/lib/engine/metrics";
import { CategoryGoalForm } from "@/components/metas/CategoryGoalForm";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";
import { CategoryGoalStrategyCard } from "@/components/metas/CategoryGoalStrategyCard";
import { GoalStrategyCard } from "@/components/metas/GoalStrategyCard";
import { buildStrategyBase, buildStrategyForGoal, buildStrategyForCategoryGoal } from "@/lib/goals/strategyInputs";
import { computeGoalOverview } from "@/lib/goals/summary";
import { sortCategories } from "@/lib/categories/order";

type GoalTab = "all" | "individual" | "shared";

function GoalTypeRow({ label, value }: { label: string; value: number | null }) {
  return <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value == null ? "Sem meta" : `${Math.round(value)}%`}</dd></div>;
}


export default function Metas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: goals, isLoading } = useGoals();
  const { data: contribs } = useContributions();
  const { data: investments } = useInvestments();
  const save = useSaveGoal();
  const del = useDeleteGoal();
  const addC = useAddContribution();
  const delC = useDeleteContribution();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { data: txs } = useAllTransactions();
  const { data: catGoals } = useCategorySpendingGoals();
  const saveCatGoal = useSaveCategorySpendingGoal();
  const delCatGoal = useDeleteCategorySpendingGoal();
  const toggleCatGoal = useUpdateCategorySpendingGoalStatus();
  const [openGoal, setOpenGoal] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [contribFor, setContribFor] = useState<GoalRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<GoalTab>("all");
  const [openCatGoal, setOpenCatGoal] = useState(false);
  const [openCatList, setOpenCatList] = useState(false);
  const [openNewSelector, setOpenNewSelector] = useState(false);
  const [editingCatGoal, setEditingCatGoal] = useState<CategorySpendingGoalRow | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const goalId = searchParams.get("goal");
    if (!goalId || isLoading || !goals) return;
    // RLS garante que useGoals só devolve metas do próprio usuário.
    const goal = goals.find((g) => g.id === goalId) ?? null;
    if (!goal) {
      toast.info("Esta meta não está mais disponível.");
      const next = new URLSearchParams(searchParams);
      next.delete("goal");
      next.delete("action");
      setSearchParams(next, { replace: true });
      return;
    }
    setTab("individual");
    setExpanded(goalId);
    if (searchParams.get("action") === "recalibrate" && !openGoal) {
      setEditing(goal);
      setOpenGoal(true);
      return;
    }
    requestAnimationFrame(() => document.getElementById(`goal-${goalId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    // openGoal fora das dependências de propósito: reabrir o modal ao fechar seria hostil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, isLoading, searchParams, setSearchParams]);

  const closeGoalModal = () => {
    setOpenGoal(false);
    if (searchParams.get("action")) {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  };



  const numericTxs = useMemo(() => (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as never, [txs]);
  const catNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories ?? []) map[c.id] = c.name;
    return map;
  }, [categories]);
  const catGoalEvals = useMemo(
    () => (catGoals ?? []).map((g) => evaluateCategoryGoal({
      id: g.id, user_id: g.user_id, category_id: g.category_id,
      mode: g.mode as "percent_reduction" | "fixed_limit",
      reduction_pct: g.reduction_pct == null ? null : Number(g.reduction_pct),
      fixed_limit: g.fixed_limit == null ? null : Number(g.fixed_limit),
      baseline_kind: g.baseline_kind as "prev_month" | "avg_3m" | "custom",
      baseline_value: g.baseline_value == null ? null : Number(g.baseline_value),
      computed_limit: Number(g.computed_limit),
      frequency: g.frequency as "once" | "monthly" | "custom",
      start_date: g.start_date,
      end_date: g.end_date,
      status: g.status as "active" | "paused" | "cancelled",
      period_type: (g.period_type as "this_month" | "next_month" | "next_30_days" | "custom" | "monthly_recurring" | undefined),
    }, numericTxs, new Date(), catNameById[g.category_id])),
    [catGoals, numericTxs, catNameById],
  );
  const strategyBase = useMemo(
    () => buildStrategyBase(numericTxs as never, catNameById),
    [numericTxs, catNameById],
  );
  const goalOverview = useMemo(() => computeGoalOverview({
    goals: (goals ?? []).filter((goal) => goal.status === "active").map((goal) => ({ ...goal, target_amount: Number(goal.target_amount), monthly_target: goal.monthly_target == null ? null : Number(goal.monthly_target) })),
    contributions: (contribs ?? []).map((item) => ({ ...item, amount: Number(item.amount) })),
    investments: (investments ?? []).map((item) => ({ goal_id: item.goal_id, current_value: Number(item.current_value) })),
    categoryGoals: catGoalEvals.filter((goal) => goal.goal.status === "active"),
    month: todayISO().slice(0, 7),
    monthlyIncomeByCategory: (numericTxs as unknown as Array<{ category_id?: string | null; occurred_at: string }>).reduce((map: Record<string, number>, tx) => {
      if (tx.occurred_at.slice(0, 7) !== todayISO().slice(0, 7)) return map;
      const value = behavioralMetricAmount(tx as never, "income");
      if (value <= 0) return map;
      const key = tx.category_id ?? "uncategorized";
      map[key] = (map[key] ?? 0) + value;
      return map;
    }, {}),
  }), [goals, contribs, investments, catGoalEvals, numericTxs]);

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground">Guarde dinheiro ou controle um gasto por categoria.</p>
        </div>
        <button
          onClick={() => setOpenNewSelector(true)}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Nova meta
        </button>
      </header>

      <PendingInvitesBanner />

      <section className="mb-4 grid grid-cols-2 gap-3" aria-label="Resumo das metas">
        <div className="rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-muted-foreground">Impacto positivo no mês</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-foreground">{formatBRL(goalOverview.positiveImpactThisMonth)}</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Aportes realizados + economia observada nas categorias.</p>
        </div>
        <details className="group rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <summary className="cursor-pointer list-none">
            <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">Atingimento geral <Info size={13} /></span>
            <span className="mt-1 block font-display text-xl font-bold tabular-nums text-foreground">{Math.round(goalOverview.overallAttainmentPct)}%</span>
            <span className="mt-1 block text-[10px] text-muted-foreground">Toque para ver por tipo.</span>
          </summary>
          <dl className="mt-3 space-y-1 border-t border-border pt-2 text-[10px]">
            <GoalTypeRow label="Financeiras" value={goalOverview.byType.financial} />
            <GoalTypeRow label="Categorias" value={goalOverview.byType.category} />
            <GoalTypeRow label="Doação" value={goalOverview.byType.donation} />
          </dl>
        </details>
      </section>

      <div className="mb-3 grid grid-cols-3 gap-2 rounded-full border border-border bg-card p-1">
        <button
          onClick={() => setTab("all")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Todas
        </button>
        <button
          onClick={() => setTab("individual")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === "individual" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Individuais
        </button>
        <button
          onClick={() => setTab("shared")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === "shared" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Conjuntas
        </button>
      </div>

      {tab !== "all" ? <div className="mb-4 flex items-center justify-end">
        <button
          onClick={() => setOpenCatList((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Sliders size={12} /> Controlar gasto por categoria
        </button>
      </div> : null}

      {(tab === "all" || openCatList) && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Metas por categoria</p>
            <button
              onClick={() => { setEditingCatGoal(null); setOpenCatGoal(true); }}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium"
            >
              <Plus size={12} /> Novo teto
            </button>
          </div>
          {catGoalEvals.length === 0 ? (
            <p className="text-xs text-muted-foreground">Defina um teto de gasto e acompanhe seu ritmo em tempo real.</p>
          ) : (
            <ul className="space-y-3">
              {catGoalEvals.map((ev) => (
                <CategoryGoalCard
                  key={ev.goal.id}
                  evaluation={ev}
                  onEdit={() => { setEditingCatGoal(catGoals?.find((g) => g.id === ev.goal.id) ?? null); setOpenCatGoal(true); }}
                  onDelete={() => { if (confirm("Excluir esta meta?")) delCatGoal.mutate(ev.goal.id, { onSuccess: () => toast.success("Excluída") }); }}
                  onToggleStatus={() => toggleCatGoal.mutate({ id: ev.goal.id, status: ev.goal.status === "active" ? "paused" : "active" })}
                >
                  <CategoryGoalStrategyCard strategy={buildStrategyForCategoryGoal(ev, numericTxs as never)} />
                </CategoryGoalCard>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "shared" ? (
        <SharedGoalsInline />
      ) : (
        <>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !goals || goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Qual sonho você quer tirar do papel?</p>
          <p className="mt-1 text-xs text-muted-foreground">Crie sua primeira meta e comece a guardar dinheiro em pequenos passos.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => {
            const prog = computeGoalProgress(g, contribs ?? [], investments ?? []);
            const goalContribs = (contribs ?? []).filter((c) => c.goal_id === g.id);
            const donationThisMonth = goalContribs.filter((c) => c.occurred_at.slice(0, 7) === todayISO().slice(0, 7)).reduce((sum, c) => sum + Number(c.amount), 0);
            const linkedInvestments = (investments ?? []).filter((i) => i.goal_id === g.id);
            const isOpen = expanded === g.id;
            return (
              <li id={`goal-${g.id}`} key={g.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Meta: {formatBRL(Number(g.target_amount))}
                      {g.target_date ? ` · até ${new Date(g.target_date + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gradient-brand transition-all" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs">
                      <span className="font-semibold tabular-nums">{formatBRL(prog.total)}</span>{" "}
                      <span className="text-muted-foreground">de {formatBRL(Number(g.target_amount))} · faltam {formatBRL(prog.remaining)}</span>
                    </p>
                    {prog.investedLinked > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Investido vinculado: <span className="font-medium text-foreground tabular-nums">{formatBRL(prog.investedLinked)}</span>
                        {prog.contributed > 0 ? ` · Aportes: ${formatBRL(prog.contributed)}` : ""}
                      </p>
                    )}
                    {g.kind === "donation" ? (
                      <p className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-[11px] leading-4 text-success">
                        {donationThisMonth >= Number(g.monthly_target ?? 0) && Number(g.monthly_target ?? 0) > 0
                          ? "Você cumpriu seu compromisso de generosidade neste mês. Continue no seu ritmo."
                          : `${formatBRL(donationThisMonth)} destinados neste mês. Cada passo consciente também faz parte de uma vida financeira saudável.`}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setContribFor(g)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                  >
                    <TrendingUp size={12} /> Guardar
                  </button>
                  <button
                    onClick={() => setExpanded(isOpen ? null : g.id)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                  >
                    {isOpen ? "Ocultar" : `Valores guardados (${goalContribs.length})`}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(g);
                      setOpenGoal(true);
                    }}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Excluir esta meta e seus aportes?")) del.mutate(g.id, { onSuccess: () => toast.success("Excluída") });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive"
                  >
                    <Trash2 size={12} /> Excluir
                  </button>
                </div>
                {g.kind !== "donation" && Number(g.target_amount) > 0 && prog.remaining > 0 ? (
                  <GoalStrategyCard
                    strategy={buildStrategyForGoal(
                      { name: g.name, target_amount: Number(g.target_amount), target_date: g.target_date },
                      prog.total,
                      goalContribs.map((c) => ({ amount: Number(c.amount), occurred_at: c.occurred_at })),
                      strategyBase,
                    )}
                  />
                ) : null}
                {isOpen && goalContribs.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3">
                    {goalContribs.map((c) => (
                      <li key={c.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{new Date(c.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                        <span className="font-medium tabular-nums">{formatBRL(Number(c.amount))}</span>
                        <button
                          onClick={() => delC.mutate(c.id, { onSuccess: () => toast.success("Aporte removido") })}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tab === "all" && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Users size={12} /> Metas conjuntas
          </div>
          <SharedGoalsInline />
        </div>
      )}
        </>
      )}




      {openGoal && (
        <GoalModal
          initial={editing}
          categories={categories ?? []}
          saving={save.isPending}
          onClose={closeGoalModal}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id, status: editing?.status ?? "active" },
              {
                onSuccess: () => {
                  toast.success("Salva");
                  closeGoalModal();
                },
                onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
              }
            )
          }
        />
      )}

      {contribFor && (
        <ContribModal
          goal={contribFor}
          accounts={accounts ?? []}
          saving={addC.isPending}
          onClose={() => setContribFor(null)}
          onSubmit={(v) =>
            addC.mutate(v, {
              onSuccess: () => {
                toast.success("Aporte registrado");
                setContribFor(null);
              },
              onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}

      {openCatGoal && (
        <CategoryGoalForm
          initial={editingCatGoal as never}
          categories={categories ?? []}
          txs={numericTxs}
          saving={saveCatGoal.isPending}
          onClose={() => setOpenCatGoal(false)}
          onSubmit={(v) =>
            saveCatGoal.mutate(v, {
              onSuccess: () => {
                toast.success("Meta salva");
                setOpenCatGoal(false);
              },
              onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}



      {openNewSelector && (
        <NewGoalSelector
          onClose={() => setOpenNewSelector(false)}
          onIndividual={() => { setOpenNewSelector(false); setEditing(null); setOpenGoal(true); }}
          onShared={() => { setOpenNewSelector(false); navigate("/app/metas-conjuntas"); }}
        />
      )}
    </div>
  );
}

function NewGoalSelector({ onClose, onIndividual, onShared }: { onClose: () => void; onIndividual: () => void; onShared: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-display text-base font-bold">Que tipo de meta você quer criar?</h2>
        <p className="mt-1 text-xs text-muted-foreground">Escolha entre uma meta pessoal ou uma conjunta com outras pessoas.</p>
        <div className="mt-4 space-y-2">
          <button onClick={onIndividual} className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left hover:border-primary">
            <div>
              <p className="text-sm font-semibold">Meta individual</p>
              <p className="text-[11px] text-muted-foreground">Guarde dinheiro para um objetivo pessoal.</p>
            </div>
            <Target size={16} className="text-muted-foreground" />
          </button>
          <button onClick={onShared} className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left hover:border-primary">
            <div>
              <p className="text-sm font-semibold">Meta conjunta</p>
              <p className="text-[11px] text-muted-foreground">Convide outras pessoas e evoluam juntas.</p>
            </div>
            <Users size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PendingInvitesBanner() {
  const { data, isLoading } = usePendingSharedGoalInvites();
  const accept = useAcceptSharedGoalInvite();
  const decline = useDeclineSharedGoalInvite();
  if (isLoading || !data || data.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {data.map((inv) => (
        <div key={inv.id} className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium">Você foi convidado para uma meta conjunta</p>
          <p className="mt-0.5 text-sm font-semibold">{inv.shared_goals?.title ?? "Meta conjunta"}</p>
          {inv.shared_goals?.target_amount != null && (
            <p className="text-[11px] text-muted-foreground">Alvo: {formatBRL(Number(inv.shared_goals.target_amount))}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => accept.mutate(inv.goal_id, {
                onSuccess: () => toast.success("Convite aceito"),
                onError: (e) => toast.error(String((e as Error).message)),
              })}
              className="btn-brand px-3 py-1.5 text-xs"
            >
              Aceitar
            </button>
            <button
              onClick={() => decline.mutate(inv.goal_id, { onSuccess: () => toast.success("Convite recusado") })}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs"
            >
              Recusar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}


function GoalModal({
  initial,
  categories,
  saving,
  onClose,
  onSubmit,
}: {
  initial: GoalRow | null;
  categories: Array<{ id: string; name: string; type: string }>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof goalSchema.parse>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState(initial ? String(initial.target_amount) : "");
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [kind, setKind] = useState<"savings" | "donation">(((initial as { kind?: string } | null)?.kind as "savings" | "donation") ?? "savings");
  const [donationMode, setDonationMode] = useState<"fixed" | "income_percent">(
    ((initial as { donation_mode?: string } | null)?.donation_mode as "fixed" | "income_percent") ?? "fixed",
  );
  const [donationPercent, setDonationPercent] = useState(
    (initial as { donation_percent?: number | null } | null)?.donation_percent != null
      ? String((initial as { donation_percent?: number | null }).donation_percent) : "",
  );
  const [monthlyTarget, setMonthlyTarget] = useState(
    (initial as { monthly_target?: number | null } | null)?.monthly_target != null
      ? String((initial as { monthly_target?: number | null }).monthly_target) : "",
  );
  const [donationIncomeScope, setDonationIncomeScope] = useState<"all" | "selected_categories">(
    ((initial as { donation_income_scope?: string } | null)?.donation_income_scope as "all" | "selected_categories") ?? "all",
  );
  const [donationIncomeCategoryIds, setDonationIncomeCategoryIds] = useState<string[]>(
    (initial as { donation_income_category_ids?: string[] | null } | null)?.donation_income_category_ids ?? [],
  );
  const [donationDueDay, setDonationDueDay] = useState(
    Number((initial as { donation_due_day?: number | null } | null)?.donation_due_day ?? 25),
  );
  const [donationEndDate, setDonationEndDate] = useState(
    (initial as { donation_end_date?: string | null } | null)?.donation_end_date ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const toNumber = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = goalSchema.safeParse({
      name,
      target_amount: kind === "donation" && !toNumber(target)
        ? (donationMode === "fixed" ? toNumber(monthlyTarget) : 1)
        : toNumber(target),
      target_date: date || null,
      priority,
      notes,
      kind,
      donation_mode: kind === "donation" ? donationMode : null,
      donation_percent: kind === "donation" && donationMode === "income_percent" ? toNumber(donationPercent) : null,
      monthly_target: kind === "donation" && donationMode === "fixed" ? toNumber(monthlyTarget) : null,
      donation_income_scope: kind === "donation" ? donationIncomeScope : "all",
      donation_income_category_ids: kind === "donation" && donationIncomeScope === "selected_categories" ? donationIncomeCategoryIds : [],
      donation_due_day: kind === "donation" ? donationDueDay : 25,
      donation_end_date: kind === "donation" && donationEndDate ? donationEndDate : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 sm:p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card sm:max-h-[90dvh]">
        <h2 className="shrink-0 px-5 pb-2 pt-5 font-display text-lg font-bold sm:px-6 sm:pt-6">{initial ? "Editar meta" : "Nova meta"}</h2>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 sm:px-6">
          <div>
            <label className="mb-1 block text-xs font-medium">Tipo de meta</label>
            <div className="flex gap-2">
              {([["savings", "Guardar"], ["donation", "Doação"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                  className={`min-h-10 flex-1 rounded-full border px-3 text-xs font-semibold ${kind === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {kind === "donation" ? (
            <div className="space-y-2 rounded-xl border border-border bg-background p-3">
              <label className="block text-xs font-medium">Como você quer doar?</label>
              <select value={donationMode} onChange={(e) => setDonationMode(e.target.value as "fixed" | "income_percent")} className="input-base">
                <option value="fixed">Valor fixo por mês</option>
                <option value="income_percent">Percentual da receita do mês</option>
              </select>
              {donationMode === "fixed" ? (
                <div>
                  <label className="mb-1 block text-xs font-medium">Valor mensal (R$)</label>
                  <input inputMode="decimal" value={monthlyTarget} onChange={(e) => setMonthlyTarget(e.target.value)} className="input-base" placeholder="0,00" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Percentual da receita (%)</label>
                    <input inputMode="decimal" value={donationPercent} onChange={(e) => setDonationPercent(e.target.value)} className="input-base" placeholder="5" />
                  </div>
                  <select value={donationIncomeScope} onChange={(e) => setDonationIncomeScope(e.target.value as "all" | "selected_categories")} className="input-base">
                    <option value="all">Considerar todas as receitas</option>
                    <option value="selected_categories">Escolher tipos de receita</option>
                  </select>
                  {donationIncomeScope === "selected_categories" ? (
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
                      {sortCategories(categories.filter((category) => category.type === "income")).map((category) => (
                        <label key={category.id} className="flex min-h-8 items-center gap-2 text-xs">
                          <input type="checkbox" checked={donationIncomeCategoryIds.includes(category.id)} onChange={(e) => setDonationIncomeCategoryIds((ids) => e.target.checked ? [...ids, category.id] : ids.filter((id) => id !== category.id))} />
                          {category.name}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><label className="mb-1 block text-xs font-medium">Dia do compromisso</label><input type="number" min={1} max={28} value={donationDueDay} onChange={(e) => setDonationDueDay(Number(e.target.value) || 25)} className="input-base" /></div>
                <div><label className="mb-1 block text-xs font-medium">Até quando</label><input type="date" value={donationEndDate} onChange={(e) => setDonationEndDate(e.target.value)} className="input-base" /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">A doação entra como compromisso do mês nas projeções do Nino.</p>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">{kind === "donation" ? "Alvo total (opcional)" : "Valor alvo (R$)"}</label>
              <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data alvo</label>
              <input type="date" value={date ?? ""} onChange={(e) => setDate(e.target.value)} className="input-base" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Prioridade (1 alta – 5 baixa)</label>
            <input type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(Number(e.target.value) || 3)} className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Notas</label>
            <textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} className="input-base min-h-20" />
          </div>
        </div>
        <div className="shrink-0 border-t border-border bg-card px-5 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
        </div>
      </form>
    </div>
  );
}

function ContribModal({
  goal,
  accounts,
  saving,
  onClose,
  onSubmit,
}: {
  goal: GoalRow;
  accounts: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof contributionSchema.parse>) => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = contributionSchema.safeParse({
      goal_id: goal.id,
      amount: Number(amount.replace(",", ".")),
      occurred_at: date,
      account_id: accountId || null,
      notes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Guardar em "{goal.name}"</h2>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor</label>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Conta (opcional)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Nota</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SharedGoalsInline() {
  const { data: goals, isLoading } = useSharedGoals();
  if (isLoading) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!goals || goals.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <Users className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Nenhuma meta conjunta ainda</p>
        <p className="mt-1 text-xs text-muted-foreground">Junte com amigos, família ou parceria para uma meta em comum.</p>
        <Link to="/app/metas-conjuntas" className="btn-brand mt-4 inline-flex items-center gap-2 text-xs">
          <Plus size={12} /> Criar meta conjunta
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {goals.map((g) => (
        <Link key={g.id} to={`/app/metas-conjuntas/${g.id}`} className="surface-card flex items-center justify-between p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{g.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Meta {formatBRL(Number(g.target_amount))}
              {g.deadline ? ` · até ${new Date(g.deadline + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <ArrowRight size={14} className="text-muted-foreground" />
        </Link>
      ))}
      <div className="pt-1 text-center">
        <Link to="/app/metas-conjuntas" className="text-xs font-medium text-primary underline">
          Ver todas
        </Link>
      </div>
    </div>
  );
}
