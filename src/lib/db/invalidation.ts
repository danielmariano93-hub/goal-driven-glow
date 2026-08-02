import type { QueryClient } from "@tanstack/react-query";
import { FINANCIAL_QUERY_KEYS } from "./queryKeys";

/**
 * Porta de entrada ÚNICA para invalidar o estado financeiro do usuário.
 * Nenhuma tela ou hook deve chamar `qc.invalidateQueries` para domínio
 * financeiro: a lista de chaves vive em `queryKeys.ts`.
 *
 * Retorna uma Promise resolvida quando todas as invalidações terminaram, de
 * modo que a UI possa aguardar (read-after-write) antes de renderizar números.
 */
export function invalidateFinancialQueries(qc: QueryClient): Promise<void> {
  return Promise.all(
    FINANCIAL_QUERY_KEYS.map((key) =>
      qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] }),
    ),
  ).then(() => undefined);
}
