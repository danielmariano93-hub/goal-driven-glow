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
const WHOLE_WORDS = ["inteiro", "inteira", "completo", "completa", "fechado", "fechada"];

/** Distância de edição limitada (digitação: "ineiro", "copleto"). Só roda contra um conjunto fechado de 6 palavras. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Pedido explícito do mês fechado, tolerante a erro de digitação. */
export function asksWholeMonth(normalizedText: string): boolean {
  if (WHOLE_MONTH.test(normalizedText)) return true;
  return normalizedText.split(/\s+/).some((w) => w.length >= 6 && WHOLE_WORDS.some((k) => within(w, k, 1)));
}

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
  if (asksWholeMonth(norm(text))) return null;
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

/**
 * O contrato guarda as janelas que o modelo escreveu (`focus.period_expressions`, "AAAA-MM-DD..AAAA-MM-DD") e a trava
 * exige que cada uma exista na conta. Se a conta usa a janela alinhada, o contrato tem de dizer a mesma coisa: troca
 * a janela de antes pela alinhada ANTES de montar o contrato (corrigir só a conta fazia a trava recusar a resposta).
 */
export function alignTurnPeriods<T extends { focus: { period_expression: string | null; period_expressions?: string[] } }>(
  turn: T, from: Win, to: Win | null,
): T {
  if (!to) return turn;
  const was = `${from.from}..${from.to}`;
  const now = `${to.from}..${to.to}`;
  const swap = (e: string) => (String(e ?? "").trim() === was ? now : e);
  return {
    ...turn,
    focus: {
      ...turn.focus,
      period_expression: turn.focus.period_expression == null ? null : swap(turn.focus.period_expression),
      period_expressions: (turn.focus.period_expressions ?? []).map(swap),
    },
  };
}
