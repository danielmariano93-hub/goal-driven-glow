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

/**
 * Canonical comparison-window policy. A model may reverse target/baseline when
 * reading a natural-language comparison. The requested operation remains the
 * same: the newer *partial* month is the active window, the immediately
 * preceding *full* month is the baseline. Normalize the pair together, not
 * with isolated regex repairs throughout the runtime.
 *
 * Only structurally comparable adjacent months qualify. An explicitly requested
 * full month is never changed. This function is pure and side-effect free.
 */
export function canonicalMonthComparison(
  text: string,
  base: Win | null | undefined,
  comparison: Win | null | undefined,
): { base: Win; comparison: Win; reordered: boolean; aligned: boolean } | null {
  if (!base?.from || !base?.to || !comparison?.from || !comparison?.to) return null;
  if (WHOLE_MONTH.test(norm(text))) return null;
  const alignedForward = sameWindowComparison(text, base, comparison);
  if (alignedForward) {
    return { base, comparison: alignedForward, reordered: false, aligned: true };
  }
  // Model reversed the comparison roles: previous full month became the
  // target, while the current partial month became the baseline.
  if (
    isFullMonth(base) && sameMonth(comparison) && !isFullMonth(comparison)
    && base.from.slice(0, 7) === previousMonthKey(comparison.from)
  ) {
    const aligned = samePeriodPreviousMonth(comparison);
    return {
      base: comparison,
      comparison: aligned,
      reordered: true,
      aligned: aligned.from !== base.from || aligned.to !== base.to,
    };
  }
  return null;
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
