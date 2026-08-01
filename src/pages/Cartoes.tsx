import { useMemo, useState } from "react";
import { Plus, CreditCard, Pencil, Trash2, Loader2, CheckCircle2, Clock3, AlertTriangle, ReceiptText, ChevronRight, X, RotateCcw } from "lucide-react";
import { useCreditCards, useSaveCreditCard, useDeleteCreditCard, type CreditCardRow } from "@/lib/db/creditCards";
import { useAccounts, useAllTransactions, useCategories } from "@/lib/db/finance";
import { creditCardSchema } from "@/lib/validation/creditCards";
import { formatBRL, currentMonthYM } from "@/lib/engine/facts";
import { computeCardExposure, type CardExposure } from "@/lib/engine/cardExposure";
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

  // Fonte canônica única: faturas oficiais têm precedência; sem fatura, estimamos
  // pela data econômica e a UI rotula explicitamente como estimativa.
  const exposures = useMemo(() => computeCardExposure({
    cardIds: (cards ?? []).map((c) => c.id),
    statements: statements as never,
    installments: installments as never,
    txs: (txs ?? []) as never,
    currentYM: ym,
  }), [cards, installments, statements, txs, ym]);

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
            const st: CardExposure = exposures[c.id] ?? {
              cardId: c.id,
              currentStatement: { amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 },
              nextStatement: { amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 },
              futureInstallments: 0,
              totalCardDebt: 0,
              needsReview: false,
              formulaVersion: "card_exposure.v1",
            };
            const commitment = st.totalCardDebt + st.futureInstallments;
            const usedPct = c.total_limit > 0 ? Math.min(1, commitment / Number(c.total_limit)) : 0;
            const available = Math.max(0, Number(c.total_limit) - commitment);
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
                  <Stat
                    label="Em aberto na fatura"
                    value={formatBRL(st.currentStatement.amount)}
                    tag={sourceTag(st.currentStatement.source)}
                  />
                  <Stat
                    label="Próxima fatura"
                    value={formatBRL(st.nextStatement.amount)}
                    tag={sourceTag(st.nextStatement.source)}
                  />
                  <Stat label="Parcelas futuras" value={formatBRL(st.futureInstallments)} tag="Compromisso" />
                </div>
                {st.currentStatement.paidAmount > 0 && (
                  <p className="mt-2 text-[11px] text-success">Já pago nesta fatura: {formatBRL(st.currentStatement.paidAmount)}</p>
                )}
                {st.currentStatement.source === "estimated" && (
                  <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                    Estimativa reconstruída pelos lançamentos: ainda não há fatura oficial importada para {ym.split("-").reverse().join("/")}.
                  </p>
                )}
                {st.needsReview && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Esta fatura tem divergência de conciliação. Revise antes de considerar o saldo como conciliado.</p>}
                {c.total_limit > 0 && (
                  <div className="mt-3">
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full ${usedPct > 0.85 ? "bg-destructive" : usedPct > 0.7 ? "bg-warning" : "bg-primary"}`}
                        style={{ width: `${Math.round(usedPct * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {Math.round(usedPct * 100)}% do limite de {formatBRL(Number(c.total_limit))} · disponível {formatBRL(available)} · considera fatura em aberto + parcelas futuras
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

const ITEM_KINDS: Array<{ value: string; label: string }> = [
  { value: "purchase", label: "Compra" },
  { value: "installment", label: "Parcela" },
  { value: "payment", label: "Pagamento da fatura" },
  { value: "refund", label: "Estorno/crédito" },
  { value: "interest", label: "Juros" },
  { value: "fee", label: "Tarifa" },
  { value: "adjustment", label: "Ajuste" },
];

const CREDIT_KINDS = ["payment", "refund"];

const STATEMENT_ERRORS: Record<string, string> = {
  statement_economic_fields_locked: "Esta fatura já tem pagamento registrado. Desfaça o pagamento antes de alterar valores.",
  statement_has_payments: "Desfaça os pagamentos antes de excluir esta fatura.",
  only_unapproved_statement_can_be_discarded: "Faturas já pagas ou refinanciadas não podem ser excluídas.",
  reconciliation_open: "Ainda existe diferença entre o total oficial e os lançamentos.",
  statement_without_items: "A fatura não tem lançamentos para aprovar.",
  amount_must_not_be_zero: "Informe um valor diferente de zero.",
  description_required: "Informe uma descrição.",
  invalid_item_kind: "Tipo de lançamento inválido.",
  justification_required: "Escreva uma justificativa para o ajuste.",
  not_authenticated: "Sessão expirada. Entre novamente.",
};

function statementError(error: { message?: string } | null, data: { error?: string } | null | undefined) {
  const key = data?.error ?? "";
  if (key && STATEMENT_ERRORS[key]) return STATEMENT_ERRORS[key];
  const raw = error?.message ?? key;
  for (const [code, label] of Object.entries(STATEMENT_ERRORS)) if (raw.includes(code)) return label;
  return raw || "Erro inesperado. Tente novamente.";
}

const parseAmount = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

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
      const [statementResult, itemsResult, allocationsResult] = await Promise.all([
        (supabase as any).from("credit_card_statements")
          .select("id,credit_card_id,competence_month,due_date,stated_total,reconciled_total,opening_balance,paid_amount,outstanding_amount,reconciliation_difference,status,source_document_id")
          .eq("id", statement.id).maybeSingle(),
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
        statement: (statementResult.data ?? statement) as StatementRow & { reconciled_total?: number; opening_balance?: number },
        items: (itemsResult.data ?? []) as StatementItemRow[],
        payments: (allocationsResult.data ?? []).map((row: any) => row.payment).filter(Boolean) as StatementPaymentRow[],
      };
    },
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statementAction, setStatementAction] = useState<"approve" | "discard" | "force" | "add" | null>(null);
  const [adding, setAdding] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [justification, setJustification] = useState("");

  const current = detail.data?.statement ?? (statement as StatementRow & { reconciled_total?: number; opening_balance?: number });
  const items = detail.data?.items ?? [];
  const economicLocked = Number(current.paid_amount) > 0;
  const charges = items.filter((item) => !CREDIT_KINDS.includes(item.item_kind)).reduce((sum, item) => sum + Number(item.amount), 0);
  const credits = items.filter((item) => CREDIT_KINDS.includes(item.item_kind)).reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0);
  const difference = Number(current.reconciliation_difference ?? 0);
  const reconciled = Math.abs(difference) <= 0.05;

  async function afterMutation() {
    await onChanged();
    await detail.refetch();
  }

  async function saveItem(item: StatementItemRow, patch: { description?: string; category_id?: string | null; amount?: number; occurred_at?: string; item_kind?: string }) {
    setSavingId(item.id);
    const { data, error } = await (supabase as any).rpc("update_credit_card_statement_item", {
      p_item_id: item.id,
      p_description: patch.description ?? item.description,
      p_category_id: patch.category_id === undefined ? item.transaction?.category_id ?? null : patch.category_id,
      p_amount: patch.amount ?? Math.abs(Number(item.amount)),
      p_occurred_at: patch.occurred_at || item.occurred_at,
      p_item_kind: patch.item_kind ?? item.item_kind,
    });
    setSavingId(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível salvar o lançamento", { description: statementError(error, data) });
      return;
    }
    await afterMutation();
    toast.success("Lançamento atualizado");
  }

  async function removeItem(item: StatementItemRow) {
    if (!confirm(`Excluir "${item.description}" desta fatura? O lançamento criado por ele também será removido.`)) return;
    setSavingId(item.id);
    const { data, error } = await (supabase as any).rpc("delete_credit_card_statement_item", { p_item_id: item.id });
    setSavingId(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível excluir o lançamento", { description: statementError(error, data) });
      return;
    }
    await afterMutation();
    toast.success("Lançamento removido da fatura");
  }

  async function addItem(input: { item_kind: string; description: string; amount: number; occurred_at: string; category_id: string | null }) {
    setStatementAction("add");
    const { data, error } = await (supabase as any).rpc("add_credit_card_statement_item", {
      p_statement_id: current.id,
      p_item_kind: input.item_kind,
      p_description: input.description,
      p_amount: input.amount,
      p_occurred_at: input.occurred_at || null,
      p_category_id: input.category_id,
    });
    setStatementAction(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível adicionar o lançamento", { description: statementError(error, data) });
      return;
    }
    setAdding(false);
    await afterMutation();
    toast.success("Lançamento adicionado à fatura");
  }

  async function forceReconcile() {
    setStatementAction("force");
    const { data, error } = await (supabase as any).rpc("force_reconcile_credit_card_statement", {
      p_statement_id: current.id,
      p_justification: justification,
    });
    setStatementAction(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível fechar a conciliação", { description: statementError(error, data) });
      return;
    }
    setForcing(false);
    setJustification("");
    await afterMutation();
    toast.success("Conciliação fechada com ajuste registrado", { description: `Ajuste de ${formatBRL(Math.abs(Number(data.adjustment ?? 0)))} com trilha de auditoria.` });
  }

  async function approveStatement() {
    setStatementAction("approve");
    const { data, error } = await (supabase as any).rpc("approve_credit_card_statement", { p_statement_id: current.id });
    setStatementAction(null);
    if (error || !data?.ok) {
      toast.error("A fatura ainda não pode ser aprovada", { description: statementError(error, data) });
      return;
    }
    await onChanged();
    toast.success("Fatura aprovada");
    onClose();
  }

  async function discardStatement() {
    if (!confirm("Excluir esta fatura em revisão? Os lançamentos criados exclusivamente por esta importação também serão removidos. Esta ação não afeta outros lançamentos.")) return;
    setStatementAction("discard");
    const { data, error } = await (supabase as any).rpc("discard_credit_card_statement", { p_statement_id: current.id });
    setStatementAction(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível excluir a fatura", { description: statementError(error, data) });
      return;
    }
    await onChanged();
    toast.success("Fatura excluída com segurança", { description: `${data.removed_transactions ?? 0} lançamento(s) da importação removido(s).` });
    onClose();
  }

  async function reversePayment(payment: StatementPaymentRow) {
    if (!confirm(`Desfazer o pagamento de ${formatBRL(Number(payment.amount))}? O saldo da conta e a fatura serão restaurados.`)) return;
    setSavingId(payment.id);
    const { data, error } = await (supabase as any).rpc("reverse_credit_card_statement_payment", { p_payment_id: payment.id });
    setSavingId(null);
    if (error || !data?.ok) {
      toast.error("Não foi possível desfazer o pagamento", { description: statementError(error, data) });
      return;
    }
    await afterMutation();
    toast.success("Pagamento desfeito com trilha de auditoria");
  }

  return <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose}>
    <section onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[28px] border border-border bg-background shadow-2xl md:inset-y-0 md:left-auto md:w-[560px] md:max-h-none md:rounded-none">
      <header className="flex items-start justify-between border-b border-border p-5">
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Fatura</p><h2 className="font-display text-xl font-bold">{formatCompetence(current.competence_month)}</h2><p className="text-xs text-muted-foreground">Vence em {formatDate(current.due_date)} · {formatBRL(Number(current.stated_total))}</p></div>
        <button onClick={onClose} className="rounded-full border border-border p-2" aria-label="Fechar"><X size={16}/></button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-5">
        {economicLocked && <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Fatura com pagamento registrado.</strong> Para alterar valores, primeiro desfaça o pagamento abaixo.</div>}

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total oficial" value={formatBRL(Number(current.stated_total))}/>
          <Stat label="Compras e encargos" value={formatBRL(charges)}/>
          <Stat label="Pagamentos e créditos" value={`- ${formatBRL(credits)}`}/>
          <Stat label="Diferença" value={formatBRL(Math.abs(difference))}/>
        </div>

        {reconciled ? (
          <div className="mb-4 rounded-lg border border-success/40 bg-success/5 p-3 text-xs text-success"><strong>Conciliação fechada.</strong> Os lançamentos somam exatamente o total oficial da fatura.</div>
        ) : (
          <div className="mb-4 space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
            <p><strong>Faltam {formatBRL(Math.abs(difference))} para fechar.</strong> {difference < 0
              ? "Os lançamentos somam mais que o total oficial — normalmente falta registrar um pagamento ou crédito da fatura."
              : "Os lançamentos somam menos que o total oficial — provavelmente algum lançamento não foi extraído."}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setAdding(true); setForcing(false); }} disabled={economicLocked} className="rounded-full border border-warning/50 px-3 py-1.5 font-semibold disabled:opacity-40">Adicionar pagamento/crédito</button>
              <button type="button" onClick={() => { setForcing(true); setAdding(false); }} disabled={economicLocked} className="rounded-full border border-warning/50 px-3 py-1.5 font-semibold disabled:opacity-40">Fechar conciliação com ajuste</button>
            </div>
          </div>
        )}

        {forcing && <div className="mb-4 rounded-2xl border border-border bg-card p-3">
          <p className="text-xs font-semibold">Fechar conciliação com ajuste de {formatBRL(Math.abs(difference))}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Será criada uma linha de ajuste explícita, com sua justificativa e trilha de auditoria. O total oficial da fatura não muda.</p>
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Ex.: pagamento de R$ 1.080,63 não extraído do PDF" className="input-base mt-2 w-full text-xs"/>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setForcing(false); setJustification(""); }} className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
            <button type="button" onClick={forceReconcile} disabled={justification.trim().length < 3 || statementAction === "force"} className="btn-brand text-xs disabled:opacity-40">{statementAction === "force" ? "Fechando…" : "Confirmar ajuste"}</button>
          </div>
        </div>}

        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="text-sm font-semibold">Lançamentos</h3><p className="text-xs text-muted-foreground">Corrija, exclua ou adicione linhas até a fatura fechar.</p></div>
          <button type="button" onClick={() => { setAdding((value) => !value); setForcing(false); }} disabled={economicLocked} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"><Plus size={12}/>Adicionar</button>
        </div>

        {adding && <StatementItemCreator
          categories={categories}
          defaultDate={String(current.competence_month).slice(0, 10)}
          suggestedAmount={Math.abs(difference)}
          suggestedKind={difference < 0 ? "payment" : "purchase"}
          saving={statementAction === "add"}
          onCancel={() => setAdding(false)}
          onCreate={addItem}
        />}

        {detail.isLoading ? <Loader2 className="mx-auto my-8 animate-spin"/> : <div className="space-y-2">{items.map((item) => <StatementItemEditor key={item.id} item={item} categories={categories} saving={savingId === item.id} locked={economicLocked} onSave={saveItem} onDelete={removeItem}/>)}</div>}

        <div className="mt-6"><h3 className="text-sm font-semibold">Pagamentos da fatura</h3><p className="text-xs text-muted-foreground">Cada baixa reduz a conta e a obrigação, sem criar uma nova despesa de consumo.</p>
          <div className="mt-3 space-y-2">{detail.data?.payments.length ? detail.data.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between rounded-2xl border border-border p-3"><div><p className="text-sm font-semibold">{formatBRL(Number(payment.amount))}</p><p className="text-[11px] text-muted-foreground">{formatDate(payment.paid_at)} · {payment.account?.name ?? "Conta"}</p></div><button disabled={savingId === payment.id} onClick={() => reversePayment(payment)} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><RotateCcw size={12}/>Desfazer</button></div>) : <p className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">Nenhum pagamento registrado.</p>}</div>
        </div>
      </div>
      <footer className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
        {["needs_review", "draft", "open", "overdue"].includes(current.status) ? <>
          <button onClick={discardStatement} disabled={statementAction !== null || economicLocked} title={economicLocked ? "Desfaça o pagamento antes de excluir" : undefined} className="inline-flex items-center justify-center gap-2 rounded-full border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive disabled:opacity-40"><Trash2 size={14}/>{statementAction === "discard" ? "Excluindo…" : "Excluir fatura"}</button>
          <button onClick={approveStatement} disabled={statementAction !== null || !reconciled} title={reconciled ? undefined : "Feche a conciliação para aprovar"} className="btn-brand inline-flex items-center justify-center gap-2 disabled:opacity-40"><CheckCircle2 size={14}/>{statementAction === "approve" ? "Aprovando…" : "Aprovar fatura"}</button>
          {reconciled && Number(current.outstanding_amount) > 0 && <button onClick={onPay} className="rounded-full border border-border px-4 py-2 text-sm font-semibold sm:col-span-2">Registrar pagamento desta fatura</button>}
        </> : Number(current.outstanding_amount) > 0 && reconciled ? <button onClick={onPay} className="btn-brand sm:col-span-2">Registrar pagamento desta fatura</button> : null}
      </footer>
    </section>
  </div>;
}

