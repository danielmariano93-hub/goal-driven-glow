import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccounts, useAllTransactions, useGoals } from "@/lib/db/finance";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { HomeHeader } from "@/components/home/HomeHeader";
import { PeriodPicker } from "@/components/home/PeriodPicker";
import { HeroDisponivelCard } from "@/components/home/HeroDisponivelCard";
import { RitmoUnificadoCard } from "@/components/home/RitmoUnificadoCard";
import { QuickActions } from "@/components/home/QuickActions";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { PrevisaoFechamentoCard } from "@/components/home/PrevisaoFechamentoCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";
import { SharedGoalHighlight } from "@/components/home/SharedGoalHighlight";

import { getPeriod, setPeriod as savePeriod, type PeriodKind as Period } from "@/lib/ui/periodStore";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";

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

  const { data: accounts } = useAccounts();
  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();

  useEffect(() => {
    if (!user?.id || categorizationStarted.current) return;
    categorizationStarted.current = true;
    void (async () => {
      const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: { updated?: number } | null; error: { message: string } | null }>)("apply_safe_category_suggestions");
      if (error) {
        categorizationStarted.current = false;
        console.warn("[safe-category-bootstrap]", error.message);
        return;
      }
      const updated = Number(data?.updated ?? 0);
      if (updated > 0) {
        await invalidateFinancialQueries(queryClient);
        toast.success(`${updated} lançamento${updated === 1 ? " foi organizado" : "s foram organizados"} com segurança.`);
      }
    })();
  }, [queryClient, user?.id]);

  const periodRange = useMemo(() => {
    const end = period === "custom" ? customEnd : isoDate(new Date());
    const startDate = new Date();
    if (period === "month") startDate.setDate(1);
    if (period === "30d") startDate.setDate(startDate.getDate() - 29);
    if (period === "90d") startDate.setDate(startDate.getDate() - 89);
    const start = period === "custom" ? customStart : isoDate(startDate);
    return { start, end };
  }, [period, customStart, customEnd]);

  const { data: snap, loading } = useFinancialSnapshot(periodRange);

  const hasAccount = (accounts ?? []).length > 0;
  const hasTransaction = (txs ?? []).length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;

  const heroLabel = "Disponível hoje";
  const periodLabelShort = `${periodRange.start.split("-").reverse().slice(0, 2).join("/")} – ${periodRange.end.split("-").reverse().slice(0, 2).join("/")}`;

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
        rangeStart={periodRange.start}
        rangeEnd={periodRange.end}
      />

      <HeroDisponivelCard
        available={snap?.availableToday ?? 0}
        periodLabel={heroLabel}
        assets={snap?.netWorth.assets ?? 0}
        netWorth={snap?.netWorth.net ?? 0}
        cash={snap?.netWorth.cash ?? 0}
        accountOverdraft={snap?.netWorth.accountOverdraft ?? 0}
        cardsOwed={snap?.netWorth.cardsOwed ?? 0}
        invested={snap?.netWorth.invested ?? 0}
        otherDebts={snap?.netWorth.otherDebts ?? 0}
        cardFutureInstallments={snap?.cardFutureInstallments ?? 0}
        cardDebtIsEstimated={snap?.cardDebtIsEstimated ?? false}
        loading={loading}
      />

      <RitmoUnificadoCard
        rhythm={snap?.rhythm ?? null}
        card={{
          value: snap?.currentCardSpend ?? 0,
          trend: (snap?.cardSpendVariationPct ?? 0) > 0 ? "up" : (snap?.cardSpendVariationPct ?? 0) < 0 ? "down" : "stable",
          deltaPct: snap?.cardSpendVariationPct ?? null,
        }}
        loading={loading}
      />


      <AssistantTipCard />

      <QuickActions />

      <SharedGoalHighlight />


      {loading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isFresh ? (
        <ComecePorAqui hasAccount={hasAccount} hasTransaction={hasTransaction} hasGoal={hasGoal} />
      ) : (
        <PrevisaoFechamentoCard
          projectedMonthEndAvailable={snap?.projectedMonthEndAvailable ?? 0}
          monthToDateAverageConsumption={snap?.monthToDateAverageConsumption ?? 0}
          daysRemainingInMonth={snap?.daysRemainingInMonth ?? 0}
          projectedRemainingConsumption={snap?.projectedRemainingConsumption ?? 0}
        />
      )}

      <EmotionalCheckinCard />
    </div>
  );
}
