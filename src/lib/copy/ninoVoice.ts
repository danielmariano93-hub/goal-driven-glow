/**
 * Voz e tom do Nino (`nino_comm.v1`) — fonte única de "como dizer".
 *
 * ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/copy/ninoVoice.ts
 * (gerado por scripts/sync-finance-core.mjs — não editar o espelho à mão).
 *
 * O "o que dizer" vive em commIntent.ts. Aqui só existe apresentação:
 * léxico, tradução de jargão, limites por superfície e frases de confiança.
 */

/** Superfícies de comunicação com limites próprios. */
export type CommSurface = "card" | "card_detail" | "report" | "whatsapp" | "receipt" | "chat";

/** Limites duros por superfície (validados em teste). */
export const SURFACE_LIMITS: Record<CommSurface, { maxSentences: number; maxNumbers: number; maxLines: number; maxEmoji: number }> = {
  card: { maxSentences: 2, maxNumbers: 2, maxLines: 2, maxEmoji: 0 },
  card_detail: { maxSentences: 4, maxNumbers: 4, maxLines: 4, maxEmoji: 0 },
  report: { maxSentences: 3, maxNumbers: 3, maxLines: 3, maxEmoji: 0 },
  whatsapp: { maxSentences: 4, maxNumbers: 3, maxLines: 4, maxEmoji: 1 },
  receipt: { maxSentences: 2, maxNumbers: 2, maxLines: 2, maxEmoji: 1 },
  chat: { maxSentences: 5, maxNumbers: 4, maxLines: 5, maxEmoji: 1 },
};

/** Jargão financeiro proibido na UI → tradução humana obrigatória. */
export const JARGON_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bgastos?\s+flex[íi]ve(l|is)\b/gi, "gastos que dão pra ajustar"],
  [/\bdespesas?\s+discricion[áa]ria(s)?\b/gi, "gastos que dão pra ajustar"],
  [/\bproje[çc][ãa]o de caixa\b/gi, "como seu mês deve fechar"],
  [/\bfluxo de caixa projetado\b/gi, "como seu mês deve fechar"],
  [/\bcomprometimento de renda\b/gi, "quanto da sua renda já está comprometido"],
  [/\bindicador de liquidez\b/gi, "dinheiro disponível"],
  [/\bdiagn[óo]stico causal\b/gi, "leitura do seu mês"],
  [/\bimpacto estimado\b/gi, "peso no seu mês"],
  [/\bdrill-?down\b/gi, "ver detalhe"],
  [/\bconsolidad(o|as|os)\b/gi, "reunidas"],
];

/** Vocabulário proibido em qualquer copy de usuário. */
export const BANNED_WORDS = [
  "déficit",
  "deficit",
  "no vermelho",
  "fechou negativo",
  "snapshot",
  "payload",
  "contrato v",
  "provenance",
  "confiança 1.0",
  "diagnóstico causal",
];

/** Aplica as traduções de jargão em qualquer texto de usuário. */
export function humanizeJargon(text: string | null | undefined): string {
  let out = String(text ?? "");
  for (const [pattern, replacement] of JARGON_TRANSLATIONS) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Confiança nunca aparece como número ao usuário — vira frase. */
export function confidencePhrase(confidence: number | null | undefined): string {
  const c = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0.5;
  if (c >= 0.85) return "Essa leitura está bem firme.";
  if (c >= 0.6) return "Essa leitura está consistente com o seu histórico.";
  if (c >= 0.4) return "Ainda é uma leitura parcial, com poucos dados.";
  return "Ainda é um primeiro palpite: preciso de mais alguns registros.";
}

/** Corta o texto ao número de frases permitido pela superfície. */
export function limitSentences(text: string, surface: CommSurface): string {
  const max = SURFACE_LIMITS[surface].maxSentences;
  const parts = String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  return parts.slice(0, max).join(" ").trim();
}

/** Conta valores monetários/percentuais citados — usado nos testes de densidade. */
export function countNumbers(text: string): number {
  const matches = String(text ?? "").match(/R\$\s?[\d.,]+(?:\s?(?:mil|milh[õo](?:es|ão)))?|\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\b/g);
  return matches ? matches.length : 0;
}

/** Padrões de frase por intenção — usados por commIntent e pelos canais. */
export const VOICE_PATTERNS = {
  alertOpen: "Vale sua atenção agora:",
  praiseOpen: "Boa:",
  errorMissingField: (what: string) => `Faltou só uma coisa: ${what}`,
  followUp: {
    review: "Quer revisar comigo?",
    adjust: "Quer que eu mostre onde dá pra ajustar?",
    plan: "Quer que eu monte um plano?",
    track: "Quer que eu acompanhe isso este mês?",
  },
} as const;
