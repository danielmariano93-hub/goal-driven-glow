/** Quantos lançamentos aparecem de cada vez; "Ver mais" abre os seguintes. */
export const ENTRY_PAGE = 15;

/** Mais recente primeiro: dia do lançamento e, no mesmo dia, o que foi registrado por último. */
export function newestFirst<T extends { occurred_on: string; created_at?: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    b.occurred_on.localeCompare(a.occurred_on) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}
