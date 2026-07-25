import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, Target, Users, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  useSharedGoals,
  useCreateSharedGoal,
  useCancelSharedGoal,
  type SharedGoal,
} from "@/lib/db/sharedGoals";
import { formatBRL } from "@/lib/engine/facts";

export default function MetasConjuntas() {
  const { data: goals, isLoading } = useSharedGoals();
  const create = useCreateSharedGoal();
  const cancel = useCancelSharedGoal();
  const [openNew, setOpenNew] = useState(false);

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Metas conjuntas</h1>
          <p className="text-sm text-muted-foreground">Junte dinheiro com outras pessoas por um objetivo comum.</p>
        </div>
        <button onClick={() => setOpenNew(true)} className="btn-brand inline-flex items-center gap-2">
          <Plus size={14} /> Nova
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !goals || goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Qual sonho vai virar plano coletivo?</p>
          <p className="mt-1 text-xs text-muted-foreground">Convide amigos ou família e acompanhem a evolução juntos.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onCancel={() => {
                if (confirm("Cancelar esta meta conjunta?")) cancel.mutate(g.id, { onSuccess: () => toast.success("Cancelada") });
              }}
            />
          ))}
        </ul>
      )}

      {openNew && (
        <NewGoalModal
          saving={create.isPending}
          onClose={() => setOpenNew(false)}
          onSubmit={(v) =>
            create.mutate(v, {
              onSuccess: () => {
                toast.success("Meta criada");
                setOpenNew(false);
              },
              onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}
    </div>
  );
}

function GoalCard({ goal, onCancel }: { goal: SharedGoal; onCancel: () => void }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{goal.title}</p>
          <p className="text-xs text-muted-foreground">
            Meta: {formatBRL(Number(goal.target_amount))}
            {goal.deadline ? ` · até ${new Date(goal.deadline + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
          </p>
        </div>
        {goal.status !== "cancelled" && goal.status !== "completed" && (
          <button onClick={onCancel} className="text-muted-foreground hover:text-destructive" aria-label="Cancelar">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Users size={12} /> conjunta{goal.status === "cancelled" ? " · cancelada" : goal.status === "completed" ? " · concluída" : ""}
        </span>
        <Link
          to={`/app/metas-conjuntas/${goal.id}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
        >
          Abrir <ArrowRight size={12} />
        </Link>
      </div>
    </li>
  );
}

function NewGoalModal({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: { title: string; target_amount: number; deadline: string | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(() => title.trim().length >= 2 && Number(target.replace(",", ".")) > 0, [title, target]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("Preencha título e valor.");
      return;
    }
    onSubmit({ title: title.trim(), target_amount: Number(target.replace(",", ".")), deadline: deadline || null });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Nova meta conjunta</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" placeholder="Viagem em família" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor alvo (R$)</label>
              <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Prazo (opcional)</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input-base" />
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !valid} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
