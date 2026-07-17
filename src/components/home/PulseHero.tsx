import { useMemo } from "react";
import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { computePulse } from "@/lib/pulse/rules";
import { useAccounts, useAllTransactions, useGoals, useInvestments, useDebts } from "@/lib/db/finance";
import { computeTotalCash, computeCategoryBreakdown, currentMonthYM } from "@/lib/engine/facts";

export function PulseHero() {
  const { data: accounts } = useAccounts();
  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: debts } = useDebts();

  const pulse = useMemo(() => {
    const acc = accounts ?? [];
    const tx = (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as never[];
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const cutoff14 = new Date(today); cutoff14.setDate(cutoff14.getDate() - 14);
    const cutoff30 = new Date(today); cutoff30.setDate(cutoff30.getDate() - 30);

    const txsArr = tx as unknown as { occurred_at: string; type: string; status: string; category_id: string | null; amount: number; credit_card_id?: string | null; payment_method?: string | null; description?: string | null }[];
    const confirmed = txsArr.filter((t) => t.status === "confirmed" && t.type !== "transfer");
    const last14 = confirmed.filter((t) => t.occurred_at >= iso(cutoff14));
    const last30 = confirmed.filter((t) => t.occurred_at >= iso(cutoff30));
    const distinctDays14 = new Set(last14.map((t) => t.occurred_at)).size;
    const totalCash = computeTotalCash(acc as never, tx as never);
    const monthlyExpense = computeCategoryBreakdown(tx as never, [], currentMonthYM()).reduce((a, b) => a + b.amount, 0);

    const goalsPct = (goals ?? [])
      .filter((g) => g.status === "active")
      .map((g) => {
        const target = Number(g.target_amount) || 0;
        return target > 0 ? 0 : 0; // sem contribuições resolvidas aqui; neutral simples
      });

    const outstandingToday = (debts ?? []).filter((d) => d.status === "active").reduce((a, d) => a + Number(d.outstanding_balance || 0), 0);

    return computePulse({
      today: iso(today),
      txDaysLast14: distinctDays14,
      txLast30: last30.length,
      txLast30WithCategory: last30.filter((t) => !!t.category_id).length,
      pendingOpen: 0,
      pendingStale: 0,
      plannedMonth: 0,
      actualMonth: monthlyExpense,
      hasPlan: false,
      cardOutstanding: last30.filter((t) => t.type === "expense" && (t.credit_card_id || t.payment_method === "credit_card")).reduce((a, t) => a + Number(t.amount || 0), 0),
      cardTotalLimit: 0,
      paymentsOnTime90d: 0,
      paymentsTotal90d: 0,
      totalCash,
      avgMonthlyExpense: monthlyExpense,
      goalsProgressPct: goalsPct,
      outstandingToday,
      outstanding30dAgo: outstandingToday,
      recurringActive: 0,
      recurringWithDefinedAmount: 0,
      emotionalDaysLast14: 0,
      expensesLast30WithEmotion: 0,
      score7dAgo: null,
    });
  }, [accounts, txs, goals, debts]);

  const delta = 0;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <section className="rounded-3xl bg-gradient-to-br from-[#21164F] via-[#6D3BFF] to-[#8B5CF6] p-6 text-white shadow-brand">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider opacity-90">
          <Sparkles size={12} />
          Pulso Financeiro
        </div>
        <div className="flex items-center gap-1 text-[11px] opacity-90">
          <DeltaIcon size={12} />
          {delta === 0 ? "estável" : delta > 0 ? `+${delta}` : `${delta}`} na semana
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <p className="font-display text-5xl font-bold tabular-nums leading-none">{pulse.score}</p>
        <div className="pb-1">
          <p className="text-xs opacity-80">de 100</p>
          <p className="text-sm font-semibold">{pulse.band}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white" style={{ width: `${pulse.score}%` }} />
      </div>
      {pulse.state === "insufficient_data" ? (
        <p className="mt-3 text-xs opacity-90">
          Vamos entender seus hábitos primeiro. Anote alguns lançamentos e o Pulso começa a se calibrar.
        </p>
      ) : (
        <p className="mt-3 text-xs opacity-90">
          <span className="font-semibold">Próxima ação:</span> {pulse.next_action.label}. <span className="opacity-80">{pulse.next_action.hint}</span>
        </p>
      )}
    </section>
  );
}
