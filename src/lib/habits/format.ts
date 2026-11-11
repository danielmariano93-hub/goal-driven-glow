/** Primeira letra maiúscula, o resto como veio ("quarta-feira, 11 de novembro" -> "Quarta-feira, 11 de novembro"). */
export const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
