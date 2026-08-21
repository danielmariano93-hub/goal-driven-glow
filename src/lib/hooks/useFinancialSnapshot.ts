import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { FinancialSnapshot } from "@/lib/engine/metrics";
import { todayISO } from "@/lib/engine/facts";
import type { DateRange } from "@/lib/engine/dailyAverage";
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

type ServedSnapshotPayload = {
  ok?: boolean;
  snapshot?: FinancialSnapshot;
  missing_sources?: string[];
  computed_at?: string;
  cache_hit?: boolean;
  freshness?: "fresh" | "stale_recomputing";
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
  return {
    snapshot: payload.snapshot,
    missing: (payload.missing_sources ?? []) as SnapshotSource[],
    computedAt: payload.computed_at ?? null,
    fromCache: payload.cache_hit === true,
    freshness: payload.freshness ?? "fresh",
  };
}

async function invokeHomeSnapshot(period: DateRange, today: string): Promise<SnapshotQueryResult> {
  const { data, error } = await supabase.functions.invoke("home-snapshot", {
    body: { start: period.start, end: period.end, today },
  });
  if (error) throw error;
  const normalized = normalizePayload(data as ServedSnapshotPayload | null);
  if (!normalized) throw new Error("snapshot_unavailable");
  return normalized;
}

async function fetchServedSnapshot(period: DateRange): Promise<SnapshotQueryResult> {
  const today = todayISO();

  // Hot path SQL: MTD vem do read model materializado; D3/D7/custom quente vem
  // do cache derivado versionado. Só um cache miss/stale sem read model cai na
  // Edge Function canônica para recomputação.
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
        // Não bloqueia a renderização: serve o último snapshot e acelera a
        // recomputação que já é protegida por fila/anti-stampede no backend.
        void supabase.functions.invoke("home-snapshot", {
          body: { start: period.start, end: period.end, today },
        }).catch(() => undefined);
      }
      return normalized;
    }
  }

  return invokeHomeSnapshot(period, today);
}

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
  freshness: "fresh" | "stale_recomputing" | "unavailable";
  refetch: () => Promise<void>;
  refetchCritical: () => Promise<void>;
  refetchMissing: () => Promise<void>;
  refetchAll: () => Promise<void>;
} {
  const { user } = useAuth();

  const serverQuery = useQuery({
    // A própria resposta traz a versão do ledger. A invalidação explícita + realtime
    // derruba esta query quando existe escrita; não precisamos pagar um RTT antes dela.
    queryKey: [...qk.homeSnapshot, user?.id, period.start, period.end, todayISO()],
    enabled: !!user,

    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchInterval: (query) => query.state.data?.freshness === "stale_recomputing" ? 5000 : false,
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