function StatementItemCreator({ categories, defaultDate, suggestedAmount, suggestedKind, saving, onCancel, onCreate }: {
  categories: Array<{ id: string; name: string }>;
  defaultDate: string;
  suggestedAmount: number;
  suggestedKind: string;
  saving: boolean;
  onCancel: () => void;
  onCreate: (input: { item_kind: string; description: string; amount: number; occurred_at: string; category_id: string | null }) => Promise<void>;
}) {
  const [kind, setKind] = useState(suggestedKind);
  const [description, setDescription] = useState(suggestedKind === "payment" ? "Pagamento da fatura" : "");
  const [amount, setAmount] = useState(suggestedAmount > 0 ? suggestedAmount.toFixed(2).replace(".", ",") : "");
  const [occurredAt, setOccurredAt] = useState(defaultDate);
  const [categoryId, setCategoryId] = useState("");
  const numeric = parseAmount(amount);
  const valid = description.trim().length > 0 && Number.isFinite(numeric) && numeric > 0;
  return <article className="mb-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
    <p className="text-xs font-semibold">Novo lançamento na fatura</p>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)} className="input-base text-xs">{ITEM_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="Valor"><input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} className="input-base text-xs"/></Field>
      <Field label="Data"><input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="input-base text-xs"/></Field>
      <Field label="Categoria"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base text-xs" disabled={CREDIT_KINDS.includes(kind)}><option value="">Sem categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
    </div>
    <Field label="Descrição"><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-base text-xs" placeholder="Ex.: Pagamento da fatura"/></Field>
    <p className="mt-2 text-[11px] text-muted-foreground">{CREDIT_KINDS.includes(kind) ? "Pagamentos e créditos reduzem o total conciliado e não criam despesa." : "Compras e encargos somam no total conciliado."}</p>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button type="button" onClick={onCancel} className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Cancelar</button>
      <button type="button" disabled={!valid || saving} onClick={() => onCreate({ item_kind: kind, description: description.trim(), amount: numeric, occurred_at: occurredAt, category_id: categoryId || null })} className="btn-brand text-xs disabled:opacity-40">{saving ? "Adicionando…" : "Adicionar"}</button>
    </div>
  </article>;
}

