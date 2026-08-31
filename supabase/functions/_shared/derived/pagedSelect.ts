// Leitura completa pela Data API — `paged_select.v1`.
//
// CAUSA-RAIZ (31/08/2026): a Data API devolve NO MÁXIMO 1.000 linhas por
// requisição e ignora `.limit(8000)` sem erro nenhum. Cargas que pediam 2.000,
// 5.000 ou 20.000 lançamentos recebiam só as 1.000 primeiras da ordenação e
// somavam um pedaço do período — foi assim que o relatório mostrou 1.603,76 em
// Transporte enquanto a verdade do mês era 2.389,99.
//
// Qualquer leitura que alimente número exibido ao usuário passa por aqui.
export const DATA_API_PAGE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Percorre todas as páginas de uma consulta.
 *
 * `build(from, to)` deve devolver a consulta já com `.range(from, to)` — assim
 * cada chamador mantém seus próprios filtros e ordenação (ordenação estável é
 * obrigatória, senão a paginação repete ou perde linhas).
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { source?: string; maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 50;
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * DATA_API_PAGE;
    const { data, error } = await build(from, from + DATA_API_PAGE - 1);
    if (error) throw new Error(`${opts.source ?? "paged_select"}:${error.message}`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < DATA_API_PAGE) break;
  }
  return rows;
}
