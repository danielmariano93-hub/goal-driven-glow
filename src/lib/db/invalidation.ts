import type { QueryClient } from "@tanstack/react-query";
import { FINANCIAL_QUERY_KEYS, INVALIDATION_SCOPES, type InvalidationScope } from "./queryKeys";
import { supabase } from "@/integrations/supabase/client";

/**
 * Porta de entrada ÚNICA para invalidar o estado financeiro do usuário.
 * Nenhuma tela ou hook deve chamar `qc.invalidateQueries` para domínio
 * financeiro: a lista de chaves vive em `queryKeys.ts`.
 *
 * `scope` limita a cascata ao domínio realmente afetado (`invalidation_scope.v1`);
 * sem escopo, o comportamento antigo (tudo) é preservado.
 *
 * Além do cache do React Query, marca os snapshots de acompanhamento
 * (`financial_performance_snapshots`) como sujos — assim o próximo acesso
 * recalcula os highlights com a verdade financeira nova, e só nesse caso.
 *
 * Retorna uma Promise resolvida quando todas as invalidações terminaram, de
 * modo que a UI possa aguardar (read-after-write) antes de renderizar números.
 */
let bulkDepth = 0;
let bulkPending = false;

/**
 * Rodadas em lote (categorização automática, importação) escrevem dezenas de
 * lançamentos em sequência. Sem supressão, cada escrita bumpava a versão do
 * ledger e recalculava o snapshot da Home — N recomputações para um resultado
 * só. Aqui a invalidação é acumulada e disparada UMA vez no fim.
 */
export async function withBulkFinancialWrites<T>(
  qc: QueryClient,
  run: () => Promise<T>,
): Promise<T> {
  bulkDepth += 1;
  try {
    return await run();
  } finally {
    bulkDepth -= 1;
    if (bulkDepth === 0 && bulkPending) {
      bulkPending = false;
      await invalidateFinancialQueries(qc);
    }
  }
}

export function invalidateFinancialQueries(
  qc: QueryClient,
  scope: InvalidationScope = "all",
): Promise<void> {
  if (bulkDepth > 0) {
    // Durante o lote, guarda a intenção: o estado é atualizado no fim, uma vez.
    bulkPending = true;
    return Promise.resolve();
  }
  void markPerformanceSnapshotsDirty();
  const keys = scope === "all"
    ? FINANCIAL_QUERY_KEYS
    : INVALIDATION_SCOPES[scope];
  return Promise.all(
    keys.map((key) =>
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
