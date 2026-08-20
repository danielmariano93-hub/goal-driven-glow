import type { QueryClient } from "@tanstack/react-query";
import { FINANCIAL_QUERY_KEYS } from "./queryKeys";
import { supabase } from "@/integrations/supabase/client";

/**
 * Porta de entrada ÚNICA para invalidar o estado financeiro do usuário.
 * Nenhuma tela ou hook deve chamar `qc.invalidateQueries` para domínio
 * financeiro: a lista de chaves vive em `queryKeys.ts`.
 *
 * Além do cache do React Query, marca os snapshots de acompanhamento
 * (`financial_performance_snapshots`) como sujos — assim o próximo acesso
 * recalcula os highlights com a verdade financeira nova, e só nesse caso.
 *
 * Retorna uma Promise resolvida quando todas as invalidações terminaram, de
 * modo que a UI possa aguardar (read-after-write) antes de renderizar números.
 */
export function invalidateFinancialQueries(qc: QueryClient): Promise<void> {
  void markPerformanceSnapshotsDirty();
  return Promise.all(
    FINANCIAL_QUERY_KEYS.map((key) =>
      qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] }),
    ),
  ).then(() => undefined);
}

async function markPerformanceSnapshotsDirty(): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase
      .from("financial_performance_snapshots")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("invalidated_at", null);
  } catch {
    // Invalidação é best-effort: o snapshot também expira por `valid_until`.
  }
}
