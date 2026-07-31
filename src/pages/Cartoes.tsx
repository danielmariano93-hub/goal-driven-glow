import { useMemo, useState } from "react";
import { Plus, CreditCard, Pencil, Trash2, Loader2, CheckCircle2, Clock3, AlertTriangle, ReceiptText, ChevronRight, X, RotateCcw } from "lucide-react";
import { useCreditCards, useSaveCreditCard, useDeleteCreditCard, type CreditCardRow } from "@/lib/db/creditCards";
import { useAccounts, useAllTransactions, useCategories } from "@/lib/db/finance";
import { creditCardSchema } from "@/lib/validation/creditCards";
import { formatBRL, currentMonthYM } from "@/lib/engine/facts";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type StatementRow = {
  id: string; credit_card_id: string; competence_month: string; due_date: string;
  stated_total: number; paid_amount: number; outstanding_amount: number;
  reconciliation_difference: number; status: string; source_document_id?: string | null;
};

type StatementItemRow = {
  id: string; statement_id: string; legacy_transaction_id: string | null;
  item_kind: string; description: string; amount: number; occurred_at: string | null;
  transaction?: { category_id: string | null } | null;
};

type StatementPaymentRow = {
  id: string; paid_at: string; amount: number; account_id: string | null; transaction_id: string | null;
  account?: { name: string } | null;
};

