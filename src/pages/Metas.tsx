import { useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Target, TrendingUp } from "lucide-react";
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
import { goalSchema, contributionSchema } from "@/lib/validation/finance";
import { computeGoalProgress, formatBRL, todayISO } from "@/lib/engine/facts";
import { evaluateCategoryGoal } from "@/lib/engine/metrics";
import { CategoryGoalForm } from "@/components/metas/CategoryGoalForm";
import { CategoryGoalCard } from "@/components/metas/CategoryGoalCard";

type GoalTab = "save" | "category";

export default function Metas() {
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
  const [tab, setTab] = useState<GoalTab>("save");
  const [openCatGoal, setOpenCatGoal] = useState(false);
  const [editingCatGoal, setEditingCatGoal] = useState<CategorySpendingGoalRow | null>(null);

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
    }, numericTxs, new Date(), catNameById[g.category_id])),
    [catGoals, numericTxs, catNameById],
  );

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground">Guarde dinheiro ou controle um gasto por categoria.</p>
        </div>
        <button
          onClick={() => {
            if (tab === "save") { setEditing(null); setOpenGoal(true); }
            else { setEditingCatGoal(null); setOpenCatGoal(true); }
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Nova meta
        </button>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-full border border-border bg-card p-1">
        <button
          onClick={() => setTab("save")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === "save" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Juntar dinheiro
        </button>
        <button
          onClick={() => setTab("category")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === "category" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Controlar gasto
        </button>
      </div>

      {tab === "category" ? (
        catGoalEvals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <Target className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Qual categoria você quer controlar?</p>
            <p className="mt-1 text-xs text-muted-foreground">Defina um teto de gasto e acompanhe seu ritmo em tempo real.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {catGoalEvals.map((ev) => (
              <CategoryGoalCard
                key={ev.goal.id}
                evaluation={ev}
                onEdit={() => { setEditingCatGoal(catGoals?.find((g) => g.id === ev.goal.id) ?? null); setOpenCatGoal(true); }}
                onDelete={() => {
                  if (confirm("Excluir esta meta?")) delCatGoal.mutate(ev.goal.id, { onSuccess: () => toast.success("Excluída") });
                }}
                onToggleStatus={() => toggleCatGoal.mutate({
                  id: ev.goal.id,
                  status: ev.goal.status === "active" ? "paused" : "active",
                })}
              />
            ))}
          </ul>
        )
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
            const linkedInvestments = (investments ?? []).filter((i) => i.goal_id === g.id);
            const isOpen = expanded === g.id;
            return (
              <li key={g.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
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
        </>
      )}



      {openGoal && (
        <GoalModal
          initial={editing}
          saving={save.isPending}
          onClose={() => setOpenGoal(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id, status: editing?.status ?? "active" },
              {
                onSuccess: () => {
                  toast.success("Salva");
                  setOpenGoal(false);
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
    </div>
  );
}

function GoalModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: GoalRow | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof goalSchema.parse>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState(initial ? String(initial.target_amount) : "");
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = goalSchema.safeParse({
      name,
      target_amount: Number(target.replace(",", ".")),
      target_date: date || null,
      priority,
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
        <h2 className="font-display text-lg font-bold">{initial ? "Editar meta" : "Nova meta"}</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor alvo (R$)</label>
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
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
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
