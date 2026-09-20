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

async function fetchServedSnapshot(period: DateRange): Promise<SnapshotQueryResult> {
  const today = todayISO();

  // ÚNICA porta de leitura da Home: a Edge Function canônica. O cliente não lê
  // mais o mesmo snapshot por um RPC SQL paralelo; isso elimina competição entre
  // dois caches/read models com regras de frescor diferentes.
  // `force_refresh` impede a Edge de devolver um materializado antigo; o cache
  // derivado da própria Edge continua O(1) quando ledger + deployment não mudam.
  const { data, error } = await supabase.functions.invoke("home-snapshot", {
    body: { start: period.start, end: period.end, today, force_refresh: true },
  });
  if (error) throw error;

  const normalized = normalizePayload(data as ServedSnapshotPayload | null);
  if (!normalized) throw new Error("snapshot_unavailable");
  return normalized;
}

/**
 * Fonte única de verdade para Home, Metas e Assessor.
 *
 * Qualquer escrita financeira incrementa `financial_ledger_versions`; o canal
 * Realtime invalida esta query. O próximo read passa exclusivamente pela Edge
 * canônica, que só reaproveita cache da MESMA versão do ledger e do MESMO deploy.
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
    queryFn: () => fetchServedSnapshot(period),
    // Mobile Safari pode suspender WebSocket em background. Ao voltar para o app
    // ou recuperar a rede, sempre confirma o snapshot vigente no servidor.
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: (query) => query.state.data?.freshness === "stale_recomputing" ? 2000 : false,
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
