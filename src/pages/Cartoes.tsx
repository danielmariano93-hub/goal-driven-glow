import { useMemo, useState } from "react";
import { Plus, CreditCard, Pencil, Trash2, Loader2 } from "lucide-react";
import { useCreditCards, useSaveCreditCard, useDeleteCreditCard, type CreditCardRow } from "@/lib/db/creditCards";
import { useAllTransactions } from "@/lib/db/finance";
import { creditCardSchema } from "@/lib/validation/creditCards";
import { formatBRL, currentMonthYM } from "@/lib/engine/facts";
import { toast } from "sonner";

export default function Cartoes() {
  const { data: cards, isLoading } = useCreditCards();
  const { data: txs } = useAllTransactions();
  const [editing, setEditing] = useState<CreditCardRow | null>(null);
  const [open, setOpen] = useState(false);
  const save = useSaveCreditCard();
  const del = useDeleteCreditCard();
  const ym = currentMonthYM();

  const stats = useMemo(() => {
    const byCard: Record<string, { current: number; next: number; total: number }> = {};
    for (const t of txs ?? []) {
      const anyT = t as unknown as { credit_card_id?: string | null; competence_date?: string | null; amount: number };
      const cid = anyT.credit_card_id;
      const comp = anyT.competence_date;
      if (!cid || !comp) continue;
      byCard[cid] ||= { current: 0, next: 0, total: 0 };
      const compYM = comp.slice(0, 7);
      const amt = Number(anyT.amount) || 0;
      byCard[cid].total += amt;
      if (compYM === ym) byCard[cid].current += amt;
      // próxima fatura
      const [y, m] = ym.split("-").map(Number);
      const next0 = m; // m0+1 = m
      const nextYM = `${next0 === 12 ? y + 1 : y}-${String((next0 % 12) + 1).padStart(2, "0")}`;
      if (compYM === nextYM) byCard[cid].next += amt;
    }
    return byCard;
  }, [txs, ym]);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Cartões</h1>
          <p className="text-sm text-muted-foreground">Faturas, limites e parcelas.</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-brand inline-flex items-center gap-2">
          <Plus size={14} /> Novo cartão
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !cards || cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Ainda não há cartões cadastrados</p>
          <p className="mt-1 text-xs text-muted-foreground">Cadastre um cartão para acompanhar a fatura e o uso do limite.</p>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-brand mt-4 inline-flex items-center gap-2">
            <Plus size={14} /> Cadastrar cartão
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => {
            const st = stats[c.id] ?? { current: 0, next: 0, total: 0 };
            const usedPct = c.total_limit > 0 ? Math.min(1, st.total / Number(c.total_limit)) : 0;
            const available = Math.max(0, Number(c.total_limit) - st.total);
            return (
              <li key={c.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{c.name}{c.last_four ? ` •••• ${c.last_four}` : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      Fecha dia {c.closing_day} · Vence dia {c.due_day}
                      {c.brand ? ` · ${c.brand}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditing(c); setOpen(true); }} className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Editar">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Excluir este cartão? Só é possível se não houver lançamentos vinculados.")) {
                          del.mutate(c.id, {
                            onError: (e: unknown) => toast.error("Não foi possível excluir", { description: String((e as Error).message) }),
                            onSuccess: () => toast.success("Cartão excluído"),
                          });
                        }
                      }}
                      className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                      aria-label="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <Stat label="Fatura atual" value={formatBRL(st.current)} />
                  <Stat label="Próxima" value={formatBRL(st.next)} />
                  <Stat label="Disponível" value={formatBRL(available)} />
                </div>
                {c.total_limit > 0 && (
                  <div className="mt-3">
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${usedPct > 0.85 ? "bg-destructive" : usedPct > 0.7 ? "bg-warning" : "bg-primary"}`}
                        style={{ width: `${Math.round(usedPct * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {Math.round(usedPct * 100)}% do limite de {formatBRL(Number(c.total_limit))}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <CardFormModal
          initial={editing}
          onClose={() => setOpen(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  toast.success(editing ? "Cartão atualizado" : "Cartão criado");
                  setOpen(false);
                },
                onError: (e: unknown) => toast.error("Não foi possível salvar", { description: String((e as Error).message) }),
              }
            )
          }
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/50 p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CardFormModal({
  initial,
  onClose,
  onSubmit,
  saving,
}: {
  initial: CreditCardRow | null;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof creditCardSchema.parse>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [lastFour, setLastFour] = useState(initial?.last_four ?? "");
  const [limitStr, setLimitStr] = useState(String(initial?.total_limit ?? "").replace(".", ","));
  const [closing, setClosing] = useState(String(initial?.closing_day ?? 25));
  const [due, setDue] = useState(String(initial?.due_day ?? 10));
  const [goalStr, setGoalStr] = useState(initial?.statement_goal != null ? String(initial.statement_goal).replace(".", ",") : "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const limit = Number(limitStr.replace(",", ".") || "0");
    const goal = goalStr.trim() === "" ? null : Number(goalStr.replace(",", "."));
    const parsed = creditCardSchema.safeParse({
      name,
      brand,
      last_four: lastFour,
      total_limit: limit,
      closing_day: Number(closing),
      due_day: Number(due),
      statement_goal: goal,
      active,
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
        <h2 className="font-display text-lg font-bold">{initial ? "Editar cartão" : "Novo cartão"}</h2>
        <div className="mt-4 space-y-3">
          <Field label="Nome (ex: Nubank Roxinho)">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bandeira (opcional)">
              <input value={brand} onChange={(e) => setBrand(e.target.value)} className="input-base" placeholder="Visa" />
            </Field>
            <Field label="Últimos 4 (opcional)">
              <input value={lastFour} onChange={(e) => setLastFour(e.target.value)} className="input-base" maxLength={4} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Limite total (R$)">
            <input inputMode="decimal" value={limitStr} onChange={(e) => setLimitStr(e.target.value)} className="input-base" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha dia">
              <input type="number" min={1} max={31} value={closing} onChange={(e) => setClosing(e.target.value)} className="input-base" />
            </Field>
            <Field label="Vence dia">
              <input type="number" min={1} max={31} value={due} onChange={(e) => setDue(e.target.value)} className="input-base" />
            </Field>
          </div>
          <Field label="Meta de fatura (opcional)">
            <input inputMode="decimal" value={goalStr} onChange={(e) => setGoalStr(e.target.value)} className="input-base" placeholder="Ex: 800,00" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Cartão ativo
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
