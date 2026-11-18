// Trava determinística de "mesmo período": quando a pessoa pede para comparar o recorte atual com "o mesmo período do
// mês anterior" (ou diz "nesse período"), o período de comparação TEM de ter os mesmos dias. O modelo entende "mês
// anterior" como outubro inteiro e o resolvedor devolvia 01/10 a 31/10 contra 01/11 a 18/11: 31 dias contra 18, e uma
// "queda de 86,7%" que não existia. Aqui o recorte de comparação é alinhado ao do período atual.
import { samePeriodPreviousMonth } from "../../analytics/periodResolver.ts";

type Win = { from: string; to: string };

const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** "mesmo período", "nesse período", "esse recorte", "mesmos dias". */
const SAME_WINDOW = /\b(?:mesmo|nesse|neste|esse|este)\s+(?:mesmo\s+)?(?:periodo|recorte|intervalo)\b|\bmesmos\s+dias\b/;
/** Referência explícita ao mês de antes. */
const PREV_MONTH_REF = /\bmes\s+(?:anterior|passado|atras)\b|\bmes\s+que\s+passou\b/;

const lastDayOf = (ymd: string): number => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
const sameMonth = (w: Win) => w.from.slice(0, 7) === w.to.slice(0, 7);
const isFullMonth = (w: Win) => sameMonth(w) && w.from.endsWith("-01") && Number(w.to.slice(8, 10)) === lastDayOf(w.to);
const previousMonthKey = (ymd: string): string => {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Devolve o recorte de comparação alinhado (mesmos dias do mês anterior) quando o texto pede "o mesmo período" e o
 * período atual é um recorte parcial de um mês; `null` quando não há o que corrigir.
 */
export function sameWindowComparison(text: string, base: Win | null | undefined, comparison: Win | null | undefined): Win | null {
  if (!base?.from || !base?.to) return null;
  const t = norm(text);
  if (!SAME_WINDOW.test(t)) return null;
  // Só faz sentido quando o período atual é parcial e cabe num mês (mês corrente até hoje, "dia 1 a 18"…).
  if (!sameMonth(base) || isFullMonth(base)) return null;
  const comparisonIsFullPreviousMonth = !!comparison && isFullMonth(comparison) && comparison.from.slice(0, 7) === previousMonthKey(base.from);
  if (!PREV_MONTH_REF.test(t) && !comparisonIsFullPreviousMonth) return null;
  const aligned = samePeriodPreviousMonth(base);
  if (comparison && comparison.from === aligned.from && comparison.to === aligned.to) return null;
  return aligned;
}
