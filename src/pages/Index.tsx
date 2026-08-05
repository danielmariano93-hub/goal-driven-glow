import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccounts } from "@/lib/db/finance";
import { useAuth } from "@/context/AuthContext";
import { processCategoryQueue } from "@/lib/categoryEngine";
import { HomeHeader } from "@/components/home/HomeHeader";
import { PeriodPicker } from "@/components/home/PeriodPicker";
import { HeroDisponivelCard } from "@/components/home/HeroDisponivelCard";
import { RitmoUnificadoCard } from "@/components/home/RitmoUnificadoCard";
import { QuickActions } from "@/components/home/QuickActions";
import { NinoGuidanceCard } from "@/components/home/NinoGuidanceCard";
import { Button } from "@/components/ui/button";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";

import { getPeriod, resolvePeriodRange, setPeriod as savePeriod, type PeriodKind as Period } from "@/lib/ui/periodStore";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";
import { toHomeDiagnosisView, useNinoDiagnosisContext } from "@/lib/nino/diagnosis";

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

  useEffect(() => {
    if (!user?.id || categorizationStarted.current) return;
    categorizationStarted.current = true;
    void (async () => {
      const result = await processCategoryQueue().catch((error) => {
        categorizationStarted.current = false;
        console.warn("[category-engine-bootstrap]", error);
        return null;
      });
      const updated = Number(result?.decisions.filter((item) => item.action === "auto_apply").length ?? 0);
      if (updated > 0) {
        await invalidateFinancialQueries(queryClient);
        toast.success(`${updated} lançamento${updated === 1 ? " foi organizado" : "s foram organizados"} com segurança.`);
      }
    })();
  }, [queryClient, user?.id]);

  const periodRange = useMemo(() => {
    return resolvePeriodRange({ period, customStart, customEnd });
  }, [period, customStart, customEnd]);

  const { data: snap, loading, error: snapshotError, refetch: refetchSnapshot } = useFinancialSnapshot(periodRange);
  const diagnosis = useNinoDiagnosisContext();
  const homeDiagnosis = useMemo(() => diagnosis.data ? toHomeDiagnosisView(diagnosis.data) : null, [diagnosis.data]);

  const hasAccount = (accounts ?? []).length > 0;

  const heroLabel = "Disponível hoje";

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
        confirmedFutureInflows={snap?.projection.confirmedFutureInflows ?? 0}
        upcomingCommitments={snap?.projection.upcomingConfirmedCommitments ?? 0}
        cardDueThisMonth={snap?.projection.cardDueThisMonth ?? 0}
        projectedEndBalance={snap?.projection.projectedEndBalance ?? 0}
        loading={loading}
        hasAccount={hasAccount}
      />

      {snapshotError ? <section aria-label="Erro no resumo financeiro" className="rounded-2xl border border-border bg-card p-4"><p className="text-sm font-semibold text-foreground">Não foi possível atualizar todo o resumo financeiro.</p><Button type="button" variant="link" onClick={() => void refetchSnapshot()} className="mt-1 h-10 px-0">Tentar novamente</Button></section> : null}

      <RitmoUnificadoCard
        rhythm={snap?.rhythm ?? null}
        projection={snap?.projection ?? null}
        loading={loading}
      />

      <NinoGuidanceCard
        diagnosis={homeDiagnosis}
        projection={snap?.projection ?? null}
        loading={diagnosis.isLoading}
        error={diagnosis.error}
        retrying={diagnosis.isFetching}
        onRetry={() => void diagnosis.refetch()}
      />

      <QuickActions />

      <EmotionalCheckinCard />
    </div>
  );
}
