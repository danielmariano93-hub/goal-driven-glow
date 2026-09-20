import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { FinancialSnapshot } from "@/lib/engine/metrics";
import { todayISO } from "@/lib/engine/facts";
import type { DateRange } from "@/lib/engine/dailyAverage";
import { qk } from "@/lib/db/queryKeys";
import { READ_MODEL_CONTRACTS, assertSnapshotContract } from "@/lib/db/snapshotContract";

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

type ServedSnapshotPayload = {
  ok?: boolean;
  snapshot?: FinancialSnapshot;
  missing_sources?: string[];
  computed_at?: string;
  cache_hit?: boolean;
  freshness?: "fresh" | "stale_recomputing";
  contract_version?: string | null;
};

type SnapshotQueryResult = {
  snapshot: FinancialSnapshot;
  missing: SnapshotSource[];
  computedAt: string | null;
  fromCache: boolean;
  freshness: "fresh" | "stale_recomputing";
};

function normalizePayload(payload: ServedSnapshotPayload | null): SnapshotQueryResult | null {
  if (!payload?.ok || !payload.snapshot) return null;
  if (!assertSnapshotContract(payload, READ_MODEL_CONTRACTS.homeSnapshot, "home_snapshot").ok) return null;
  return {
    snapshot: payload.snapshot,
    missing: (payload.missing_sources ?? []) as SnapshotSource[],
    computedAt: payload.computed_at ?? null,
    fromCache: payload.cache_hit === true,
    freshness: payload.freshness ?? "fresh",
  };
}

async function invokeHomeSnapshot(
  period: DateRange,
  today: string,
  forceRefresh = false,
): Promise<SnapshotQueryResult> {
  const { data, error } = await supabase.functions.invoke("home-snapshot", {
    body: { start: period.start, end: period.end, today, force_refresh: forceRefresh },
  });
  if (error) throw error;
  const normalized = normalizePayload(data as ServedSnapshotPayload | null);
  if (!normalized) throw new Error("snapshot_unavailable");
  return normalized;
}

async function fetchServedSnapshot(period: DateRange): Promise<SnapshotQueryResult> {
  const today = todayISO();

  // Hot path: serve o read model materializado se ele estiver na MESMA versão
  // do ledger. Quando o Realtime avisa que o ledger mudou, não devolvemos um
  // número antigo só porque o worker de 1 minuto ainda não rodou: aguardamos o
  // recomputo canônico forçado. O React Query mantém o snapshot anterior na tela
  // durante o refetch, então não há skeleton nem salto intermediário.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any).call(supabase, "my_financial_home_snapshot", {
    _start: period.start,
    _end: period.end,
    _today: today,
  });
  if (!error) {
    const normalized = normalizePayload(data as ServedSnapshotPayload | null);
    if (normalized) {
      if (normalized.freshness === "stale_recomputing") {
        return invokeHomeSnapshot(period, today, true);
      }
      return normalized;
    }
  }

  return invokeHomeSnapshot(period, today, true);
}

/**
 * Fonte única de verdade para Home, Metas e Assessor.
 *
 * Qualquer escrita financeira incrementa `financial_ledger_versions`; o canal
 * Realtime invalida esta query e o próximo read é read-after-write: se o read
 * model estiver numa versão antiga, a Edge Function recompõe todos os
 * indicadores do mesmo snapshot antes de publicar a nova versão na UI.
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
  freshness: "fresh" | "stale_recomputing" | "unavailable";
  refetch: () => Promise<void>;
  refetchCritical: () => Promise<void>;
  refetchMissing: () => Promise<void>;
  refetchAll: () => Promise<void>;
} {
  const { user } = useAuth();

  const serverQuery = useQuery({
    queryKey: [...qk.homeSnapshot, user?.id, period.start, period.end, todayISO()],
    enabled: !!user,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchInterval: (query) => query.state.data?.freshness === "stale_recomputing" ? 2000 : false,
    queryFn: () => fetchServedSnapshot(period),
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
    freshness: criticalError ? "unavailable" : (serverQuery.data?.freshness ?? "fresh"),
    refetch: refetchAll,
    refetchCritical: refetchAll,
    refetchMissing: refetchAll,
    refetchAll,
  };
}
