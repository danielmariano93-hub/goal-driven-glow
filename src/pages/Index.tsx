import { useEffect, useMemo, useRef, useState } from "react";
import { useAccounts } from "@/lib/db/finance";
import { HomeHeader } from "@/components/home/HomeHeader";
import { PeriodPicker } from "@/components/home/PeriodPicker";
import { HeroDisponivelCard } from "@/components/home/HeroDisponivelCard";
import { RitmoUnificadoCard } from "@/components/home/RitmoUnificadoCard";
import { QuickActions } from "@/components/home/QuickActions";
import { NinoGuidanceCard } from "@/components/home/NinoGuidanceCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { PrevisaoFechamentoCard } from "@/components/home/PrevisaoFechamentoCard";
import { ProximosCompromissosCard } from "@/components/home/ProximosCompromissosCard";
import { ResumoPeriodoCard } from "@/components/home/ResumoPeriodoCard";
import { HeatmapSemanalCard } from "@/components/home/HeatmapSemanalCard";
import { useCategoryWeekdayHeatmap } from "@/lib/hooks/useCategoryWeekdayHeatmap";


import { formatPeriodLabel, getPeriod, resolvePeriodRange, setPeriod as savePeriod, type PeriodKind as Period } from "@/lib/ui/periodStore";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { toHomeDiagnosisView, useNinoHomeContext } from "@/lib/nino/diagnosis";

export default function Index() {
  const initial = useRef(getPeriod()).current;
  const [period, setPeriod] = useState<Period>(initial.period);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  useEffect(() => {
    savePeriod({ period, customStart, customEnd });
  }, [period, customStart, customEnd]);

  const { data: accounts } = useAccounts();

  const periodRange = useMemo(() => {
    return resolvePeriodRange({ period, customStart, customEnd });
  }, [period, customStart, customEnd]);

  const snapshot = useFinancialSnapshot(periodRange);
  const { data: snap, loading, criticalError: snapshotError, completeness, availability } = snapshot;
  const diagnosis = useNinoHomeContext();
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

      {snapshot.freshness === "stale_recomputing" ? (
        <p className="-mt-2 text-[11px] font-medium text-muted-foreground" aria-live="polite">Atualizando seus números recentes…</p>
      ) : null}

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


      <ResumoPeriodoCard
        performance={snap?.periodPerformance ?? null}
        periodStart={periodRange.start}
        periodEnd={periodRange.end}
        loading={loading}
      />

      <RitmoUnificadoCard
          periodLabel={formatPeriodLabel(periodRange.start, periodRange.end)}
          rhythm={snap?.rhythm ?? null}
          projection={snap?.projection ?? null}
          loading={loading}
          partial={completeness === "partial"}
          error={availability.rhythm === "unavailable" ? snapshotError : null}
          onRetry={() => void snapshot.refetchCritical()}
      />
      <HeatmapSemanalCard data={heatmap.data} loading={heatmap.isLoading} />

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
