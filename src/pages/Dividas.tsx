import { useState } from "react";
import { Plus, Trash2, Loader2, Pencil, AlertOctagon } from "lucide-react";
import { toast } from "sonner";
import { useDebts, useSaveDebt, useDeleteDebt, type DebtRow } from "@/lib/db/finance";
import { debtSchema } from "@/lib/validation/finance";
import { formatBRL } from "@/lib/engine/facts";

export default function Dividas() {
  const { data: items, isLoading } = useDebts();
  const save = useSaveDebt();
  const del = useDeleteDebt();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DebtRow | null>(null);

  const totalOutstanding = (items ?? []).filter((d) => d.status === "active").reduce((a, b) => a + Number(b.outstanding_balance), 0);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Dívidas</h1>
          <p className="text-sm text-muted-foreground">Saldo, parcelas e status.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Nova
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <AlertOctagon className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Sem dívidas cadastradas</p>
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Saldo devedor total (ativas)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-destructive">{formatBRL(totalOutstanding)}</p>
          </div>
          <ul className="space-y-2">
            {items.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {d.name}
                    {d.status !== "active" && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide">{d.status === "settled" ? "Quitada" : "Inadimplente"}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.creditor ? `${d.creditor} · ` : ""}Original {formatBRL(Number(d.original_amount))}
                    {d.installment_amount ? ` · parcela ${formatBRL(Number(d.installment_amount))}` : ""}
                    {d.interest_rate_pct != null ? ` · juros informado ${d.interest_rate_pct}%` : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    Saldo pendente <span className="font-semibold">{formatBRL(Number(d.outstanding_balance))}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(d);
                      setOpen(true);
                    }}
                    className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Excluir esta dívida?")) del.mutate(d.id, { onSuccess: () => toast.success("Excluída") });
                    }}
                    className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <DebtModal
          initial={editing}
          saving={save.isPending}
          onClose={() => setOpen(false)}
          onSubmit={(v, status) =>
            save.mutate(
              { ...v, id: editing?.id, status },
              {
                onSuccess: () => {
                  toast.success("Salva");
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

function DebtModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: DebtRow | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof debtSchema.parse>, status: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [creditor, setCreditor] = useState(initial?.creditor ?? "");
  const [original, setOriginal] = useState(initial ? String(initial.original_amount) : "");
  const [outstanding, setOutstanding] = useState(initial ? String(initial.outstanding_balance) : "");
  const [installment, setInstallment] = useState(initial?.installment_amount != null ? String(initial.installment_amount) : "");
  const [dueDay, setDueDay] = useState(initial?.due_day != null ? String(initial.due_day) : "");
  const [rate, setRate] = useState(initial?.interest_rate_pct != null ? String(initial.interest_rate_pct) : "");
  const [status, setStatus] = useState<string>(initial?.status ?? "active");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = debtSchema.safeParse({
      name,
      creditor,
      original_amount: Number(original.replace(",", ".")),
      outstanding_balance: Number(outstanding.replace(",", ".")),
      installment_amount: installment ? Number(installment.replace(",", ".")) : null,
      due_day: dueDay ? Number(dueDay) : null,
      interest_rate_pct: rate ? Number(rate.replace(",", ".")) : null,
      notes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    if (parsed.data.outstanding_balance > parsed.data.original_amount) {
      setError("Saldo pendente não pode ser maior que valor original");
      return;
    }
    onSubmit(parsed.data, status);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">{initial ? "Editar" : "Nova"} dívida</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Credor</label>
            <input value={creditor ?? ""} onChange={(e) => setCreditor(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor original</label>
              <input inputMode="decimal" value={original} onChange={(e) => setOriginal(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Saldo pendente</label>
              <input inputMode="decimal" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Parcela (opcional)</label>
              <input inputMode="decimal" value={installment} onChange={(e) => setInstallment(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Dia venc.</label>
              <input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="input-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Juros informado (% a.m.)</label>
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base">
                <option value="active">Ativa</option>
                <option value="settled">Quitada</option>
                <option value="defaulted">Inadimplente</option>
              </select>
            </div>
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
