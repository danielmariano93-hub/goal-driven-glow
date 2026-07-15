import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet, Loader2 } from "lucide-react";
import { useAccounts, useSaveAccount, useDeleteAccount, type AccountRow } from "@/lib/db/finance";
import { accountSchema } from "@/lib/validation/finance";
import { formatBRL } from "@/lib/engine/facts";
import { toast } from "sonner";

const TYPE_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  investment: "Investimento",
  other: "Outra",
};

export default function Contas() {
  const { data: accounts, isLoading } = useAccounts();
  const save = useSaveAccount();
  const del = useDeleteAccount();
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [open, setOpen] = useState(false);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(a: AccountRow) {
    setEditing(a);
    setOpen(true);
  }

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Contas</h1>
          <p className="text-sm text-muted-foreground">Suas carteiras, contas e cofres.</p>
        </div>
        <button onClick={openNew} className="btn-brand inline-flex items-center gap-2">
          <Plus size={14} /> Nova conta
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Ainda não há contas cadastradas</p>
          <p className="mt-1 text-xs text-muted-foreground">Adicione ao menos uma conta para começar a registrar lançamentos.</p>
          <button onClick={openNew} className="btn-brand mt-4 inline-flex items-center gap-2">
            <Plus size={14} /> Criar conta
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {TYPE_LABEL[a.type] ?? a.type}
                  {a.institution ? ` · ${a.institution}` : ""} · Saldo inicial {formatBRL(Number(a.opening_balance))}
                  {!a.active && " · arquivada"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(a)} className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => {
                    if (confirm("Excluir esta conta? Só é possível se não houver lançamentos vinculados.")) {
                      del.mutate(a.id, {
                        onError: (e: unknown) =>
                          toast.error("Não foi possível excluir (verifique lançamentos vinculados).", { description: String((e as Error).message) }),
                        onSuccess: () => toast.success("Conta excluída"),
                      });
                    }
                  }}
                  className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <AccountFormModal
          initial={editing}
          onClose={() => setOpen(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  toast.success(editing ? "Conta atualizada" : "Conta criada");
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

function AccountFormModal({
  initial,
  onClose,
  onSubmit,
  saving,
}: {
  initial: AccountRow | null;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof accountSchema.parse>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<string>(initial?.type ?? "checking");
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [opening, setOpening] = useState(String(initial?.opening_balance ?? "0"));
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = accountSchema.safeParse({
      name,
      type,
      institution,
      opening_balance: Number(opening.replace(",", ".")) || 0,
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
        <h2 className="font-display text-lg font-bold">{initial ? "Editar conta" : "Nova conta"}</h2>
        <div className="mt-4 space-y-3">
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </Field>
          <Field label="Tipo">
            <select value={type} onChange={(e) => setType(e.target.value)} className="input-base">
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Instituição (opcional)">
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} className="input-base" />
          </Field>
          <Field label="Saldo inicial (R$)">
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="input-base" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Conta ativa
          </label>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
