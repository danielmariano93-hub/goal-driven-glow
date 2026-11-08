// Correção de valor de um rascunho de lançamento que está esperando confirmação ("na verdade foi 45", "errei, foram 45").
// Antes, essa frase passava pelo interpretador, as duas leituras divergiam, nada mudava e o "sim" seguinte confirmava
// o rascunho ANTIGO: o lançamento era gravado com o valor errado. Agora o valor é corrigido em código.
import { parseAmountInWords } from "../amountWords.ts";

const plain = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Pista de correção ("na verdade", "errei", "foi", "foram", "era", "corrige"…). */
const CUE = /\b(na verdade|na verade|errei|errado|erro meu|me enganei|corrig\w+|ajust\w+|melhor|era|foi|foram|sao|seria|na real)\b/;
/** Se a frase pede outra coisa, não é correção. */
// "?" só veta quando fecha a frase: "Oi Nino, tudo bem? … errei, foram 45" tem "?" no meio e é correção.
const OTHER_INTENT = /\b(quanto|qual|quais|onde|quando|como|por que|cancel\w*|nao registr\w*|nao salv\w*|apaga\w*|exclu\w*)\b|\?\s*$/;

/** Valor corrigido, ou null se a frase não é uma correção de valor com exatamente um número. */
export function parseAmountCorrection(text: string): number | null {
  const t = plain(text);
  // Mensagens educadas e compridas ("Opa, queria te falar: errei, foram 45, obrigado desde já") também corrigem.
  if (!t.trim() || t.length > 170) return null;
  if (!CUE.test(t) || OTHER_INTENT.test(t)) return null;
  const found = [...t.matchAll(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g)];
  if (found.length === 1) {
    const raw = found[0][1];
    const value = Number(/^\d{1,3}(?:\.\d{3})+/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", "."));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (found.length === 0 && /\b(reais|real)\b/.test(t)) {
    const words = parseAmountInWords(t);
    return words != null && words > 0 ? words : null;
  }
  return null;
}

/** Aplica o novo valor ao payload e ao texto-resumo do rascunho. Rascunho parcelado fica de fora (valor total x parcela é ambíguo). */
export function applyAmountCorrection(
  payload: Record<string, unknown> | null | undefined,
  summary: string,
  newAmount: number,
): { payload: Record<string, unknown>; summary: string; previous: number } | null {
  const p = payload ?? {};
  const previous = Number(p.amount);
  if (!Number.isFinite(previous) || previous <= 0) return null;
  if (Number(p.installments_total ?? 1) > 1) return null;
  // O formato pt-BR usa espaço não separável depois do "R$"; aceita também o espaço comum.
  const oldPattern = new RegExp(BRL.format(previous).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\u00a0/g, "\\s"));
  const nextSummary = oldPattern.test(summary) ? summary.replace(oldPattern, BRL.format(newAmount)) : summary;
  return { payload: { ...p, amount: newAmount }, summary: nextSummary, previous };
}

export function correctionReply(summary: string, previous: number, next: number): string {
  return `Corrigi o valor de ${BRL.format(previous)} para ${BRL.format(next)}.\n\n${summary}\n\nPosso salvar assim?`;
}
