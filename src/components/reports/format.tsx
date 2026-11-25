import { Car, Dumbbell, GraduationCap, HeartPulse, Home, Landmark, PawPrint, Repeat, Scissors, Shirt, ShoppingBag, ShoppingCart, Tag, Ticket, Utensils, Zap, type LucideIcon } from "lucide-react";

// Formatação e ícones compartilhados pelos blocos do relatório.

/** Reais inteiros: análise, não extrato. */
export const brl0 = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
/** Variação em %; acima de 500% vira ">500%". */
export const pctText = (ratio: number) => (Math.abs(ratio) > 5 ? `${ratio >= 0 ? "+" : "−"}>500%` : `${ratio >= 0 ? "+" : "−"}${Math.round(Math.abs(ratio) * 100)}%`);

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

const CATEGORY_ICONS: Array<[RegExp, LucideIcon]> = [
  [/morad|alug|casa|condom/i, Home], [/aliment|restaur|deliver|lanche|comida/i, Utensils], [/mercado|supermerc/i, ShoppingCart],
  [/transport|uber|combust|carro|ônibus|onibus/i, Car], [/saúde|saude|farm|médic|medic/i, HeartPulse], [/lazer|entreten|viagem|ingresso/i, Ticket],
  [/educa|curso|escola/i, GraduationCap], [/assinatur|stream/i, Repeat], [/vestu|roupa/i, Shirt], [/belez|cabel/i, Scissors],
  [/pet|animal/i, PawPrint], [/d[ií]vid|empr[eé]stim|financ/i, Landmark], [/energia|luz|internet|conta|imposto|taxa/i, Zap],
  [/academia|esporte|fitness/i, Dumbbell], [/compra|shopping|presente/i, ShoppingBag],
];
export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS.find(([rx]) => rx.test(name))?.[1] ?? Tag;
}
