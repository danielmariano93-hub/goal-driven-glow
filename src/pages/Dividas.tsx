import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2, Loader2, Pencil, AlertOctagon, CheckCircle2, Coins, ChevronDown, ChevronUp, Trophy, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAccounts,
  useDebts,
  useSaveDebt,
  useDeleteDebt,
  useRecordDebtPayment,
  useAllDebtPayments,
  useLinkTransactionToDebt,
  useUnlinkDebtPayment,
  useSetNextInstallment,
  useDebtLinkCandidates,
  type DebtRow,
} from "@/lib/db/finance";
import { debtSchema } from "@/lib/validation/finance";
import { computeActiveDebtsTotal, formatBRL } from "@/lib/engine/facts";
import { resolveDebtPlan } from "@/lib/finance/accounting";
import { computeDebtStatus, buildDebtSchedule, type DebtScheduleRow, type DebtStatusItem } from "@/lib/engine/debtStatus";
import { today } from "@/lib/engine/ninoClock";

export default function Dividas() {
  const { data: items, isLoading } = useDebts();
  const save = useSaveDebt();
  const del = useDeleteDebt();
  const payment = useRecordDebtPayment();
  const link = useLinkTransactionToDebt();
  const unlink = useUnlinkDebtPayment();
  const [linking, setLinking] = useState<DebtRow | null>(null);
  const setNext = useSetNextInstallment();
  const [editingNext, setEditingNext] = useState<{ debt: DebtRow; due: string; amount: number; adjusted: boolean } | null>(null);
  const { data: accounts = [] } = useAccounts();
  const { data: debtPayments = [] } = useAllDebtPayments();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DebtRow | null>(null);
  const [paying, setPaying] = useState<DebtRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // CTA do Nino ("Registrar pagamento") chega com ?debt=<id>&action=pagar.
  const focusDebtId = params.get("debt");
  const focusAction = params.get("action");
  useEffect(() => {
    if (!focusDebtId || !items?.length) return;
    const target = items.find((d) => d.id === focusDebtId);
    if (!target) return;
    setExpanded(target.id);
    if (focusAction === "pagar") setPaying(target);
    const next = new URLSearchParams(params);
    next.delete("debt");
    next.delete("action");
    setParams(next, { replace: true });
  }, [focusDebtId, focusAction, items, params, setParams]);

  // Fonte única (finance_contract.v2): total de dívidas ativas pelo core.
  const totalOutstanding = computeActiveDebtsTotal(items ?? []);

  // debt_status.v1 — situação/atraso/próximo vencimento vêm do MESMO motor
  // consumido pelo Nino, pelos alertas proativos e pelo WhatsApp.
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const debtStatus = computeDebtStatus({
    debts: (items ?? []) as unknown as DebtScheduleRow[],
    payments: debtPayments.map((p) => ({
      debt_id: p.debt_id,
      paid_at: String(p.paid_at ?? "").slice(0, 10),
      amount: Number(p.amount ?? 0),
      amount_applied: Number(p.amount_applied ?? p.amount ?? 0),
      installments_covered: p.installments_covered ?? null,
    })),
    today: todayIso,
  });
  const statusByDebt = new Map<string, DebtStatusItem>(
    debtStatus.breakdown.map((item) => [item.debt_id, item]),
  );

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
            {items.map((d) => {
              const original = Number(d.contract_total_amount ?? d.original_amount);
              const outstanding = Number(d.outstanding_balance);
              const paid = Math.max(0, original - outstanding);
              const progress = original > 0 ? Math.min(100, (paid / original) * 100) : 0;
              const status = statusByDebt.get(d.id);
              return (
              <li key={d.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {d.name}
                    {d.status !== "active" && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide">{d.status === "settled" ? "Quitada" : "Inadimplente"}</span>}
                  </p>
                  {status && status.situation !== "indefinido" && (
                    <p className="mt-1">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        status.situation === "em_atraso"
                          ? "bg-destructive/10 text-destructive"
                          : status.situation === "vence_em_breve"
                            ? "bg-warning/10 text-warning"
                            : status.situation === "quitada"
                              ? "bg-success/10 text-success"
                              : "bg-secondary text-muted-foreground"
                      }`}>
                        {status.situation === "em_atraso"
                          ? `Em atraso · ${status.days_overdue} dia(s)`
                          : status.situation === "vence_em_breve"
                            ? `Vence em ${status.days_to_due} dia(s)`
                            : status.situation === "quitada"
                              ? "Quitada"
                              : "Em dia"}
                      </span>
                      {status.next_due_date && status.situation !== "quitada" && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          Próximo vencimento {new Date(`${status.next_due_date}T12:00:00Z`).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {d.creditor ? `${d.creditor} · ` : ""}Total contratado {formatBRL(original)}
                    {d.installment_amount ? ` · parcela ${formatBRL(Number(d.installment_amount))}` : ""}
                    {d.installments_total ? ` · ${d.installments_paid ?? 0}/${d.installments_total} pagas` : ""}
                    {d.interest_rate_pct != null ? ` · juros informado ${d.interest_rate_pct}%` : ""}
                  </p>
                  <p className="mt-2 text-xs">
                    Já pago <span className="font-semibold text-success">{formatBRL(paid)}</span>
                    {" · "}Falta <span className="font-semibold">{formatBRL(outstanding)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {d.status === "active" && (
                    <button
                      onClick={() => setPaying(d)}
                      className="grid h-11 w-11 place-items-center rounded-full border border-border text-primary transition-colors hover:bg-primary/5 active:bg-primary/10"
                      aria-label="Registrar pagamento"
                    >
                      <Coins size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditing(d);
                      setOpen(true);
                    }}
                    className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground active:bg-secondary"
                    aria-label="Editar dívida"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Excluir esta dívida?")) del.mutate(d.id, { onSuccess: () => toast.success("Excluída") });
                    }}
                    className="grid h-11 w-11 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-destructive active:bg-destructive/10"
                    aria-label="Excluir dívida"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-medium">{progress.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% quitado</span>
                    {progress >= 100 ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={12} /> Concluída</span> : <span className="text-muted-foreground">Continue assim</span>}
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <DebtScheduleBlock
                  debt={d}
                  payments={debtPayments}
                  today={todayIso}
                  expanded={expanded === d.id}
                  onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
                  onPay={() => setPaying(d)}
                  onLink={() => setLinking(d)}
                  onEditNext={(row) => setEditingNext({ debt: d, due: row.due_date, amount: row.amount, adjusted: !!row.adjusted })}
                  onUnlink={(id) => unlink.mutate(id, {
                    onSuccess: () => toast.success("Pagamento desfeito"),
                    onError: (e: unknown) => toast.error("Não foi possível desfazer", { description: String((e as Error).message) }),
                  })}
                />
              </li>
              );
            })}
          </ul>
        </>

      )}

      {paying && (
        <DebtPaymentModal
          debt={paying}
          accounts={accounts}
          saving={payment.isPending}
          onClose={() => setPaying(null)}
          onSubmit={(value) => payment.mutate(value, {
            onSuccess: () => {
              toast.success("Pagamento registrado", { description: "O saldo e o progresso da dívida foram atualizados." });
              setPaying(null);
            },
            onError: (error: unknown) => toast.error("Não foi possível registrar", { description: String((error as Error).message) }),
          })}
        />
      )}

      {editingNext && (
        <NextInstallmentModal
          info={editingNext}
          saving={setNext.isPending}
          onClose={() => setEditingNext(null)}
          onSubmit={(due, amount) => setNext.mutate({ debt_id: editingNext.debt.id, due, amount }, {
            onSuccess: () => { toast.success(due || amount ? "Parcela ajustada" : "Parcela restaurada", { description: "Compromissos e lembretes já usam o novo vencimento." }); setEditingNext(null); },
            onError: (e: unknown) => toast.error("Não foi possível salvar", { description: String((e as Error).message) }),
          })}
        />
      )}

      {linking && (
        <LinkTransactionSheet
          debt={linking}
          saving={link.isPending}
          onClose={() => setLinking(null)}
          onPick={(transactionId) => link.mutate({ debt_id: linking.id, transaction_id: transactionId }, {
            onSuccess: () => { toast.success("Lançamento vinculado", { description: "A dívida e os compromissos foram atualizados." }); setLinking(null); },
            onError: (e: unknown) => toast.error("Não foi possível vincular", { description: String((e as Error).message) }),
          })}
        />
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

function DebtScheduleBlock({
  debt,
  payments,
  today,
  expanded,
  onToggle,
  onPay,
  onLink,
  onUnlink,
  onEditNext,
}: {
  debt: DebtRow;
  payments: Array<{ id?: string; idempotency_key?: string | null; debt_id: string; paid_at: string | null; amount: number | null; amount_applied?: number | null; installments_covered?: number | null }>;
  today: string;
  expanded: boolean;
  onToggle: () => void;
  onPay: () => void;
  onLink: () => void;
  onUnlink: (paymentId: string) => void;
  onEditNext: (row: { index: number; due_date: string; amount: number; adjusted?: boolean }) => void;
}) {
  const schedule = buildDebtSchedule(
    debt as unknown as DebtScheduleRow,
    payments
      .filter((p) => p.debt_id === debt.id)
      .map((p) => ({
        debt_id: p.debt_id,
        paid_at: String(p.paid_at ?? "").slice(0, 10),
        amount: Number(p.amount ?? 0),
        amount_applied: Number(p.amount_applied ?? p.amount ?? 0),
        installments_covered: p.installments_covered ?? null,
      })),
    today,
  );

  if (schedule.installments.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">
        Informe valor da parcela e dia de vencimento para o Nino acompanhar a agenda desta dívida.
      </p>
    );
  }

  const pending = schedule.installments.filter((i) => i.state !== "paga");
  const visible = expanded ? schedule.installments : pending.slice(0, 3);
  const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR");

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground">
          Parcelas {schedule.installments_paid}
          {schedule.installments_total ? `/${schedule.installments_total}` : ""} pagas
          {schedule.overdue_count > 0 ? ` · ${schedule.overdue_count} em atraso` : ""}
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-11 items-center gap-1 text-[11px] font-semibold text-primary"
          aria-expanded={expanded}
        >
          {expanded ? "Recolher" : "Ver todas"}
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {schedule.milestones.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {schedule.milestones.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
              <Trophy size={10} /> {m === 100 ? "Quitada" : `${m}% quitado`}
            </span>
          ))}
        </div>
      )}

      <ul className="mt-2 space-y-1">
        {visible.map((i) => (
          <li key={i.index} className="flex items-center justify-between gap-2 rounded-xl bg-secondary/40 px-2.5 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{i.index}ª</span> · {fmtDate(i.due_date)} · {formatBRL(i.amount)}
            </span>
            {i.state !== "paga" && i.index === schedule.installments_paid + 1 ? (
              <button type="button" onClick={() => onEditNext(i)} className="min-h-11 px-2 text-[10px] font-semibold text-muted-foreground underline">
                {i.adjusted ? "Ajustada · editar" : "Editar"}
              </button>
            ) : null}
            {i.state === "paga" ? (
              <span className="text-[10px] font-semibold text-success">Paga</span>
            ) : i.state === "vencida" ? (
              <button type="button" onClick={onPay} className="min-h-11 rounded-full bg-destructive/10 px-3 text-[10px] font-semibold text-destructive">
                Vencida · registrar
              </button>
            ) : i.state === "proxima" ? (
              <button type="button" onClick={onPay} className="min-h-11 rounded-full bg-primary/10 px-3 text-[10px] font-semibold text-primary">
                Próxima · registrar
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground">A vencer</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onLink} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-[11px] font-semibold text-primary">
          <Link2 size={13} /> Vincular lançamento a esta dívida
        </button>
      </div>

      {expanded && payments.some((p) => p.debt_id === debt.id) && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold">Pagamentos registrados</p>
          <ul className="mt-1 space-y-1">
            {payments.filter((p) => p.debt_id === debt.id).map((p, idx) => (
              <li key={p.id ?? idx} className="flex items-center justify-between gap-2 rounded-xl bg-secondary/40 px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground">{fmtDate(String(p.paid_at).slice(0, 10))} · {formatBRL(Number(p.amount ?? 0))}{String(p.idempotency_key ?? "").startsWith("link") ? " · lançamento vinculado" : ""}</span>
                {p.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      const linked = String(p.idempotency_key ?? "").startsWith("link");
                      if (confirm(linked
                        ? "Desvincular este lançamento da dívida? O gasto continua nos seus lançamentos."
                        : "Desfazer este pagamento? O saldo e a parcela voltam a ficar em aberto; o gasto continua nos seus lançamentos.")) onUnlink(p.id!);
                    }}
                    className="min-h-11 px-2 text-[10px] font-semibold text-destructive"
                  >
                    {String(p.idempotency_key ?? "").startsWith("link") ? "Desvincular" : "Desfazer"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {schedule.payoff_date && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Quitação prevista em {fmtDate(schedule.payoff_date)} · falta {formatBRL(schedule.outstanding)}
        </p>
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
  const [isInstallment, setIsInstallment] = useState(Boolean(initial?.installments_total));
  const [installmentsTotal, setInstallmentsTotal] = useState(initial?.installments_total ? String(initial.installments_total) : "");
  const [installmentsPaid, setInstallmentsPaid] = useState(initial?.installments_paid ? String(initial.installments_paid) : "0");
  const [dueDay, setDueDay] = useState(initial?.due_day != null ? String(initial.due_day) : "");
  const [firstDue, setFirstDue] = useState(String((initial as { first_due_date?: string | null } | null)?.first_due_date ?? "").slice(0, 10));
  const [rate, setRate] = useState(initial?.interest_rate_pct != null ? String(initial.interest_rate_pct) : "");
  const [status, setStatus] = useState<string>(initial?.status ?? "active");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  // Total, parcela e nº de parcelas se calculam entre si: o campo que a pessoa
  // mexeu por último vale; o outro é derivado.
  const [anchor, setAnchor] = useState<"original" | "installment">(initial?.installment_amount && !initial?.original_amount ? "installment" : "original");
  const num = (v: string) => Number(v.replace(",", "."));
  const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
  function recalc(next: { original?: string; installment?: string; total?: string }, by: "original" | "installment" | "total") {
    const o = next.original ?? original, i = next.installment ?? installment, t = next.total ?? installmentsTotal;
    const n = Math.floor(num(t || "0"));
    const src = by === "total" ? anchor : by;
    if (!isInstallment || !(n >= 1)) return;
    if (src === "original" && num(o || "0") > 0) setInstallment(fmt(num(o) / n));
    else if (src === "installment" && num(i || "0") > 0) setOriginal(fmt(num(i) * n));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const plan = resolveDebtPlan({
      originalAmount: original ? Number(original.replace(",", ".")) : null,
      installmentAmount: installment ? Number(installment.replace(",", ".")) : null,
      installmentsTotal: isInstallment ? Number(installmentsTotal) : null,
      installmentsPaid: isInstallment ? Number(installmentsPaid) : 0,
    });
    const parsed = debtSchema.safeParse({
      name,
      creditor,
      original_amount: plan.originalAmount,
      outstanding_balance: initial ? Number(outstanding.replace(",", ".")) : plan.outstandingAmount,
      installment_amount: isInstallment ? plan.installmentAmount : (installment ? Number(installment.replace(",", ".")) : null),
      installments_total: isInstallment ? Number(installmentsTotal) : null,
      installments_paid: isInstallment ? Number(installmentsPaid) : 0,
      contract_total_amount: plan.originalAmount,
      principal_amount: plan.originalAmount,
      amount_was_inferred: plan.inferredOriginal,
      due_day: dueDay ? Number(dueDay) : null,
      first_due_date: isInstallment && firstDue ? firstDue : null,
      start_date: (initial as { start_date?: string | null } | null)?.start_date ?? null,
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
              <label className="mb-1 block text-xs font-medium">Valor total da dívida</label>
              <input inputMode="decimal" value={original} onChange={(e) => { setOriginal(e.target.value); setAnchor("original"); recalc({ original: e.target.value }, "original"); }} className="input-base" placeholder={isInstallment ? "Ou informe a parcela" : ""} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Saldo pendente</label>
              <input inputMode="decimal" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} className="input-base" />
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" checked={isInstallment} onChange={(e) => setIsInstallment(e.target.checked)} />
            Esta dívida foi parcelada
          </label>
          {isInstallment && (
            <div className="rounded-xl bg-secondary/40 p-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Valor da parcela</label>
                  <input inputMode="decimal" value={installment} onChange={(e) => { setInstallment(e.target.value); setAnchor("installment"); recalc({ installment: e.target.value }, "installment"); }} className="input-base" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Total</label>
                  <input type="number" min={1} max={600} value={installmentsTotal} onChange={(e) => { setInstallmentsTotal(e.target.value); recalc({ total: e.target.value }, "total"); }} className="input-base" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Já pagas</label>
                  <input type="number" min={0} max={Number(installmentsTotal) || 600} value={installmentsPaid} onChange={(e) => setInstallmentsPaid(e.target.value)} className="input-base" />
                </div>
              </div>
              {installment && installmentsTotal && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {Number(installmentsTotal)}× {formatBRL(num(installment))} = <strong className="text-foreground">{formatBRL(num(installment) * Number(installmentsTotal))}</strong>. Os valores se calculam sozinhos: mexa em total ou parcela e o outro acompanha.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Dia venc.</label>
              <input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="input-base" />
            </div>
            {isInstallment && (
              <div>
                <label className="mb-1 block text-xs font-medium">Venc. da 1ª parcela</label>
                <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className="input-base" />
              </div>
            )}
          </div>
          {isInstallment && !firstDue && (
            <p className="text-[11px] text-muted-foreground">Informe a data da 1ª parcela para o Nino montar a agenda exata (qual parcela já foi paga e qual vence agora).</p>
          )}
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

function DebtPaymentModal({
  debt,
  accounts,
  saving,
  onClose,
  onSubmit,
}: {
  debt: DebtRow;
  accounts: Array<{ id: string; name: string; active: boolean }>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (value: {
    debt_id: string;
    account_id: string;
    paid_at: string;
    amount: number;
    interest_amount: number;
    fee_amount: number;
    installments_covered: number;
    notes: string;
  }) => void;
}) {
  const [accountId, setAccountId] = useState(accounts.find((account) => account.active)?.id ?? "");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(debt.installment_amount ? String(debt.installment_amount) : "");
  const [interest, setInterest] = useState("0");
  const [fees, setFees] = useState("0");
  const [covered, setCovered] = useState(debt.installments_total ? "1" : "0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const total = Number(amount.replace(",", "."));
    const interestAmount = Number(interest.replace(",", ".") || 0);
    const feeAmount = Number(fees.replace(",", ".") || 0);
    if (!accountId || !Number.isFinite(total) || total <= 0) {
      setError("Escolha a conta e informe um pagamento válido.");
      return;
    }
    if (interestAmount + feeAmount > total) {
      setError("Juros e tarifas não podem superar o pagamento.");
      return;
    }
    onSubmit({
      debt_id: debt.id,
      account_id: accountId,
      paid_at: date,
      amount: total,
      interest_amount: interestAmount,
      fee_amount: feeAmount,
      installments_covered: Number(covered || 0),
      notes,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Registrar pagamento</h2>
        <p className="mt-1 text-xs text-muted-foreground">{debt.name} · saldo {formatBRL(Number(debt.outstanding_balance))}</p>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium">Conta usada
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="input-base mt-1">
              <option value="">Selecione</option>
              {accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium">Valor pago<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-base mt-1" /></label>
            <label className="text-xs font-medium">Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input-base mt-1" /></label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-medium">Juros extras<input inputMode="decimal" value={interest} onChange={(event) => setInterest(event.target.value)} className="input-base mt-1" /></label>
            <label className="text-xs font-medium">Tarifas<input inputMode="decimal" value={fees} onChange={(event) => setFees(event.target.value)} className="input-base mt-1" /></label>
            <label className="text-xs font-medium">Parcelas quitadas<input type="number" min={0} value={covered} onChange={(event) => setCovered(event.target.value)} className="input-base mt-1" /></label>
          </div>
          <p className="rounded-xl bg-secondary/50 p-3 text-[11px] text-muted-foreground">
            O valor aplicado reduz a dívida. Juros e tarifas são separados para não serem confundidos com amortização.
          </p>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="input-base min-h-16" placeholder="Observação opcional" />
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand">{saving ? "Salvando…" : "Registrar"}</button>
        </div>
      </form>
    </div>
  );
}


function LinkTransactionSheet({
  debt,
  saving,
  onClose,
  onPick,
}: {
  debt: DebtRow;
  saving: boolean;
  onClose: () => void;
  onPick: (transactionId: string) => void;
}) {
  const { data = [], isLoading } = useDebtLinkCandidates(true);
  const [query, setQuery] = useState("");
  const installment = Number(debt.installment_amount ?? 0);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nameKey = debt.name.toLowerCase();
    return data
      .filter((t) => !q || t.description.toLowerCase().includes(q) || String(t.amount).includes(q.replace(",", ".")))
      .map((t) => ({
        t,
        score: (installment > 0 && Math.abs(t.amount - installment) < 0.01 ? 2 : 0) + (t.description.toLowerCase().includes(nameKey) ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || b.t.occurred_at.localeCompare(a.t.occurred_at))
      .slice(0, 40);
  }, [data, query, installment, debt.name]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-2xl border border-border bg-card shadow-card sm:rounded-2xl">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold">Vincular lançamento</h2>
          <p className="mt-1 text-xs text-muted-foreground">Escolha o gasto que foi o pagamento de uma parcela de <strong>{debt.name}</strong>. Nada é duplicado: o lançamento só passa a contar como parcela paga.</p>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou valor" className="input-base mt-3" />
        </div>
        <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto">
          {isLoading ? (
            <li className="grid place-items-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></li>
          ) : rows.length === 0 ? (
            <li className="p-6 text-center text-xs text-muted-foreground">Nenhum gasto disponível para vincular.</li>
          ) : rows.map(({ t, score }) => (
            <li key={t.id}>
              <button type="button" disabled={saving} onClick={() => onPick(t.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-secondary/50 disabled:opacity-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.description || "Sem descrição"}</span>
                  <span className="block text-[11px] text-muted-foreground">{new Date(`${t.occurred_at}T12:00:00Z`).toLocaleDateString("pt-BR")}{score >= 2 ? " · valor da parcela" : ""}</span>
                </span>
                <strong className="shrink-0 text-sm tabular-nums">{formatBRL(t.amount)}</strong>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-border p-3 text-right">
          <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">Fechar</button>
        </div>
      </div>
    </div>
  );
}


function NextInstallmentModal({
  info,
  saving,
  onClose,
  onSubmit,
}: {
  info: { debt: DebtRow; due: string; amount: number; adjusted: boolean };
  saving: boolean;
  onClose: () => void;
  onSubmit: (due: string | null, amount: number | null) => void;
}) {
  const [due, setDue] = useState(info.due);
  const [amount, setAmount] = useState(String(info.amount).replace(".", ","));
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(value) || value <= 0) {
      setError("Informe uma data e um valor válidos.");
      return;
    }
    onSubmit(due, value);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Editar próxima parcela</h2>
        <p className="mt-1 text-xs text-muted-foreground">{info.debt.name} · vale só para esta parcela; as seguintes seguem o contrato. Compromissos e lembretes passam a usar o novo vencimento.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-xs font-medium">Vencimento<input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input-base mt-1" /></label>
          <label className="text-xs font-medium">Valor<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base mt-1" /></label>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {info.adjusted && (
            <button type="button" disabled={saving} onClick={() => onSubmit(null, null)} className="mr-auto min-h-11 px-2 text-xs font-semibold text-muted-foreground underline">Restaurar contrato</button>
          )}
          <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand">{saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}
