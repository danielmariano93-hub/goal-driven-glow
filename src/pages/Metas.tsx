import { useState } from "react";
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
  type GoalRow,
} from "@/lib/db/finance";
import { goalSchema, contributionSchema } from "@/lib/validation/finance";
import { computeGoalProgress, formatBRL, todayISO } from "@/lib/engine/facts";

export default function Metas() {
  const { data: goals, isLoading } = useGoals();
  const { data: contribs } = useContributions();
  const save = useSaveGoal();
  const del = useDeleteGoal();
  const addC = useAddContribution();
  const delC = useDeleteContribution();
  const { data: accounts } = useAccounts();
  const [openGoal, setOpenGoal] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [contribFor, setContribFor] = useState<GoalRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground">Progresso calculado a partir dos aportes.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setOpenGoal(true);
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Nova meta
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !goals || goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Você ainda não tem metas</p>
          <p className="mt-1 text-xs text-muted-foreground">Crie sua primeira meta e comece a aportar.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => {
            const prog = computeGoalProgress(g, contribs ?? []);
            const goalContribs = (contribs ?? []).filter((c) => c.goal_id === g.id);
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
                      <span className="font-semibold">{formatBRL(prog.contributed)}</span>{" "}
                      <span className="text-muted-foreground">de {formatBRL(Number(g.target_amount))} · faltam {formatBRL(prog.remaining)}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setContribFor(g)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                  >
                    <TrendingUp size={12} /> Aportar
                  </button>
                  <button
                    onClick={() => setExpanded(isOpen ? null : g.id)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                  >
                    {isOpen ? "Ocultar aportes" : `Aportes (${goalContribs.length})`}
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
        <h2 className="font-display text-lg font-bold">Aportar em "{goal.name}"</h2>
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aportar"}
          </button>
        </div>
      </form>
    </div>
  );
}
