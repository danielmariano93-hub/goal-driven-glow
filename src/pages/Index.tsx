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
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { PrevisaoFechamentoCard } from "@/components/home/PrevisaoFechamentoCard";
import { ProximosCompromissosCard } from "@/components/home/ProximosCompromissosCard";
import { AcompanhamentoCard } from "@/components/home/AcompanhamentoCard";
import { useFinancialPerformance } from "@/lib/hooks/useFinancialPerformance";

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

  const snapshot = useFinancialSnapshot(periodRange);
  const { data: snap, loading, criticalError: snapshotError, completeness, availability } = snapshot;
  const diagnosis = useNinoDiagnosisContext();
  const homeDiagnosis = useMemo(() => diagnosis.data ? toHomeDiagnosisView(diagnosis.data) : null, [diagnosis.data]);

  const hasAccount = (accounts ?? []).length > 0;

  const heroLabel = "Disponível hoje";

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-16 [scroll-padding-bottom:8rem]" data-surface="home">
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
        confirmedFutureInflows={availability.projection === "available" ? snap?.projection.confirmedFutureInflows ?? 0 : 0}
        estimatedFixedInflows={availability.projection === "available" ? snap?.projection.estimatedFixedInflows ?? 0 : 0}
        estimatedIncomeEvents={availability.projection === "available" ? snap?.projection.estimatedIncomeEvents ?? [] : []}
        upcomingCommitments={availability.projection === "available" ? snap?.projection.upcomingConfirmedCommitments ?? 0 : 0}
        cardDueThisMonth={availability.cardExposure === "available" ? snap?.projection.cardDueThisMonth ?? 0 : 0}
        projectedEndBalance={availability.projection === "available" ? snap?.projection.projectedEndBalance ?? 0 : 0}
        freeAfterKnownCommitments={availability.projection === "available" ? snap?.projection.freeAfterKnownCommitments ?? null : null}
        loading={loading}
        hasAccount={hasAccount}
        error={snapshotError}
        partial={completeness === "partial"}
        onRetry={() => void (snapshotError ? snapshot.refetchCritical() : snapshot.refetchMissing())}
      />

      <QuickActions />

      <NinoGuidanceCard
        diagnosis={homeDiagnosis}
        context={diagnosis.data ?? null}
        projection={snap?.projection ?? null}
        loading={diagnosis.isLoading}
        error={diagnosis.error}
        retrying={diagnosis.isFetching}
        onRetry={() => void diagnosis.refetch()}
        projectionAvailability={availability.projection}
      />

      <RitmoUnificadoCard
          rhythm={snap?.rhythm ?? null}
          projection={snap?.projection ?? null}
          loading={loading}
          partial={completeness === "partial"}
          error={availability.rhythm === "unavailable" ? snapshotError : null}
          onRetry={() => void snapshot.refetchCritical()}
      />
      <PrevisaoFechamentoCard
          projection={snap?.projection ?? null}
          availability={availability.projection}
          loading={loading}
      />

      <ProximosCompromissosCard
        commitments={snap?.commitmentAgenda.items ?? []}
        availability={availability.projection}
        loading={loading}
      />

      <EmotionalCheckinCard />
    </div>
  );
}
