// TextProvenance (`nino_provenance.v1`) — de onde veio o texto que decide o turno.
//
// Causa-raiz real de "pergunta virou lançamento": quando a resposta do modelo
// era rejeitada, o núcleo remontava um texto COLANDO as últimas mensagens do
// usuário e reextraía lançamento desse texto. Fragmentos de data e de período
// viravam valor e descrição ("ago 8" -> R$ 8,00, descrição "ago") e uma
// notificação bancária antiga reinjetava valor, conta e estabelecimento.
//
// Regra dura: escrita financeira só nasce de texto que o usuário realmente
// escreveu neste turno (ou da resposta a um slot que o próprio Nino pediu).
// Texto reconstruído pelo sistema pode ser usado para ENTENDER, nunca para
// ESCREVER.

export type TextProvenance =
  /** Mensagem literal do usuário neste turno. */
  | "user_current"
  /** Resposta curta a um slot que o Nino pediu (conta, categoria, descrição). */
  | "slot_answer"
  /** Reexecução determinística de uma oferta que o Nino fez. */
  | "continuation_restated"
  /** Texto remontado pelo sistema (histórico, memória, colagem). */
  | "system_reconstructed";

/** Pode este texto originar rascunho/escrita no ledger? */
export function allowsFinancialWrite(provenance: TextProvenance): boolean {
  return provenance === "user_current" || provenance === "slot_answer";
}

/**
 * Evidência mínima de registro no PRÓPRIO texto do turno: verbo explícito de
 * registro ou linha rotulada de notificação bancária ("Valor R$ 12,99").
 * Sem isso, nenhum valor solto pode virar lançamento.
 */
const LABELED_AMOUNT_LINE_RX = /(?:^|\n)\s*valor(?:\s+total)?\s*:?\s*(?:r\$\s*)?\d/i;
const ENTRY_VERB_RX =
  /\b(registr\w*|lanc\w*|lança\w*|anot\w*|adicion\w*|inclu(?:a|ir|i)|gastei|paguei|comprei|recebi|ganhei|torrei)\b/i;

export function hasWriteEvidence(text: string): boolean {
  const raw = String(text ?? "");
  if (!raw.trim()) return false;
  if (LABELED_AMOUNT_LINE_RX.test(raw)) return true;
  const normalized = raw.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return ENTRY_VERB_RX.test(normalized);
}

/** Gate final de escrita: procedência permitida E evidência no texto. */
export function canDraftEntry(text: string, provenance: TextProvenance): boolean {
  if (!allowsFinancialWrite(provenance)) return false;
  if (provenance === "slot_answer") return true;
  return hasWriteEvidence(text);
}
