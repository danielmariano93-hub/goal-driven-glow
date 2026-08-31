// Leitura completa pela Data API no cliente — `paged_select.v1`.
//
// A Data API devolve no máximo 1.000 linhas por requisição e ignora limites
// maiores sem erro nenhum. Toda leitura que alimenta número exibido precisa
// paginar, senão a tela soma um pedaço do período.
export const DATA_API_PAGE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** `build(from, to)` devolve a consulta já com `.range(from, to)` e ordenação estável. */
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
