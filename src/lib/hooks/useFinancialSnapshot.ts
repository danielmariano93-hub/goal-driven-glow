import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { FinancialSnapshot } from "@/lib/engine/metrics";
import { todayISO } from "@/lib/engine/facts";
import type { DateRange } from "@/lib/engine/dailyAverage";
import { useLedgerVersion } from "@/lib/db/derivedViews";
import { qk } from "@/lib/db/queryKeys";

export type SnapshotSource = "accounts" | "accountSnapshots" | "transactions" | "recurringRules" | "financialSettings" | "creditCards" | "cardStatements" | "cardInstallments" | "categories" | "investments" | "investmentMovements" | "debts" | "categoryGoals" | "goals" | "goalContributions";
export type SnapshotErrorKind = "permission" | "schema" | "network" | "timeout" | "unknown";
export type SnapshotSourceError = { source: SnapshotSource; critical: boolean; kind: SnapshotErrorKind };
export type SnapshotAvailability = {
  balance: "available" | "unavailable";
  rhythm: "available" | "unavailable";
  rhythmComparison: "available" | "unavailable";
  projection: "available" | "partial" | "unavailable";
  cardExposure: "available" | "unavailable";
  netWorth: "available" | "partial" | "unavailable";
  goals: "available" | "unavailable";
};

/**
 * Fonte única de verdade para a Home / Metas / Assessor — SERVIDA.
 *
 * O dispositivo não baixa mais o ledger para calcular nada: a Edge Function
 * `home-snapshot` roda o motor canônico (`finance-core`, espelho de
 * `src/lib/engine`) perto do banco, memoiza por versão do ledger e devolve o
 * snapshot pronto. Se o servidor falhar, a Home mostra erro honesto com
 * "tentar de novo" — nunca um recálculo local que puxa o histórico inteiro
 * para o celular.
 */
export function useFinancialSnapshot(period: DateRange): {
  data: FinancialSnapshot | null;
  loading: boolean;
  error: unknown;
  partial: boolean;
  criticalError: unknown;
  partialErrors: SnapshotSourceError[];
  completeness: "complete" | "partial" | "unavailable";
  missingSources: SnapshotSource[];
  availability: SnapshotAvailability;
  computedAt: string | null;
  fromCache: boolean;
  refetch: () => Promise<void>;
  refetchCritical: () => Promise<void>;
  refetchMissing: () => Promise<void>;
  refetchAll: () => Promise<void>;
} {
  const { user } = useAuth();
  const ledgerVersion = useLedgerVersion();

  const serverQuery = useQuery({
    // A versão do ledger entra na chave: qualquer escrita financeira invalida
    // a leitura derivada sem varredura de cache.
    queryKey: [...qk.homeSnapshot, user?.id, period.start, period.end, todayISO(), ledgerVersion.data ?? 0],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("home-snapshot", {
        body: { start: period.start, end: period.end, today: todayISO() },
      });
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        snapshot?: FinancialSnapshot;
        missing_sources?: string[];
        computed_at?: string;
        cache_hit?: boolean;
      } | null;
      if (!payload?.ok || !payload.snapshot) throw new Error("snapshot_unavailable");
      return {
        snapshot: payload.snapshot,
        missing: (payload.missing_sources ?? []) as SnapshotSource[],
        computedAt: payload.computed_at ?? null,
        fromCache: payload.cache_hit === true,
      };
    },
  });

  const snapshot = serverQuery.data?.snapshot ?? null;
  const criticalError = serverQuery.isError ? serverQuery.error : null;
  const missingSources = serverQuery.data?.missing ?? [];
  const partialErrors: SnapshotSourceError[] = missingSources.map((source) => ({
    source,
    critical: false,
    kind: "unknown" as SnapshotErrorKind,
  }));
  const partial = !criticalError && partialErrors.length > 0;
  const completeness = criticalError ? "unavailable" as const : partial ? "partial" as const : "complete" as const;

  const failed = (source: SnapshotSource) => missingSources.includes(source);
  const availability: SnapshotAvailability = {
    balance: criticalError ? "unavailable" : "available",
    rhythm: criticalError ? "unavailable" : "available",
    rhythmComparison: criticalError ? "unavailable" : "available",
    projection: criticalError
      ? "unavailable"
      : failed("recurringRules") || failed("financialSettings") || failed("creditCards") || failed("cardStatements") || failed("cardInstallments")
        ? "partial"
        : "available",
    cardExposure: failed("creditCards") || failed("cardStatements") || failed("cardInstallments") ? "unavailable" : "available",
    netWorth: criticalError ? "unavailable" : failed("investments") || failed("investmentMovements") || failed("debts") ? "partial" : "available",
    goals: failed("goals") || failed("goalContributions") || failed("categoryGoals") ? "unavailable" : "available",
  };

  const refetchAll = async () => { await serverQuery.refetch(); };

  return {
    data: snapshot,
    loading: serverQuery.isLoading,
    error: criticalError,
    partial,
    criticalError,
    partialErrors,
    completeness,
    missingSources,
    availability,
    computedAt: serverQuery.data?.computedAt ?? null,
    fromCache: serverQuery.data?.fromCache ?? false,
    refetch: refetchAll,
    refetchCritical: refetchAll,
    refetchMissing: refetchAll,
    refetchAll,
  };
}
