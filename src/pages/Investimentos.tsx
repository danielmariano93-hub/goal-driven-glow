import { useState } from "react";
import { Plus, Trash2, Loader2, Pencil, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useInvestments, useSaveInvestment, useDeleteInvestment, useGoals, type InvestmentRow } from "@/lib/db/finance";
import { investmentSchema } from "@/lib/validation/finance";
import { formatBRL, todayISO } from "@/lib/engine/facts";

const CATEGORIES = ["Renda Fixa", "Tesouro Direto", "Ações", "FIIs", "ETF", "Cripto", "Fundos", "Outros"];

export default function Investimentos() {
  const { data: items, isLoading } = useInvestments();
  const { data: goals } = useGoals();
  const save = useSaveInvestment();
  const del = useDeleteInvestment();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InvestmentRow | null>(null);

  const total = (items ?? []).reduce((a, i) => a + Number(i.current_value), 0);
  const invested = (items ?? []).reduce((a, i) => a + Number(i.invested_amount), 0);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Investimentos</h1>
          <p className="text-sm text-muted-foreground">Portfólio informado por você.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Novo
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Ainda não há dados suficientes</p>
          <p className="mt-1 text-xs text-muted-foreground">Registre seus investimentos para acompanhar o patrimônio.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Valor atual</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatBRL(total)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total aportado</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatBRL(invested)}</p>
            </div>
          </div>
          <ul className="space-y-2">
            {items.map((i) => {
              const goal = goals?.find((g) => g.id === i.goal_id);
              return (
                <li key={i.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.category}
                      {i.institution ? ` · ${i.institution}` : ""}
                      {goal ? ` · meta: ${goal.name}` : ""}
                    </p>
                    <p className="mt-1 text-xs">
                      Investido {formatBRL(Number(i.invested_amount))} · Atual{" "}
                      <span className="font-semibold">{formatBRL(Number(i.current_value))}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditing(i);
                        setOpen(true);
                      }}
                      className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Excluir este investimento?")) del.mutate(i.id, { onSuccess: () => toast.success("Excluído") });
                      }}
                      className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && (
        <InvestmentModal
          initial={editing}
          goals={goals ?? []}
          saving={save.isPending}
          onClose={() => setOpen(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  toast.success("Salvo");
                  setOpen(false);
                },
                onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
              }
            )
          }
        />
      )}
    </div>
  );
}

function InvestmentModal({
  initial,
  goals,
  saving,
  onClose,
  onSubmit,
}: {
  initial: InvestmentRow | null;
  goals: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof investmentSchema.parse>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [invested, setInvested] = useState(initial ? String(initial.invested_amount) : "");
  const [current, setCurrent] = useState(initial ? String(initial.current_value) : "");
  const [refDate, setRefDate] = useState(initial?.reference_date ?? todayISO());
  const [goalId, setGoalId] = useState<string>(initial?.goal_id ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = investmentSchema.safeParse({
      name,
      category,
      institution,
      invested_amount: Number(invested.replace(",", ".")) || 0,
      current_value: Number(current.replace(",", ".")) || 0,
      reference_date: refDate,
      goal_id: goalId || null,
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
        <h2 className="font-display text-lg font-bold">{initial ? "Editar" : "Novo"} investimento</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-base">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Instituição</label>
              <input value={institution ?? ""} onChange={(e) => setInstitution(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor aportado</label>
              <input inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Valor atual</label>
              <input inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Data de referência</label>
              <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Meta ligada</label>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className="input-base">
                <option value="">—</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
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
