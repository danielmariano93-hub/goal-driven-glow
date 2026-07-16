// Extração estrutural por spans (client + edge shared logic).
// Regras: nunca aplicar blacklist ampla. Descrição = texto original menos spans
// identificados. Preservar literalmente siglas informadas ("VOS" nunca vira "VPS").
// Nunca inventar dados.

import { parseBrAmount } from "@/lib/agent/parser";

export type ExtractedSpans = {
  amount: number | null;
  occurred_at: string | null; // ISO yyyy-mm-dd
  installments_total: number | null;
  payment_method: "credit_card" | "account" | null;
  card_hint: string | null;
  account_hint: string | null;
  category_hint: string | null;
  description: string; // trecho literal restante
  raw: string;
};

const AMOUNT_RX = /(?:r\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;
const INSTALLMENT_RX = /\b(?:em\s+)?(\d{1,2})\s*x\b/i;
const CARD_METHOD_RX = /\bno\s+cart[aã]o(?:\s+de\s+cr[eé]dito)?\b|\bcart[aã]o\s+de\s+cr[eé]dito\b|\bno\s+cr[eé]dito\b/i;
const DEBIT_METHOD_RX = /\b(?:no\s+d[eé]bito|na\s+conta(?:\s+corrente)?|em\s+dinheiro|no\s+dinheiro|no\s+pix)\b/i;
const RELATIVE_DATE_RX = /\b(hoje|ontem|anteontem)\b/i;
// Marcas: sem \b trailing para funcionar com acentos (ú, é). Início: início-de-string ou espaço.
const CARD_BRAND_RX = /(?:^|\s)(itau|ita[uú]|nubank|bradesco|santander|inter|c6|xp|will|mercadopago|picpay|caixa|banco do brasil|bb|next)(?=$|[\s.,;!?])/i;

// Categorias comuns explícitas (apenas para hint — resolução real é server-side)
const CATEGORY_HINT_RX = /\b(mercado|almo[cç]o|jantar|caf[eé]|uber|99|farm[aá]cia|lazer|assinatura|transporte|combust[íi]vel|educa[cç][aã]o|sa[uú]de|casa|contas?|servi[cç]os?|hospedagem|servidor|internet)\b/i;

const CONNECTORS_START = /^(gastei|paguei|comprei|registr(?:e|a|ar|ei)|inclu(?:a|ir|i)|foi|de|no|na|em|com)\s+/i;

/**
 * Remove um span do texto pelos índices, colapsando espaços resultantes.
 */
function stripSpan(text: string, start: number, end: number): string {
  return (text.slice(0, start) + " " + text.slice(end)).replace(/\s+/g, " ").trim();
}

function toISO(datePhrase: string): string {
  const t = datePhrase.toLowerCase();
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const today = `${y}-${m}-${d}`;
  if (/hoje/.test(t)) return today;
  const shift = (days: number) => {
    const dt = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate() - days, 12));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  };
  if (/ontem/.test(t)) return shift(1);
  if (/anteontem/.test(t)) return shift(2);
  return today;
}

export function extractSpans(raw: string): ExtractedSpans {
  const original = String(raw ?? "").trim();
  let remaining = original;
  const out: ExtractedSpans = {
    amount: null,
    occurred_at: null,
    installments_total: null,
    payment_method: null,
    card_hint: null,
    account_hint: null,
    category_hint: null,
    description: "",
    raw: original,
  };

  // 1) amount
  const amt = remaining.match(AMOUNT_RX);
  if (amt && amt.index != null) {
    const parsed = parseBrAmount(amt[1]);
    if (parsed != null && parsed > 0) {
      out.amount = parsed;
      // Remove valor + possíveis "R$" prefixados
      const fullStart = Math.max(0, amt.index - 3); // margem para "R$ "
      const rawPrefix = remaining.slice(fullStart, amt.index);
      const cut = /r\$\s*$/i.test(rawPrefix) ? fullStart : amt.index;
      remaining = stripSpan(remaining, cut, amt.index + amt[0].length);
    }
  }

  // 2) installments
  const inst = remaining.match(INSTALLMENT_RX);
  if (inst && inst.index != null) {
    const n = Number(inst[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 48) {
      out.installments_total = n;
      // Também consumir "em " se anteceder
      const start = Math.max(0, inst.index - 3);
      const cut = /\bem\s+$/i.test(remaining.slice(start, inst.index)) ? start : inst.index;
      remaining = stripSpan(remaining, cut, inst.index + inst[0].length);
    }
  }

  // 3) payment method + card/account hint
  const cardMatch = remaining.match(CARD_METHOD_RX);
  if (cardMatch && cardMatch.index != null) {
    out.payment_method = "credit_card";
    remaining = stripSpan(remaining, cardMatch.index, cardMatch.index + cardMatch[0].length);
    const brand = CARD_BRAND_RX.exec(remaining);
    if (brand && brand[1]) {
      const start = brand.index + (brand[0].length - brand[1].length);
      out.card_hint = brand[1];
      remaining = stripSpan(remaining, start, start + brand[1].length);
    } else {
      out.card_hint = ""; // método sem marca → cartão único
    }
  } else {
    const debitMatch = remaining.match(DEBIT_METHOD_RX);
    if (debitMatch && debitMatch.index != null) {
      out.payment_method = "account";
      remaining = stripSpan(remaining, debitMatch.index, debitMatch.index + debitMatch[0].length);
      const brand = CARD_BRAND_RX.exec(remaining);
      if (brand && brand[1]) {
        const start = brand.index + (brand[0].length - brand[1].length);
        out.account_hint = brand[1];
        remaining = stripSpan(remaining, start, start + brand[1].length);
      }
    }
  }

  // 4) data relativa
  const dateMatch = remaining.match(RELATIVE_DATE_RX);
  if (dateMatch && dateMatch.index != null) {
    out.occurred_at = toISO(dateMatch[1]);
    remaining = stripSpan(remaining, dateMatch.index, dateMatch.index + dateMatch[0].length);
  }

  // 5) category hint (não remove — categoria pode fazer parte da descrição
  //    quando não há outra menção. Apenas anotamos)
  const catMatch = remaining.match(CATEGORY_HINT_RX);
  if (catMatch) out.category_hint = catMatch[1].toLowerCase();

  // 6) descrição = restante, tirando conectores iniciais e finais.
  let desc = remaining;
  // Remove conectores no início (com ou sem espaço trailing)
  const CONNECTORS_BARE = /^(gastei|paguei|comprei|registrei|registra|registrar|registre|inclua|incluir|incluí|foi|de|no|na|em|com)(\s+|$)/i;
  while (CONNECTORS_BARE.test(desc)) desc = desc.replace(CONNECTORS_BARE, "");
  desc = desc.replace(/^\s*de\s+/i, "").replace(/\s+de\s*$/i, "").trim();
  desc = desc.replace(/\s+/g, " ").trim();
  out.description = desc;

  return out;
}
