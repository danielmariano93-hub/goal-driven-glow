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
    // Uma porta só: a MESMA função que os gatilhos do banco chamam quando a
    // escrita vem do WhatsApp, do FastLog, de importação ou de rotina.
    await supabase.rpc("financial_truth_changed", {
      _user_id: userId,
      _reason: "client_mutation",
      _domains: ["client"],
    });
  } catch {
    // Invalidação é best-effort: o snapshot também expira por `valid_until`.
  }
}
