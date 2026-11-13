// Leitura: "parei na página X" vira o avanço do dia (puro, só para a interface; não é espelhado no servidor).

export type StopCheck =
  | { kind: "empty" }
  | { kind: "added"; stop: number; added: number; finishes: boolean }
  | { kind: "same" }
  | { kind: "back"; current: number }
  | { kind: "over"; total: number };

/** Lê "20", "20,5" ou "20.5". Nulo se não for um número maior que zero. */
export function parseStop(text: string): number | null {
  const n = Number(String(text ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Quantas páginas foram lidas desde a última marcação, dado o número da página em que a pessoa parou. */
export function checkStop(current: number, total: number, text: string): StopCheck {
  const stop = parseStop(text);
  if (stop == null) return { kind: "empty" };
  if (stop > total) return { kind: "over", total };
  if (stop === current) return { kind: "same" };
  if (stop < current) return { kind: "back", current };
  return { kind: "added", stop, added: Math.round((stop - current) * 100) / 100, finishes: stop >= total };
}

/** Anotações de um projeto, da mais recente para a mais antiga. */
export interface ReadingNote { id: string; project_id: string; body: string; page: number | null; noted_on: string }
export const notesOf = (all: ReadingNote[], projectId: string): ReadingNote[] =>
  all.filter((n) => n.project_id === projectId).sort((a, b) => (a.noted_on === b.noted_on ? 0 : a.noted_on < b.noted_on ? 1 : -1));

/** Tópicos do resumo guardados como texto: um por linha, com "• " na frente. */
export const bulletsToText = (bullets: string[]): string => bullets.map((b) => `• ${b.replace(/^[•\-\s]+/, "")}`).join("\n");
export const textToBullets = (text: string): string[] => text.split("\n").map((l) => l.replace(/^[•\-\s]+/, "").trim()).filter(Boolean);
