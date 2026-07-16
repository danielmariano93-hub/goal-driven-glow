import { useMemo, useState } from "react";
import { Plus, Loader2, ArrowLeftRight, MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  useAccounts,
  useCategories,
  useTransactions,
  useSaveTransaction,
  useDeleteTransaction,
  useCreateTransfer,
  type TransactionRow,
  type TxFilters,
} from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { transactionSchema, transferSchema } from "@/lib/validation/finance";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Lancamentos() {
  const nav = useNavigate();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const [filters, setFilters] = useState<TxFilters>({ type: "all" });
  const { data: txs, isLoading } = useTransactions(filters);
  const save = useSaveTransaction();
  const transfer = useCreateTransfer();
  const del = useDeleteTransaction();
  const [openTx, setOpenTx] = useState(false);
  const [openTransfer, setOpenTransfer] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);

  const { data: cards } = useCreditCards();
  const catName = (id: string | null) =>
    id ? categories?.find((c) => c.id === id)?.name ?? "—" : "—";
  const accName = (t: TransactionRow) => {
    if (t.payment_method === "credit_card" && t.credit_card_id) {
      return cards?.find((c) => c.id === t.credit_card_id)?.name ?? "Cartão";
    }
    if (t.account_id) return accounts?.find((a) => a.id === t.account_id)?.name ?? "—";
    return "—";
  };

  const grouped = useMemo(() => {
    const g: Record<string, TransactionRow[]> = {};
    for (const t of txs ?? []) (g[t.occurred_at] ||= []).push(t);
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }, [txs]);

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Receitas, despesas e transferências.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setOpenTransfer(true)}
            disabled={!hasAccounts || (accounts?.length ?? 0) < 2}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <ArrowLeftRight size={14} /> Transferência
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setOpenTx(true);
            }}
            disabled={!hasAccounts}
            className="btn-brand inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={14} /> Novo
          </button>
        </div>
      </header>

      {!hasAccounts ? (
        <EmptyMessage title="Cadastre uma conta antes" description="Você precisa de pelo menos uma conta para registrar lançamentos." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <select
              value={filters.type ?? "all"}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TxFilters["type"] }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            >
              <option value="all">Todos os tipos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas</option>
              <option value="transfer">Transferências</option>
            </select>
            <select
              value={filters.accountId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value || undefined }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            >
              <option value="">Todas as contas</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={filters.categoryId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value || undefined }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            >
              <option value="">Todas as categorias</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            />
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"
            />
          </div>

          {isLoading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !txs || txs.length === 0 ? (
            <EmptyMessage title="Nenhum lançamento encontrado" description="Ajuste os filtros ou registre um novo." />
          ) : (
            <div className="space-y-4">
              {grouped.map(([date, items]) => (
                <div key={date}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                  <ul className="space-y-2">
                    {items.map((t) => {
                      const isTransfer = t.type === "transfer";
                      const isCard = t.payment_method === "credit_card";
                      const isInstallment = (t.installments_total ?? 1) > 1;
                      const canDuplicate = !isTransfer && !isInstallment;
                      const openDetail = () => nav(`/app/lancamentos/${t.id}`);
                      const openEdit = () => nav(`/app/lancamentos/${t.id}?edit=1`);
                      const doDuplicate = async () => {
                        if (!canDuplicate) return;
                        try {
                          const base: Record<string, unknown> = {
                            user_id: t.user_id,
                            type: t.type,
                            status: "confirmed",
                            amount: Number(t.amount),
                            occurred_at: todayISO(),
                            description: t.description ?? null,
                            category_id: t.category_id ?? null,
                            payment_method: t.payment_method ?? "account",
                            origin: "manual",
                          };
                          if (isCard) {
                            if (!t.credit_card_id) {
                              toast.error("Não é possível duplicar: cartão ausente.");
                              return;
                            }
                            base.credit_card_id = t.credit_card_id;
                            base.account_id = null;
                            base.purchase_date = todayISO();
                            base.competence_date = t.competence_date ?? todayISO();
                          } else {
                            if (!t.account_id) {
                              toast.error("Não é possível duplicar: conta ausente.");
                              return;
                            }
                            base.account_id = t.account_id;
                            base.credit_card_id = null;
                          }
                          const { error } = await supabase.from("transactions").insert(base as never);
                          if (error) throw error;
                          toast.success("Lançamento duplicado");
                          qc.invalidateQueries({ queryKey: ["transactions"] });
                        } catch (e) {
                          toast.error("Erro ao duplicar", { description: String((e as Error).message) });
                        }
                      };
                      const doDelete = () => {
                        if (!confirm(isTransfer ? "Excluir esta transferência (ambas as pernas)?" : "Excluir este lançamento?")) return;
                        del.mutate(t, {
                          onSuccess: () => toast.success("Excluído"),
                          onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
                        });
                      };
                      return (
                        <li key={t.id} className="group flex items-center justify-between rounded-2xl border border-border bg-card p-3 shadow-card transition-colors hover:bg-secondary/50 focus-within:ring-2 focus-within:ring-primary/40">
                          <button
                            type="button"
                            onClick={openDetail}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left min-h-[48px]"
                            aria-label={`Abrir lançamento: ${t.description || (isTransfer ? "Transferência" : catName(t.category_id))}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{t.description || (isTransfer ? "Transferência" : catName(t.category_id))}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                                {accName(t)} · {t.type === "income" ? "Receita" : t.type === "expense" ? "Despesa" : "Transferência"}
                                {t.status === "planned" ? " · Planejado" : ""}
                              </p>
                            </div>
                            <span
                              className={`font-semibold tabular-nums ${
                                t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : "text-foreground"
                              }`}
                            >
                              {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}
                              {formatBRL(Number(t.amount))}
                            </span>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="ml-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                                aria-label="Ações do lançamento"
                              >
                                <MoreHorizontal size={18} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={openEdit} disabled={isTransfer} className="gap-2">
                                <Pencil size={14} /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={doDuplicate} disabled={isTransfer} className="gap-2">
                                <Copy size={14} /> Duplicar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={doDelete} className="gap-2 text-destructive focus:text-destructive">
                                <Trash2 size={14} /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {openTx && (
        <TxModal
          initial={editing}
          accounts={accounts ?? []}
          categories={categories ?? []}
          saving={save.isPending}
          onClose={() => setOpenTx(false)}
          onSubmit={(v) =>
            save.mutate(
              { ...v, id: editing?.id },
              {
                onSuccess: () => {
                  toast.success(editing ? "Atualizado" : "Registrado");
                  setOpenTx(false);
                },
                onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
              }
            )
          }
        />
      )}

      {openTransfer && (
        <TransferModal
          accounts={accounts ?? []}
          saving={transfer.isPending}
          onClose={() => setOpenTransfer(false)}
          onSubmit={(v) =>
            transfer.mutate(v, {
              onSuccess: () => {
                toast.success("Transferência registrada");
                setOpenTransfer(false);
              },
              onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}
    </div>
  );
}

function EmptyMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function TxModal({
  initial,
  accounts,
  categories,
  saving,
  onClose,
  onSubmit,
}: {
  initial: TransactionRow | null;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; type: "income" | "expense" }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof transactionSchema.parse>) => void;
}) {
  const [type, setType] = useState<"income" | "expense">((initial?.type as "income" | "expense") ?? "expense");
  const [accountId, setAccountId] = useState(initial?.account_id ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | "">(initial?.category_id ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [occurredAt, setOccurredAt] = useState(initial?.occurred_at ?? todayISO());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<"confirmed" | "planned">(initial?.status ?? "confirmed");
  const [error, setError] = useState<string | null>(null);

  const filteredCats = categories.filter((c) => c.type === type);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = transactionSchema.safeParse({
      account_id: accountId,
      category_id: categoryId || null,
      type,
      status,
      amount: Number(amount.replace(",", ".")),
      occurred_at: occurredAt,
      description,
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
        <h2 className="font-display text-lg font-bold">{initial ? "Editar lançamento" : "Novo lançamento"}</h2>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${type === "expense" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-background text-muted-foreground"}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${type === "income" ? "border-success bg-success/10 text-success" : "border-border bg-background text-muted-foreground"}`}
            >
              Receita
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Valor (R$)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" placeholder="0,00" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Conta</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base">
              <option value="">Sem categoria</option>
              {filteredCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "confirmed" | "planned")} className="input-base">
                <option value="confirmed">Confirmado</option>
                <option value="planned">Planejado</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Descrição (opcional)</label>
            <input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} className="input-base" />
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

function TransferModal({
  accounts,
  saving,
  onClose,
  onSubmit,
}: {
  accounts: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof transferSchema.parse>) => void;
}) {
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = transferSchema.safeParse({
      from_account_id: from,
      to_account_id: to,
      amount: Number(amount.replace(",", ".")),
      occurred_at: date,
      description,
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
        <h2 className="font-display text-lg font-bold">Transferência entre contas</h2>
        <p className="mt-1 text-xs text-muted-foreground">Não conta como receita nem despesa.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">De</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="input-base">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Para</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="input-base">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
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
            <label className="mb-1 block text-xs font-medium">Descrição (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transferir"}
          </button>
        </div>
      </form>
    </div>
  );
}
