// perf_derived.v1 — leitura derivada servida
// ==========================================
// Estas funções não calculam verdade financeira: elas leem o resultado do
// motor canônico executado no servidor e a VERSÃO DO LEDGER do usuário, que
// serve como chave de cache. Assim, reabrir uma tela não recalcula nada
// enquanto nada financeiro mudou — e qualquer escrita invalida na hora.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { PerformanceResult } from "@/lib/engine/financialPerformance";
import type { ComparisonMode } from "@/lib/engine/financialComparison";

/** Versão atual do ledger do usuário (contador incrementado por trigger). */
export function useLedgerVersion() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ledger-version", user?.id],
    enabled: !!user,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finance_ledger_version" as never);
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}

export type DerivedPerformance = {
  result: PerformanceResult;
  ledgerVersion: number;
  computedAt: string | null;
  fromCache: boolean;
};

/** Acompanhamento do período calculado no servidor (payload compacto). */
export async function fetchDerivedPerformance(params: {
  asOf: string;
  mode: ComparisonMode;
  materialityFloor?: number;
}): Promise<DerivedPerformance> {
  const { data, error } = await supabase.functions.invoke("finance-derived", {
    body: {
      view: "performance",
      as_of: params.asOf,
      mode: params.mode,
      materiality_floor: params.materialityFloor,
    },
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    result?: PerformanceResult;
    ledger_version?: number;
    computed_at?: string;
    cache_hit?: boolean;
    message?: string;
  } | null;
  if (!payload?.ok || !payload.result) {
    throw new Error(payload?.message ?? "derived_unavailable");
  }
  return {
    result: payload.result,
    ledgerVersion: Number(payload.ledger_version ?? 0),
    computedAt: payload.computed_at ?? null,
    fromCache: payload.cache_hit === true,
  };
}
