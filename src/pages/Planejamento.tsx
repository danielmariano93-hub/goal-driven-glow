import { useEffect, useMemo, useState } from "react";
import { CalendarBlank, Calculator, CheckCircle, Info, Warning, XCircle } from "@phosphor-icons/react";
import { useAccounts, useCategories } from "@/lib/db/finance";
import { useCreditCards } from "@/lib/db/creditCards";
import { sortCategories } from "@/lib/categories/order";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import { resolvePeriodRange } from "@/lib/ui/periodStore";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { monthLabel, simulateSpending, type SimulationVerdict } from "@/lib/engine/spendingSimulation";
import { categoryLimitsFor, purchaseMonths, usePurchasePlan, type PurchasePlanVerdict } from "@/lib/nino/purchasePlan";
import { PurchaseMonthByMonth } from "@/components/planning/PurchaseMonthByMonth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const VERDICT_STYLE: Record<SimulationVerdict, { chip: string; icon: JSX.Element }> = {
  safe: { chip: "bg-success/10 text-success", icon: <CheckCircle size={18} weight="fill" /> },
  attention: { chip: "bg-warning/15 text-warning-foreground", icon: <Warning size={18} weight="fill" /> },
  risky: { chip: "bg-brand-coral/15 text-brand-coral", icon: <Warning size={18} weight="fill" /> },
  unaffordable: { chip: "bg-destructive/10 text-destructive", icon: <XCircle size={18} weight="fill" /> },
};

