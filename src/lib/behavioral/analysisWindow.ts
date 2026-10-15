// De quando é a leitura e de qual fim de semana ela fala. Datas civis (sem fuso do aparelho).
const MS = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const add = (iso: string, n: number) => new Date(parse(iso) + n * MS).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(parse(iso)).getUTCDay(); // 0 = domingo
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export type WeekendWindow = {
  asOf: string;
  /** Último fim de semana já fechado (sexta a domingo). */
  lastFriday: string;
  lastSunday: string;
  /** Fim de semana a que a ação se refere: o atual, se já começou (sex–dom), senão o próximo. */
  focusFriday: string;
  focusSunday: string;
  focusInProgress: boolean;
};

export function weekendWindow(asOf: string): WeekendWindow {
  const d = dow(asOf);
  // domingo mais recente estritamente antes de hoje
  const daysSinceSunday = d === 0 ? 7 : d;
  const lastSunday = add(asOf, -daysSinceSunday);
  const lastFriday = add(lastSunday, -2);
  const inProgress = d === 5 || d === 6 || d === 0;
  const focusFriday = inProgress ? add(asOf, d === 5 ? 0 : d === 6 ? -1 : -2) : add(asOf, (5 - d + 7) % 7);
  return { asOf, lastFriday, lastSunday, focusFriday, focusSunday: add(focusFriday, 2), focusInProgress: inProgress };
}

/** Linha curta para o card: quando foi feita a leitura, até que data vão os dados e a que fim de semana se refere. */
export function analysisNote(asOf: string): string {
  const w = weekendWindow(asOf);
  const focus = `${w.focusInProgress ? "este fim de semana" : "o próximo fim de semana"} (${w.focusFriday.slice(8, 10)} a ${dm(w.focusSunday)})`;
  return `Leitura de ${dm(asOf)}, com dados até ${dm(add(asOf, -1))}. Considera os fins de semana já fechados, até ${dm(w.lastSunday)}. A sugestão vale para ${focus}.`;
}
