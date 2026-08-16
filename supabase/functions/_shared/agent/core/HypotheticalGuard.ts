// HypotheticalGuard — trava determinística contra "lançamento fantasma".
// Frases condicionais/simuladas ("se eu tivesse um gasto de 3 mil por mês")
// carregam valor, mas NÃO são pedido de registro. Nenhuma rota pode gerar
// rascunho de transação a partir delas.

const norm = (s: string) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

/** Marcadores de hipótese/simulação/consultoria. */
const HYPOTHETICAL_RX = [
  /\bse eu (tivesse|quisesse|fizesse|comprasse|pegasse|gastasse|contratasse|assumisse|parcelasse)\b/,
  /\bse (a partir|eu passar|passasse|surgir|aparecer)\b/,
  /\b(caso|imagina|imagine|suponha|supondo|vamos supor|digamos)\b/,
  /\bconsegui(ria|riamos)\b/,
  /\b(cabe|caberia|da conta|daria conta|vale a pena|compensa)\b/,
  /\b(simul(a|e|ar|acao)|projet(a|e|ar|acao)|cenario)\b/,
  /\b(a partir de|apos|depois de) (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
  /\b(por mes|mensalmente|mes a mes|todo mes)\b/,
  /\b(quanto|qual|onde|como|quais|sera que)\b.*\?/,
  /\bimpacto\b/,
  /\bpoderia (reduzir|cortar|economizar)\b/,
  /\bonde (eu )?(poderia|posso|da pra) (reduzir|cortar|economizar)\b/,
];

/** Verbos/estruturas que indicam pedido REAL de registro. */
const ENTRY_INTENT_RX = [
  /\b(registr(a|e|ar|ei|ou)|lanc(a|e|ar|ei)|anot(a|e|ar|ei)|adicion(a|e|ar|ei)|inclu(a|ir|i))\b/,
  /\b(gastei|paguei|comprei|recebi|ganhei|tomei|torrei)\b/,
  /^!ja\b/,
  /(^|\n)\s*(valor|despesa|receita|estabelecimento)\s*:?\s*(r\$)?\s*\d/,
];

/** Palavras que indicam consultoria/decisão (rota advisor, nunca rascunho). */
const ADVISORY_RX = [
  /\b(consultor|me ajuda como|conselho|orient(a|e|acao))\b/,
  /\b(parcel(a|ar|amento)) .*\b(vale|cabe|consigo)\b/,
];

export function isHypotheticalStatement(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return HYPOTHETICAL_RX.some((rx) => rx.test(t));
}

export function hasEntryIntent(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return ENTRY_INTENT_RX.some((rx) => rx.test(t));
}

export function isAdvisoryRequest(text: string): boolean {
  const t = norm(text);
  return ADVISORY_RX.some((rx) => rx.test(t)) || isHypotheticalStatement(t);
}

/**
 * Pode esta mensagem gerar rascunho de lançamento?
 * Hipótese sem verbo de registro explícito ⇒ NÃO.
 */
export function allowsEntryDraft(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (!isHypotheticalStatement(t)) return true;
  // "registre 50 no mercado todo mês" é registro real mesmo com marcador fraco:
  // só liberamos quando há verbo explícito de registro E não há condicional forte.
  const strongHypothetical = /\bse eu \w+sse\b|\bse a partir\b|\bimagin|\bsuponha|\bsupondo|\bcenario|\bconsegui(ria|riamos)\b|\bvale a pena\b/.test(t);
  return hasEntryIntent(t) && !strongHypothetical;
}
