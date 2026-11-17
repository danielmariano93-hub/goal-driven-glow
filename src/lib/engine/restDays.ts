/**
 * "Dias sem gastar": se o ritmo atual não cabe no que resta, quantos dos dias que faltam
 * precisariam ficar sem gasto nenhum para fechar sem estourar, mantendo esse ritmo nos demais dias.
 * Só informa; não julga. Retorna null quando já cabe ou quando não há base para a conta.
 */
export interface RestDays {
  /** Dias em que ainda dá para gastar no ritmo atual. */
  spendDays: number;
  /** Dias que precisariam ficar sem gastar nada. */
  restDays: number;
  daysLeft: number;
}

export function restDaysToFit(budgetLeft: number, daysLeft: number, perDay: number): RestDays | null {
  if (![budgetLeft, daysLeft, perDay].every(Number.isFinite)) return null;
  if (budgetLeft <= 0 || daysLeft < 1 || perDay <= 0) return null;
  const days = Math.floor(daysLeft);
  if (perDay * days <= budgetLeft + 0.005) return null; // já fecha no ritmo atual
  const spendDays = Math.min(days, Math.max(0, Math.floor(budgetLeft / perDay + 1e-9)));
  return { spendDays, restDays: days - spendDays, daysLeft: days };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Frase curta e neutra: "No ritmo atual, fechar sem estourar pede cerca de 13 dias sem gastar nada, entre os 25 que faltam." */
export function restDaysText(r: RestDays): string {
  return `No ritmo atual, fechar sem estourar pede cerca de ${plural(r.restDays, "dia", "dias")} sem gastar nada, entre ${r.daysLeft === 1 ? "o" : "os"} ${r.daysLeft} que ${r.daysLeft === 1 ? "falta" : "faltam"}.`;
}