export default function Cartoes() {
  const { data: cards, isLoading } = useCreditCards();
  const { data: txs } = useAllTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CreditCardRow | null>(null);
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState<StatementRow | null>(null);
  const [viewing, setViewing] = useState<StatementRow | null>(null);
  const save = useSaveCreditCard();
  const del = useDeleteCreditCard();
  const ym = currentMonthYM();
  const { data: statements = [] } = useQuery({
    queryKey: ["credit_card_statements"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("credit_card_statements")
        .select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status,source_document_id")
        .order("competence_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: installments = [] } = useQuery({
    queryKey: ["credit_card_installments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("credit_card_installments")
        .select("credit_card_id,amount,competence_month,status");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const byCard: Record<string, { current: number; next: number; total: number; paid: number; needsReview: boolean }> = {};
    for (const statement of statements as any[]) {
      const cid = statement.credit_card_id;
      byCard[cid] ||= { current: 0, next: 0, total: 0, paid: 0, needsReview: false };
      const month = String(statement.competence_month).slice(0, 7);
      if (month === ym) {
        byCard[cid].current = Number(statement.outstanding_amount ?? statement.stated_total ?? 0);
        byCard[cid].paid = Number(statement.paid_amount ?? 0);
        byCard[cid].needsReview = statement.status === "needs_review" || Number(statement.reconciliation_difference ?? 0) !== 0;
      }
    }
    for (const installment of installments as any[]) {
      const cid = installment.credit_card_id;
      byCard[cid] ||= { current: 0, next: 0, total: 0, paid: 0, needsReview: false };
      if (!["paid", "refunded", "cancelled"].includes(installment.status)) {
        byCard[cid].total += Number(installment.amount ?? 0);
      }
    }
    for (const t of txs ?? []) {
      const anyT = t as unknown as { credit_card_id?: string | null; competence_date?: string | null; amount: number };
      const cid = anyT.credit_card_id;
      const comp = anyT.competence_date;
      if (!cid || !comp) continue;
      byCard[cid] ||= { current: 0, next: 0, total: 0, paid: 0, needsReview: false };
      const compYM = comp.slice(0, 7);
      const amt = Number(anyT.amount) || 0;
      if (installments.length === 0) byCard[cid].total += amt;
      if (statements.length === 0 && compYM === ym) byCard[cid].current += amt;
      // próxima fatura
      const [y, m] = ym.split("-").map(Number);
      const next0 = m; // m0+1 = m
      const nextYM = `${next0 === 12 ? y + 1 : y}-${String((next0 % 12) + 1).padStart(2, "0")}`;
      if (compYM === nextYM) byCard[cid].next += amt;
    }
    return byCard;
  }, [installments, statements, txs, ym]);

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
            const st = stats[c.id] ?? { current: 0, next: 0, total: 0, paid: 0, needsReview: false };
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
                  <Stat label="Em aberto na fatura" value={formatBRL(st.current)} />
                  <Stat label="Próxima" value={formatBRL(st.next)} />
                  <Stat label="Parcelas futuras" value={formatBRL(st.total)} />
                </div>
                {st.paid > 0 && <p className="mt-2 text-[11px] text-success">Já pago nesta fatura: {formatBRL(st.paid)}</p>}
                {st.needsReview && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Fatura reconstruída a partir dos lançamentos. Revise antes de considerar o saldo como conciliado.</p>}
                {c.total_limit > 0 && (
                  <div className="mt-3">
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${usedPct > 0.85 ? "bg-destructive" : usedPct > 0.7 ? "bg-warning" : "bg-primary"}`}
                        style={{ width: `${Math.round(usedPct * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {Math.round(usedPct * 100)}% do limite de {formatBRL(Number(c.total_limit))} · disponível {formatBRL(available)}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {statements.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Histórico de faturas</h2>
              <p className="text-xs text-muted-foreground">Acompanhe o que está aberto, pago ou atrasado sem contar o pagamento como nova despesa.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{statements.length} fatura(s)</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(statements as StatementRow[]).map((statement) => {
              const card = cards?.find((item) => item.id === statement.credit_card_id);
              const overdue = statement.outstanding_amount > 0 && new Date(`${statement.due_date}T12:00:00`) < new Date();
              const status = statement.status === "paid" ? "paid" : overdue ? "overdue" : statement.status;
              const progress = statement.stated_total > 0 ? Math.min(100, Math.round((statement.paid_amount / statement.stated_total) * 100)) : 0;
              const statusMeta = statementStatus(status);
              return (
                <article key={statement.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2 text-primary"><ReceiptText size={18} /></div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{card?.name ?? "Cartão"} · {formatCompetence(statement.competence_month)}</p>
                        <p className="text-[11px] text-muted-foreground">Vence em {formatDate(statement.due_date)}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.className}`}>
                      {statusMeta.icon}{statusMeta.label}
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total da fatura</p>
                      <p className="text-xl font-bold tabular-nums">{formatBRL(Number(statement.stated_total))}</p>
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      {statement.outstanding_amount > 0 ? <>Falta <strong className="text-foreground">{formatBRL(Number(statement.outstanding_amount))}</strong></> : "Tudo pago ✓"}
                    </p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>{progress}% quitado</span><span>{formatBRL(Number(statement.paid_amount))} pagos</span>
                  </div>
                  {Math.abs(Number(statement.reconciliation_difference)) > 0.05 && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Conciliação pendente: diferença de {formatBRL(Math.abs(Number(statement.reconciliation_difference)))}</p>
                  )}
                  {statement.outstanding_amount > 0 && Math.abs(Number(statement.reconciliation_difference)) <= 0.05 && (
                    <button onClick={() => setPaying(statement)} className="btn-brand mt-4 w-full py-2 text-xs">Registrar pagamento</button>
                  )}
                  <button onClick={() => setViewing(statement)} className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-full border border-border px-4 py-2 text-xs font-semibold">
                    Ver e editar fatura <ChevronRight size={13} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
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
      {paying && (
        <StatementPaymentModal
          statement={paying}
          accounts={accounts as Array<{ id: string; name: string }>}
          onClose={() => setPaying(null)}
          onPaid={async () => {
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["credit_card_statements"] }),
              qc.invalidateQueries({ queryKey: ["credit_card_installments"] }),
              qc.invalidateQueries({ queryKey: ["transactions"] }),
              qc.invalidateQueries({ queryKey: ["accounts"] }),
              qc.invalidateQueries({ queryKey: ["home"] }),
            ]);
            setPaying(null);
          }}
        />
      )}
      {viewing && (
        <StatementDetailSheet
          statement={viewing}
          accounts={accounts as Array<{ id: string; name: string }>}
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          onClose={() => setViewing(null)}
          onPay={() => { setPaying(viewing); setViewing(null); }}
          onChanged={async () => {
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["credit_card_statements"] }),
              qc.invalidateQueries({ queryKey: ["statement-detail", viewing.id] }),
              qc.invalidateQueries({ queryKey: ["transactions"] }),
              qc.invalidateQueries({ queryKey: ["accounts"] }),
              qc.invalidateQueries({ queryKey: ["home"] }),
            ]);
          }}
        />
      )}
    </div>
  );
}

function StatementDetailSheet({ statement, categories, onClose, onPay, onChanged }: {
  statement: StatementRow;
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  onClose: () => void;
  onPay: () => void;
  onChanged: () => Promise<void>;
}) {
  const detail = useQuery({
    queryKey: ["statement-detail", statement.id],
    queryFn: async () => {
      const [itemsResult, allocationsResult] = await Promise.all([
        (supabase as any).from("credit_card_statement_items")
          .select("id,statement_id,legacy_transaction_id,item_kind,description,amount,occurred_at,transaction:transactions(category_id)")
          .eq("statement_id", statement.id).order("occurred_at", { ascending: true }),
        (supabase as any).from("credit_card_payment_allocations")
          .select("payment:credit_card_payments(id,paid_at,amount,account_id,transaction_id,account:accounts(name))")
          .eq("statement_id", statement.id).order("created_at", { ascending: false }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (allocationsResult.error) throw allocationsResult.error;
      return {
        items: (itemsResult.data ?? []) as StatementItemRow[],
        payments: (allocationsResult.data ?? []).map((row: any) => row.payment).filter(Boolean) as StatementPaymentRow[],
      };
    },
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const economicLocked = Number(statement.paid_amount) > 0;
  async function saveItem(item: StatementItemRow, patch: { description?: string; category_id?: string | null }) {
    setSavingId(item.id);
    const { data, error } = await (supabase as any).rpc("update_credit_card_statement_item", {
      p_item_id: item.id,
      p_description: patch.description ?? item.description,
      p_category_id: patch.category_id === undefined ? item.transaction?.category_id ?? null : patch.category_id,
    });
    setSavingId(null);
    if (error || !data?.ok) return toast.error("Não foi possível salvar o lançamento", { description: error?.message ?? data?.error });
    await onChanged();
    toast.success("Lançamento atualizado");
  }
  async function reversePayment(payment: StatementPaymentRow) {
    if (!confirm(`Desfazer o pagamento de ${formatBRL(Number(payment.amount))}? O saldo da conta e a fatura serão restaurados.`)) return;
    setSavingId(payment.id);
    const { data, error } = await (supabase as any).rpc("reverse_credit_card_statement_payment", { p_payment_id: payment.id });
    setSavingId(null);
    if (error || !data?.ok) return toast.error("Não foi possível desfazer o pagamento", { description: error?.message ?? data?.error });
    await onChanged();
    toast.success("Pagamento desfeito com trilha de auditoria");
  }
  return <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose}>
    <section onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[28px] border border-border bg-background shadow-2xl md:inset-y-0 md:left-auto md:w-[560px] md:max-h-none md:rounded-none">
      <header className="flex items-start justify-between border-b border-border p-5">
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Fatura</p><h2 className="font-display text-xl font-bold">{formatCompetence(statement.competence_month)}</h2><p className="text-xs text-muted-foreground">Vence em {formatDate(statement.due_date)} · {formatBRL(Number(statement.stated_total))}</p></div>
        <button onClick={onClose} className="rounded-full border border-border p-2" aria-label="Fechar"><X size={16}/></button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-5">
        {economicLocked && <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Fatura com pagamento registrado.</strong> Categorias e descrições continuam corrigíveis. Para alterar valores, primeiro desfaça o pagamento abaixo.</div>}
        <div className="mb-4 grid grid-cols-3 gap-2"><Stat label="Total" value={formatBRL(Number(statement.stated_total))}/><Stat label="Pago" value={formatBRL(Number(statement.paid_amount))}/><Stat label="Em aberto" value={formatBRL(Number(statement.outstanding_amount))}/></div>
        <h3 className="text-sm font-semibold">Lançamentos</h3>
        <p className="mb-3 text-xs text-muted-foreground">Corrija a descrição ou categoria sem duplicar a despesa.</p>
        {detail.isLoading ? <Loader2 className="mx-auto my-8 animate-spin"/> : <div className="space-y-2">{detail.data?.items.map((item) => <StatementItemEditor key={item.id} item={item} categories={categories} saving={savingId === item.id} onSave={saveItem}/>)}</div>}
        <div className="mt-6"><h3 className="text-sm font-semibold">Pagamentos da fatura</h3><p className="text-xs text-muted-foreground">Cada baixa reduz a conta e a obrigação, sem criar uma nova despesa de consumo.</p>
          <div className="mt-3 space-y-2">{detail.data?.payments.length ? detail.data.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between rounded-2xl border border-border p-3"><div><p className="text-sm font-semibold">{formatBRL(Number(payment.amount))}</p><p className="text-[11px] text-muted-foreground">{formatDate(payment.paid_at)} · {payment.account?.name ?? "Conta"}</p></div><button disabled={savingId === payment.id} onClick={() => reversePayment(payment)} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><RotateCcw size={12}/>Desfazer</button></div>) : <p className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">Nenhum pagamento registrado.</p>}</div>
        </div>
      </div>
      {Number(statement.outstanding_amount) > 0 && Math.abs(Number(statement.reconciliation_difference)) <= .05 && <footer className="border-t border-border p-4"><button onClick={onPay} className="btn-brand w-full">Registrar pagamento desta fatura</button></footer>}
    </section>
  </div>;
}

function StatementItemEditor({ item, categories, saving, onSave }: { item: StatementItemRow; categories: Array<{id:string;name:string}>; saving: boolean; onSave: (item: StatementItemRow, patch: {description?:string;category_id?:string|null}) => Promise<void> }) {
  const [description, setDescription] = useState(item.description);
  const [categoryId, setCategoryId] = useState(item.transaction?.category_id ?? "");
  const dirty = description !== item.description || categoryId !== (item.transaction?.category_id ?? "");
  return <article className="rounded-2xl border border-border bg-card p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><input value={description} onChange={(e)=>setDescription(e.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none"/><p className="mt-1 text-[11px] text-muted-foreground">{item.occurred_at ? formatDate(item.occurred_at) : "Sem data"} · {item.item_kind === "installment" ? "Parcela" : item.item_kind === "refund" ? "Estorno" : "Compra"}</p></div><strong className={Number(item.amount)<0?"text-success":""}>{formatBRL(Math.abs(Number(item.amount)))}</strong></div><div className="mt-3 flex gap-2"><select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)} className="input-base min-w-0 flex-1"><option value="">Sem categoria</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select><button disabled={!dirty||saving||!item.legacy_transaction_id} onClick={()=>onSave(item,{description,category_id:categoryId||null})} className="rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saving?"Salvando…":"Salvar"}</button></div>{!item.legacy_transaction_id&&<p className="mt-2 text-[10px] text-amber-700">Item ainda não confirmado. Edite-o pela revisão da importação.</p>}</article>;
}

function statementStatus(status: string) {
  if (status === "paid") return { label: "Paga", icon: <CheckCircle2 size={12} />, className: "bg-emerald-50 text-emerald-700" };
  if (status === "overdue") return { label: "Atrasada", icon: <AlertTriangle size={12} />, className: "bg-red-50 text-red-700" };
  if (status === "partially_paid") return { label: "Parcial", icon: <Clock3 size={12} />, className: "bg-amber-50 text-amber-700" };
  if (status === "needs_review") return { label: "Revisar", icon: <AlertTriangle size={12} />, className: "bg-amber-50 text-amber-700" };
  return { label: "Em aberto", icon: <Clock3 size={12} />, className: "bg-blue-50 text-blue-700" };
}

const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const formatCompetence = (date: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T12:00:00`));

function StatementPaymentModal({ statement, accounts, onClose, onPaid }: {
  statement: StatementRow;
  accounts: Array<{ id: string; name: string }>;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [amount, setAmount] = useState(Number(statement.outstanding_amount).toFixed(2).replace(".", ","));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const numeric = Number(amount.replace(/\./g, "").replace(",", "."));
    if (!accountId || !Number.isFinite(numeric) || numeric <= 0) return toast.error("Escolha a conta e informe um valor válido.");
    setSaving(true);
    const key = `statement:${statement.id}:${paidAt}:${Math.round(numeric * 100)}`;
    const { data, error } = await (supabase as any).rpc("settle_credit_card_statement", {
      p_statement_id: statement.id, p_account_id: accountId, p_amount: numeric,
      p_paid_at: paidAt, p_idempotency_key: key,
    });
    setSaving(false);
    if (error || !data?.ok) return toast.error("Não foi possível registrar o pagamento", { description: error?.message ?? data?.error });
    toast.success(data.status === "paid" ? "Fatura paga 🎉" : "Pagamento parcial registrado", {
      description: "A conta e a obrigação do cartão foram atualizadas. Nenhuma nova despesa foi criada.",
    });
    await onPaid();
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Registrar pagamento</h2>
        <p className="mt-1 text-xs text-muted-foreground">A baixa reduz o saldo da conta e a dívida do cartão. As compras já foram contabilizadas antes.</p>
        <div className="mt-5 space-y-3">
          <Field label="Conta usada no pagamento"><select className="input-base" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Escolha a conta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Valor pago (R$)"><input className="input-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Data do pagamento"><input className="input-base" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">Cancelar</button><button disabled={saving} className="btn-brand inline-flex items-center gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Confirmar baixa</button></div>
      </form>
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
