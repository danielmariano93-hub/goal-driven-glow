import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAccounts,
  useAccountBalanceSnapshots,
  useAllTransactions,
  useGoals,
  useInvestments,
  useDebts,
} from "@/lib/db/finance";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  computeNetWorth,
  round2,
  computeAccountStatementTotals,
  type RecurringRow,
} from "@/lib/engine/facts";
import {
  computeDailyAverageComparison,
  computeCardSpendingComparison,
} from "@/lib/engine/dailyAverage";
import { HomeHeader } from "@/components/home/HomeHeader";
import { PeriodPicker } from "@/components/home/PeriodPicker";
import { HeroDisponivelCard } from "@/components/home/HeroDisponivelCard";
import { RitmoCard } from "@/components/home/RitmoCard";
import { QuickActions } from "@/components/home/QuickActions";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { PulseHero } from "@/components/home/PulseHero";
import { PrevisaoFechamentoCard } from "@/components/home/PrevisaoFechamentoCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";
import { getPeriod, setPeriod as savePeriod, type PeriodKind as Period } from "@/lib/ui/periodStore";

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Index() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const categorizationStarted = useRef(false);
  const initial = useRef(getPeriod()).current;
  const [period, setPeriod] = useState<Period>(initial.period);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  useEffect(() => {
    savePeriod({ period, customStart, customEnd });
  }, [period, customStart, customEnd]);

  const { data: accounts, isLoading: la } = useAccounts();
  const { data: balanceSnapshots, isLoading: lbs } = useAccountBalanceSnapshots();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();

  const { data: recurring } = useQuery({
    queryKey: ["recurring_rules_active", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_rules" as never)
        .select("id,name,kind,amount,frequency,next_due_date,status");
      if (error) throw error;
      return (
        (data as Array<{ id: string; name: string; kind: string; amount: number; frequency: string; next_due_date: string; status: string }> | null) ??
        []
      );
    },
  });

  useEffect(() => {
    if (!user?.id || categorizationStarted.current) return;
    categorizationStarted.current = true;
    void (async () => {
      const { data, error } = await (supabase.rpc as any)("apply_safe_category_suggestions");
      if (error) {
        categorizationStarted.current = false;
        console.warn("[safe-category-bootstrap]", error.message);
        return;
      }
      const updated = Number((data as { updated?: number } | null)?.updated ?? 0);
      if (updated > 0) {
        await queryClient.invalidateQueries({ queryKey: ["transactions"] });
        await queryClient.invalidateQueries({ queryKey: ["assistant-tip"] });
        await queryClient.invalidateQueries({ queryKey: ["pulse"] });
        toast.success(`${updated} lançamento${updated === 1 ? " foi organizado" : "s foram organizados"} com segurança.`);
      }
    })();
  }, [queryClient, user?.id]);

  const loading = la || lt || lbs;
  const acc = accounts ?? [];
  const tx = txs ?? [];
  const numericTxs = useMemo(() => tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never, [tx]);

  const recurringRows: RecurringRow[] = useMemo(() => {
    return (recurring ?? [])
      .filter((r) => r.status === "active")
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: (r.kind === "income" ? "income" : "expense") as "income" | "expense",
        amount: Number(r.amount || 0),
        frequency: (["daily", "weekly", "monthly", "yearly"].includes(r.frequency) ? r.frequency : "monthly") as RecurringRow["frequency"],
        next_due_date: r.next_due_date,
        active: true,
      }));
  }, [recurring]);

  const nw = computeNetWorth(
    acc.map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
    numericTxs,
    (investments ?? []).map((i) => ({ id: i.id, name: i.name, invested_amount: Number(i.invested_amount), current_value: Number(i.current_value), goal_id: i.goal_id })),
    (debts ?? []).map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance), original_amount: Number(d.original_amount), status: d.status })),
    (balanceSnapshots ?? []).map((s) => ({ ...s, balance: Number(s.balance) })),
  );

  const periodSummary = useMemo(() => {
    const end = period === "custom" ? customEnd : isoDate(new Date());
    const startDate = new Date();
    if (period === "month") startDate.setDate(1);
    if (period === "30d") startDate.setDate(startDate.getDate() - 29);
    if (period === "90d") startDate.setDate(startDate.getDate() - 89);
    const start = period === "custom" ? customStart : isoDate(startDate);
    const totals = computeAccountStatementTotals(numericTxs, { start, end });
    return {
      income: round2(totals.accountIn),
      expense: round2(totals.accountOut),
      start,
      end,
    };
  }, [numericTxs, period, customStart, customEnd]);

  const periodLabel = period === "month" ? "este mês" : period === "custom" ? "no período" : period === "30d" ? "nos últimos 30 dias" : "nos últimos 90 dias";
  const heroLabel = period === "month" ? "Disponível até o fim do mês" : "Disponível até o fim do período";

  const numericAccounts = useMemo(
    () => acc.map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
    [acc],
  );
  const numericSnapshots = useMemo(
    () => (balanceSnapshots ?? []).map((s) => ({ ...s, balance: Number(s.balance) })) as never,
    [balanceSnapshots],
  );

  const daily = useMemo(
    () => computeDailyAverageComparison(numericTxs, { start: periodSummary.start, end: periodSummary.end }),
    [numericTxs, periodSummary.start, periodSummary.end],
  );
  const card = useMemo(
    () => computeCardSpendingComparison(numericTxs, { start: periodSummary.start, end: periodSummary.end }),
    [numericTxs, periodSummary.start, periodSummary.end],
  );

  const hasAccount = acc.length > 0;
  const hasTransaction = tx.length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;

  return (
    <div className="mx-auto w-full max-w-md space-y-5 md:max-w-2xl" data-surface="home">
      <HomeHeader />

      <PeriodPicker
        period={period}
        customStart={customStart}
        customEnd={customEnd}
        setPeriod={setPeriod}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
        rangeStart={periodSummary.start}
        rangeEnd={periodSummary.end}
      />

      <HeroDisponivelCard
        accounts={numericAccounts}
        txs={numericTxs}
        recurring={recurringRows}
        snapshots={numericSnapshots}
        endDate={periodSummary.end}
        periodLabel={heroLabel}
        netWorth={nw.net}
        cash={nw.cash}
        cardsOwed={nw.cardsOwed}
        invested={nw.invested}
        otherDebts={nw.otherDebts}
        loading={loading}
      />

      <RitmoCard
        daily={{ value: daily.current.avg, trend: daily.trend, deltaPct: daily.deltaPct }}
        card={{ value: card.current, trend: card.trend, deltaPct: card.deltaPct }}
        loading={loading}
      />

      <AssistantTipCard />

      <QuickActions />

      <PulseHero />

      {loading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isFresh ? (
        <ComecePorAqui hasAccount={hasAccount} hasTransaction={hasTransaction} hasGoal={hasGoal} />
      ) : (
        <PrevisaoFechamentoCard
          income={periodSummary.income}
          expense={periodSummary.expense}
          closing={nw.cash}
          periodLabel={periodLabel}
        />
      )}

      <EmotionalCheckinCard />
    </div>
  );
}
