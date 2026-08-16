// amountWords (`nino_brain.v3`) — valor por extenso em pt-BR.
//
// Áudio e texto entram no MESMO pipeline, e a fala natural não usa dígitos:
// "cinquenta reais e quarenta centavos", "mil e duzentos", "dois mil". Sem
// este leitor, o interpretador não encontrava valor, o turno caía na rota
// genérica e o rascunho virava prosa inventada pelo modelo. Aqui é tudo
// determinístico: mesma frase, mesmo número, sempre.

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};

const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
  setenta: 70, oitenta: 80, noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300,
  trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500,
  quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900,
  novecentas: 900,
};

const SCALES: Record<string, number> = {
  mil: 1_000, milhao: 1_000_000, milhoes: 1_000_000,
};

const NUMBER_WORD = (token: string): boolean =>
  token in UNITS || token in TENS || token in HUNDREDS || token in SCALES || token === "e";

export function normalizeWords(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s,.$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Converte uma sequência de palavras numéricas em número inteiro.
 * Retorna null quando a sequência não contém nenhuma palavra numérica.
 */
export function wordsToInteger(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;

  for (const token of tokens) {
    if (token === "e") continue;
    if (token in UNITS) { current += UNITS[token]; seen = true; continue; }
    if (token in TENS) { current += TENS[token]; seen = true; continue; }
    if (token in HUNDREDS) { current += HUNDREDS[token]; seen = true; continue; }
    if (token in SCALES) {
      const scale = SCALES[token];
      // "mil" sozinho vale 1000; "dois mil" vale 2000.
      current = (current === 0 ? 1 : current) * scale;
      total += current;
      current = 0;
      seen = true;
      continue;
    }
    return seen ? total + current : null;
  }
  return seen ? total + current : null;
}

type WordGroup = { value: number; start: number; end: number };

function numberGroups(tokens: string[]): WordGroup[] {
  const groups: WordGroup[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!NUMBER_WORD(tokens[i]) || tokens[i] === "e") { i += 1; continue; }
    let j = i;
    while (j < tokens.length && NUMBER_WORD(tokens[j])) j += 1;
    // Um "e" final não pertence ao grupo ("cinquenta e quarenta centavos").
    let end = j;
    while (end > i && tokens[end - 1] === "e") end -= 1;
    const value = wordsToInteger(tokens.slice(i, end));
    if (value !== null) groups.push({ value, start: i, end });
    i = j;
  }
  return groups;
}

/**
 * Lê um valor monetário escrito por extenso.
 * Exemplos: "cinquenta reais e quarenta centavos" -> 50.4;
 * "mil e duzentos" -> 1200; "cem reais" -> 100; "meio real" -> 0.5.
 * Retorna null quando não há valor por extenso na frase.
 */
export function parseAmountInWords(text: string): number | null {
  const normalized = normalizeWords(text);
  if (!normalized) return null;
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return null;

  const groups = numberGroups(tokens);
  const centIndex = tokens.findIndex((t) => t === "centavo" || t === "centavos");
  const realIndex = tokens.findIndex((t) => t === "real" || t === "reais" || t === "conto" || t === "contos");
  const halfIndex = tokens.findIndex((t) => t === "meio" || t === "meia");

  let cents = 0;
  let centGroup: WordGroup | null = null;
  if (centIndex >= 0) {
    centGroup = [...groups].reverse().find((g) => g.end <= centIndex) ?? null;
    if (centGroup) cents = centGroup.value % 100;
    else if (halfIndex >= 0 && halfIndex < centIndex) cents = 50;
  }
  const hasCents = centIndex >= 0 && (centGroup !== null || cents > 0);
  const integerGroups = groups.filter((g) => g !== centGroup);

  let integer: number | null = null;
  if (integerGroups.length) {
    // Com "reais" explícito, o grupo imediatamente anterior manda; sem ele,
    // usa o primeiro grupo da frase (o valor citado).
    const beforeReais = realIndex >= 0 ? [...integerGroups].reverse().find((g) => g.end <= realIndex) : null;
    integer = (beforeReais ?? integerGroups[0]).value;
  }

  if (integer === null && !hasCents) {
    // "meio real" / "meia" sem outro número.
    if (halfIndex >= 0 && (realIndex >= 0 || tokens.length <= 3)) return 0.5;
    return null;
  }

  const base = integer ?? 0;
  const value = Math.round((base + cents / 100) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Variante segura para o interpretador: só aceita valor por extenso quando a
 * frase traz marcador monetário explícito ("reais", "centavos", "conto",
 * "pila"). Sem isso, "quero uma dica" seria lido como R$ 1,00.
 */
export function parseSpelledMoney(text: string): number | null {
  const normalized = normalizeWords(text);
  if (!/\b(reais|real|centavos?|contos?|pila|paus)\b/.test(normalized)) return null;
  return parseAmountInWords(normalized);
}
