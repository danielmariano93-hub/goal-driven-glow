// Padrão seguro de janelas na comparação (opção A, provisória).
//
// Problema: "esse mês contra o mês anterior" com o mês atual ainda aberto virava 01/11–18/11 contra 01/10–31/10
// (18 dias contra 31 e uma "queda de 86,7%" que não existia).
// Regra estrutural, sem lista de frases: se o período atual é um recorte parcial de UM mês e a comparação caiu no mês
// anterior INTEIRO, compara os mesmos dias, a não ser que a pessoa peça o mês fechado ("inteiro", "completo", "todo").
// A suposição é sempre dita na resposta (ver comparisonHeader), então erro de leitura fica visível e corrigível.
//
// REMOVER quando a álgebra de tempo única (janela escolhida por vocabulário fechado no contrato do turno) estiver
// em produção: esta trava passa a ser redundante. Prazo: fim da Fase 1 do plano de tempo.
import { samePeriodPreviousMonth } from "../../analytics/periodResolver.ts";

type Win = { from: string; to: string };

const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Único vocabulário: pedido explícito do mês fechado. Qualquer outra coisa usa o padrão seguro. */
const WHOLE_MONTH = /\b(?:inteiro|inteira|completo|completa|fechado|fechada|todo|toda)\b|\bmes\s+todo\b/;

const lastDayOf = (ymd: string): number => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
export const sameMonth = (w: Win) => w.from.slice(0, 7) === w.to.slice(0, 7);
export const isFullMonth = (w: Win) => sameMonth(w) && w.from.endsWith("-01") && Number(w.to.slice(8, 10)) === lastDayOf(w.to);
const previousMonthKey = (ymd: string): string => {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Recorte de comparação alinhado (mesmos dias do mês anterior), ou `null` quando não há o que corrigir. */
export function sameWindowComparison(text: string, base: Win | null | undefined, comparison: Win | null | undefined): Win | null {
  if (!base?.from || !base?.to || !comparison?.from || !comparison?.to) return null;
  if (!sameMonth(base) || isFullMonth(base)) return null;
  const prevFull = isFullMonth(comparison) && comparison.from.slice(0, 7) === previousMonthKey(base.from);
  if (!prevFull) return null;
  if (WHOLE_MONTH.test(norm(text))) return null;
  const aligned = samePeriodPreviousMonth(base);
  if (comparison.from === aligned.from && comparison.to === aligned.to) return null;
  return aligned;
}

/** O par comparado é "mês atual até hoje" contra "os mesmos dias do mês anterior" (mesmo tamanho, meses vizinhos)? */
export function isSameDaysPair(a: Win | null | undefined, b: Win | null | undefined): boolean {
  if (!a?.from || !a?.to || !b?.from || !b?.to) return false;
  if (!sameMonth(a) || !sameMonth(b) || isFullMonth(b)) return false;
  return a.from.slice(0, 7) === previousMonthKey(b.from) && a.from.slice(8, 10) === b.from.slice(8, 10) && a.to.slice(8, 10) === b.to.slice(8, 10);
}
