/**
 * FONTE ÚNICA de ordenação de categorias.
 * =======================================
 * Toda lista, seletor e formulário de categoria usa esta função. Ordena por
 * nome em português do Brasil, ignorando acentos e caixa (`Água` antes de
 * `Alimentação`), de forma estável e determinística.
 *
 * Regras:
 *  - comparação `pt-BR` com `sensitivity: "base"`;
 *  - empate resolvido por `id` (estabilidade entre renders);
 *  - categorias arquivadas nunca fazem parte das opções (filtro à parte).
 */
export interface SortableCategory {
  id: string;
  name: string;
  archived_at?: string | null;
}

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function compareCategoryNames(a: SortableCategory, b: SortableCategory): number {
  const byName = COLLATOR.compare(a.name ?? "", b.name ?? "");
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/** Ordena alfabeticamente sem mutar a lista original. */
export function sortCategories<T extends SortableCategory>(list: T[]): T[] {
  return [...list].sort(compareCategoryNames);
}

/** Ativas (não arquivadas), já ordenadas — usado em todos os seletores. */
export function sortActiveCategories<T extends SortableCategory>(list: T[]): T[] {
  return sortCategories(list.filter((c) => c.archived_at == null));
}