/** Veredito mês a mês → estilo do selo. */
const PLAN_STYLE: Record<PurchasePlanVerdict, SimulationVerdict> = {
  fits: "safe",
  tight: "attention",
  deficit: "risky",
  worsens_deficit: "unaffordable",
  unknown: "attention",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function formatDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function Planejamento() {
  const period = useMemo(() => resolvePeriodRange(), []);
  const snapshot = useFinancialSnapshot(period);
  const { data: categories } = useCategories();
  const { data: accounts } = useAccounts();
  const { data: cards } = useCreditCards();

  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "debit" | "cash" | "card">("pix");
  const [categoryId, setCategoryId] = useState("");
  const [plannedDate, setPlannedDate] = useState(() => todayISO());
  const [cardId, setCardId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reviewCounted, setReviewCounted] = useState(false);

  useEffect(() => setReviewCounted(false), [amount, installments, paymentMethod, categoryId, plannedDate, cardId, accountId]);

  const result = useMemo(() => {
    const amt = Number(amount.replace(/\./g, "").replace(",", ".")) || 0;
    const isCard = paymentMethod === "card";
    if (!snapshot.data || amt <= 0 || !categoryId || (isCard ? !cardId : !accountId)) return null;
    return simulateSpending({
      snapshot: snapshot.data,
      amount: amt,
      installments,
      method: isCard ? "card" : "cash",
      categoryId: categoryId || null,
      categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type as "income" | "expense" })),
      plannedDate,
      card: isCard
        ? (cards ?? []).map((c) => ({ id: c.id, name: c.name, closing_day: c.closing_day, due_day: c.due_day })).find((c) => c.id === cardId) ?? null
        : null,
      accountName: isCard ? null : (accounts ?? []).find((account) => account.id === accountId)?.name ?? null,
    });
  }, [amount, installments, paymentMethod, categoryId, snapshot.data, categories, plannedDate, cardId, cards, accountId, accounts]);

  // A compra é julgada em cada mês em que pesa (fatura de cada parcela ou mês
  // da compra à vista) — não só no mês corrente.
  const planRequest = useMemo(() => {
    if (!result) return null;
    const months = purchaseMonths({
      method: result.method,
      plannedDate: result.plannedDate,
      cardCompetence: result.cardCompetence,
      installments: result.installments,
      installmentAmount: result.installmentAmount,
      amount: result.amount,
    });
    const goal = snapshot.data?.activeCategoryGoals.find((g) => g.goal.category_id === categoryId);
    return {
      amount: result.amount,
      category_id: categoryId || null,
      category_name: (categories ?? []).find((c) => c.id === categoryId)?.name ?? "Categoria",
      months,
      category_limits: categoryLimitsFor(months.map((m) => m.month), goal),
    };
  }, [result, snapshot.data, categoryId, categories]);
  const debouncedRequest = useDebounced(planRequest, 500);
  const plan = usePurchasePlan(debouncedRequest);
  const planReady = plan.data && debouncedRequest === planRequest ? plan.data : null;

  const style = planReady ? VERDICT_STYLE[PLAN_STYLE[planReady.verdict]] : result ? VERDICT_STYLE[result.verdict] : null;
  const headline = planReady?.headline ?? result?.headline ?? "";
  const touchesCurrentMonth = !!result && (result.method === "cash" ? result.plannedDate.slice(0, 7) === todayISO().slice(0, 7) : result.cashImpactWithinMonth);
  const planDeficit = planReady && (planReady.verdict === "deficit" || planReady.verdict === "worsens_deficit");

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-20">
      <header>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Antes de gastar</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Simule uma compra e veja o efeito em cada mês em que ela pesa.
        </p>
      </header>

      <section className="rounded-[18px] border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sim-amount" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Valor da compra (R$)</label>
            <input id="sim-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="input-base min-h-11" />
          </div>
          <div>
            <label htmlFor="sim-cat" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Categoria</label>
            <select id="sim-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input-base min-h-11">
              <option value="">Escolher categoria</option>
              {sortCategories((categories ?? []).filter((c) => c.type === "expense")).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sim-method" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Forma de pagamento</label>
            <select id="sim-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "pix" | "debit" | "cash" | "card")} className="input-base min-h-11">
              <option value="pix">PIX</option>
              <option value="debit">Cartão de débito</option>
              <option value="cash">Dinheiro</option>
              <option value="card">Cartão de crédito</option>
            </select>
          </div>
          <div>
            <label htmlFor="sim-date" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Data prevista</label>
            <input id="sim-date" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className="input-base min-h-11" />
          </div>
          {paymentMethod === "card" ? (
            <div>
              <label htmlFor="sim-card" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Cartão</label>
              <select id="sim-card" value={cardId} onChange={(e) => setCardId(e.target.value)} className="input-base min-h-11">
                <option value="">Escolher cartão</option>
                {(cards ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="sim-account" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Conta de saída</label>
              <select id="sim-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base min-h-11">
                <option value="">Escolher conta</option>
                {(accounts ?? []).filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="sim-inst" className="mb-1 block text-[11px] font-semibold text-muted-foreground">Parcelas</label>
            <select id="sim-inst" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="input-base min-h-11" disabled={paymentMethod !== "card"}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}x</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {snapshot.loading ? (
        <div className="h-40 animate-pulse rounded-[18px] bg-muted" />
      ) : snapshot.criticalError ? (
        <section className="rounded-[18px] border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Não conseguimos carregar sua situação financeira agora.</p>
          <button type="button" onClick={() => void snapshot.refetchCritical()} className="mt-2 min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">Tentar de novo</button>
        </section>
      ) : !result ? (
        <section className="rounded-[18px] border border-dashed border-border bg-card p-8 text-center">
          <Calculator size={26} className="mx-auto text-muted-foreground" weight="duotone" />
          <p className="mt-2 text-[13px] text-muted-foreground">Informe valor, categoria, data e origem do pagamento para ver um impacto confiável.</p>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-[18px] border border-border bg-card">
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                {plan.isFetching && !planReady ? (
                  <span className="inline-flex h-6 w-40 animate-pulse rounded-full bg-muted" aria-label="Calculando o efeito mês a mês" />
                ) : (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${style?.chip}`}>{style?.icon} {headline}</span>
                )}
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-foreground">{formatBRL(result.amount)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {result.method === "card"
                    ? `${result.installments}x de ${formatBRL(result.installmentAmount)} no cartão`
                    : "À vista, direto do saldo"}
                  {result.daysOfTypicalPace != null ? ` · equivale a ${result.daysOfTypicalPace.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias do seu ritmo típico` : ""}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Compra em {formatDate(result.plannedDate)} · dinheiro sai em {formatDate(result.cashImpactDate)}
                  {result.cardCompetence ? ` (fatura de ${monthLabel(result.cardCompetence)})` : ""}
                </p>
                {planReady?.explanation ? (
                  <p className="mt-2 text-[12.5px] leading-[18px] text-foreground/80">{planReady.explanation}</p>
                ) : null}
              </div>
            </div>
            {touchesCurrentMonth ? (
              <>
                <div className="grid grid-cols-2 border-t border-border">
                  <Metric label="Disponível hoje" before={result.availableToday} after={result.availableAfterNow} />
                  <Metric label="Fechamento deste mês" before={result.projectedEndBalance} after={result.projectedEndBalanceAfter} bordered />
                </div>
                <div className="border-t border-border p-3.5">
                  <Metric label="Livre depois do que já tem data" before={result.freeAfterCommitments} after={result.freeAfterCommitmentsAfter} inline />
                </div>
              </>
            ) : null}
          </section>

          <button
            type="button"
            disabled={reviewCounted}
            onClick={async () => {
              const sourceId = crypto.randomUUID();
              const { error } = await supabase.rpc("challenge_progress_add", {
                p_slug: "antes-de-gastar", p_delta: 1, p_source_type: "pre_spend_review", p_source_id: sourceId,
              });
              if (error) return toast.error("A análise está pronta, mas não conseguimos atualizar o desafio.");
              setReviewCounted(true);
              toast.success("Análise registrada no seu desafio.");
            }}
            className="min-h-11 w-full rounded-full border border-primary/30 bg-primary/5 px-4 text-xs font-semibold text-primary disabled:opacity-60"
          >
            {reviewCounted ? "Análise registrada" : "Concluir esta análise"}
          </button>

          {planReady && planReady.months.length > 0 ? <PurchaseMonthByMonth plan={planReady} /> : null}
          {plan.isError && !planReady ? (
            <p className="rounded-[18px] border border-border bg-card p-4 text-[12px] text-muted-foreground">
              Não consegui projetar os próximos meses agora. O resultado acima considera só o mês atual.
            </p>
          ) : null}

          {result.installmentSchedule.length > 1 ? (
            <section className="rounded-[18px] border border-border bg-card p-4">
              <h2 className="font-display text-base font-bold text-foreground">Parcelas que entrarão nas próximas faturas</h2>
              <ul className="mt-2 divide-y divide-border">
                {result.installmentSchedule.map((item) => (
                  <li key={item.installment} className="flex min-h-10 items-center justify-between py-2 text-[12px]">
                    <span className="text-muted-foreground">{item.installment}/{result.installments} · {formatDate(item.cashImpactDate)}</span>
                    <strong>{formatBRL(item.amount)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {planReady && planReady.fixed_commitments.length > 0 ? (
            <section className="rounded-[18px] border border-border bg-card p-4">
              <h2 className="font-display text-base font-bold text-foreground">Fixos que o Nino identificou</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Cobranças que se repetem todo mês com valor parecido. Já estão no seu gasto típico.</p>
              <ul className="mt-2 divide-y divide-border">
                {planReady.fixed_commitments.map((item) => (
                  <li key={item.label} className="flex min-h-10 items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-foreground">{item.label}</span>
                    <strong className="shrink-0 tabular-nums">{formatBRL(item.amount)}<span className="text-[11px] font-normal text-muted-foreground">/mês</span></strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.commitments.length > 0 ? (
            <section className="rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <CalendarBlank size={18} className="text-muted-foreground" weight="duotone" />
                <h2 className="font-display text-base font-bold text-foreground">Próximos vencimentos</h2>
              </div>
              <ul className="mt-2 divide-y divide-border">
                {result.commitments.map((item) => (
                  <li key={`${item.name}-${item.date}`} className="flex min-h-11 items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-[13px] text-foreground">
                      {item.name}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">{formatDate(item.date)}{item.estimated ? " · previsto" : ""}</span>
                    </span>
                    <strong className="shrink-0 text-[13px] font-bold tabular-nums text-foreground">{formatBRL(item.amount)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(planReady ? planDeficit : result.goalsAtRisk.length > 0) && (snapshot.data?.goalProgress ?? []).some((g) => g.remaining > 0) ? (
            <section className="rounded-[18px] border border-brand-coral/40 bg-brand-coral/10 p-4">
              <p className="text-[13px] font-semibold text-foreground">Metas que podem sofrer</p>
              <ul className="mt-1 list-disc pl-4 text-[12px] text-muted-foreground">
                {(planReady
                  ? (snapshot.data?.goalProgress ?? []).filter((g) => g.remaining > 0).map((g) => ({ id: g.id, name: g.name, remaining: g.remaining }))
                  : result.goalsAtRisk
                ).map((g) => <li key={g.id}>{g.name} — faltam {formatBRL(g.remaining)}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="rounded-[18px] border border-border bg-card p-4 text-[12px] text-muted-foreground">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-foreground"><Info size={14} weight="duotone" /> Como calculamos</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {planReady ? (
                <>
                  <li>Cada parte da compra é julgada no mês em que pesa: no cartão, o mês da fatura de cada parcela.</li>
                  <li>
                    Mês típico: entram {formatBRL(planReady.basis.typical_income)} e saem {formatBRL(planReady.basis.typical_spend)} (mediana dos últimos {planReady.basis.months_of_history} meses; já inclui aluguel, contas e parcelas de sempre). Se o que já está comprometido para o mês for maior, vale o comprometido.
                  </li>
                  {planReady.notes.map((note) => <li key={note}>{note}</li>)}
                </>
              ) : null}
              {result.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
            {result.limitations.length > 0 ? (
              <>
                <p className="mt-3 text-[11px] font-bold text-foreground">Limitações</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {result.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, before, after, bordered, inline }: { label: string; before: number; after: number; bordered?: boolean; inline?: boolean }) {
  const negative = after < 0;
  return (
    <div className={`${bordered ? "border-l border-border " : ""}${inline ? "" : "p-3.5"}`}>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-lg font-bold tabular-nums ${negative ? "text-destructive" : "text-foreground"}`}>{formatBRL(after)}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">antes: {formatBRL(before)}</p>
    </div>
  );
}