function StatementItemEditor({ item, categories, saving, locked, onSave, onDelete }: { item: StatementItemRow; categories: Array<{id:string;name:string}>; saving: boolean; locked: boolean; onSave: (item: StatementItemRow, patch: {description?:string;category_id?:string|null;amount?:number;occurred_at?:string;item_kind?:string}) => Promise<void>; onDelete: (item: StatementItemRow) => Promise<void> }) {
  const [description, setDescription] = useState(item.description);
  const [categoryId, setCategoryId] = useState(item.transaction?.category_id ?? "");
  const [amount, setAmount] = useState(Math.abs(Number(item.amount)).toFixed(2).replace(".", ","));
  const [occurredAt, setOccurredAt] = useState(item.occurred_at ?? "");
  const [itemKind, setItemKind] = useState(item.item_kind);
  const numericAmount = parseAmount(amount);
  const isCredit = CREDIT_KINDS.includes(itemKind);
  const dirty = description !== item.description || categoryId !== (item.transaction?.category_id ?? "") || (Number.isFinite(numericAmount) && numericAmount !== Math.abs(Number(item.amount))) || occurredAt !== (item.occurred_at ?? "") || itemKind !== item.item_kind;
  return <article className="rounded-lg border border-border bg-card p-3">
    <div className="flex items-start justify-between gap-3">
      <input value={description} onChange={(e)=>setDescription(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"/>
      <strong className={isCredit ? "text-success" : ""}>{isCredit ? "- " : ""}{formatBRL(Number.isFinite(numericAmount) ? Math.abs(numericAmount) : 0)}</strong>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Field label="Valor"><input value={amount} inputMode="decimal" onChange={e=>setAmount(e.target.value)} className="input-base text-xs"/></Field>
      <Field label="Data"><input type="date" value={occurredAt} onChange={e=>setOccurredAt(e.target.value)} className="input-base text-xs"/></Field>
      <Field label="Tipo"><select value={itemKind} onChange={e=>setItemKind(e.target.value)} className="input-base text-xs">{ITEM_KINDS.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="Categoria"><select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)} className="input-base text-xs" disabled={isCredit}><option value="">Sem categoria</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
    </div>
    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
      <button disabled={!dirty||saving||locked||!Number.isFinite(numericAmount)||numericAmount<=0} onClick={()=>onSave(item,{description,category_id:categoryId||null,amount:Math.abs(numericAmount),occurred_at:occurredAt,item_kind:itemKind})} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saving?"Salvando…":"Salvar alterações"}</button>
      <button disabled={saving||locked} onClick={()=>onDelete(item)} title={locked ? "Desfaça o pagamento para excluir" : "Excluir lançamento"} className="rounded-full border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-40"><Trash2 size={12}/></button>
    </div>
  </article>;
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
