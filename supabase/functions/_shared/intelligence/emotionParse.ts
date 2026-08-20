// emotion_parse.v1 — leitura determinística de sentimento em pt-BR.
// Espelha o catálogo canônico do app (src/lib/emotions/catalog.ts): o Nino
// grava sempre `emotion_key` + `mood` deste catálogo, nunca texto livre.

export type EmotionOption = { key: string; label: string; mood: number; emoji: string };

export const EMOTION_CATALOG: readonly EmotionOption[] = [
  { key: "tranquilo", label: "Tranquilo", mood: 5, emoji: "😌" },
  { key: "atento", label: "Atento", mood: 3, emoji: "🧐" },
  { key: "preocupado", label: "Preocupado", mood: 1, emoji: "😟" },
  { key: "confiante", label: "Confiante", mood: 4, emoji: "🙂" },
  { key: "impulsivo", label: "Impulsivo", mood: 2, emoji: "⚡" },
  { key: "frustrado", label: "Frustrado", mood: 1, emoji: "😤" },
  { key: "celebrando", label: "Celebrando", mood: 5, emoji: "🎉" },
  { key: "culpado", label: "Culpado", mood: 2, emoji: "😞" },
];

/** Sinônimos naturais → chave canônica. Ordem longa→curta na busca. */
const SYNONYMS: Record<string, string> = {
  tranquilo: "tranquilo", tranquila: "tranquilo", tranquilao: "tranquilo", calmo: "tranquilo",
  calma: "tranquilo", "de boa": "tranquilo", sereno: "tranquilo", leve: "tranquilo",
  paz: "tranquilo", aliviado: "tranquilo", "em paz": "tranquilo", suave: "tranquilo",

  atento: "atento", alerta: "atento", ansioso: "atento", ansiosa: "atento", ansiedade: "atento",
  nervoso: "atento", nervosa: "atento", apreensivo: "atento", tenso: "atento", agitado: "atento",

  preocupado: "preocupado", preocupada: "preocupado", aflito: "preocupado", angustiado: "preocupado",
  triste: "preocupado", "pra baixo": "preocupado", "para baixo": "preocupado", desanimado: "preocupado",
  "com medo": "preocupado", inseguro: "preocupado",

  confiante: "confiante", seguro: "confiante", otimista: "confiante", esperancoso: "confiante",
  animado: "confiante", motivado: "confiante",

  impulsivo: "impulsivo", impulsiva: "impulsivo", impulso: "impulsivo", "no impulso": "impulsivo",
  "sem pensar": "impulsivo", entediado: "impulsivo", tedio: "impulsivo",

  frustrado: "frustrado", frustrada: "frustrado", irritado: "frustrado", irritada: "frustrado",
  raiva: "frustrado", estressado: "frustrado", estressada: "frustrado", cansado: "frustrado",
  cansada: "frustrado", exausto: "frustrado", esgotado: "frustrado", chateado: "frustrado",

  celebrando: "celebrando", comemorando: "celebrando", feliz: "celebrando", realizado: "celebrando",
  orgulhoso: "celebrando", "deu certo": "celebrando", contente: "celebrando",

  culpado: "culpado", culpada: "culpado", culpa: "culpado", arrependido: "culpado",
  "me arrependi": "culpado", vergonha: "culpado",

  // Frases naturais do dia a dia (pt-BR falado).
  "dia pesado": "frustrado", "dia dificil": "frustrado", "dia corrido": "frustrado",
  "na correria": "frustrado", "sem paciencia": "frustrado", "de cabeca cheia": "frustrado",
  "dia bom": "celebrando", "dia otimo": "celebrando", "foi um bom dia": "celebrando",
  "dia tranquilo": "tranquilo", "dia leve": "tranquilo", "bem tranquilo": "tranquilo",
  "meio pra baixo": "preocupado", "meio triste": "preocupado", "sem animo": "preocupado",
  "meio ansioso": "atento", "meio tenso": "atento", "no automatico": "impulsivo",
  "gastei sem pensar": "impulsivo",
};

/** Emoji do catálogo: resposta de um toque também é resposta. */
const EMOJI_MAP: Record<string, string> = {
  "😌": "tranquilo", "🧐": "atento", "😟": "preocupado", "🙂": "confiante",
  "⚡": "impulsivo", "😤": "frustrado", "🎉": "celebrando", "😞": "culpado",
  "😀": "celebrando", "😃": "celebrando", "😄": "celebrando", "😊": "confiante",
  "😢": "preocupado", "😭": "preocupado", "😡": "frustrado", "😠": "frustrado",
  "😰": "atento", "😥": "preocupado", "😴": "frustrado", "🥲": "culpado",
};


function normalize(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

export function emotionByKey(key?: string | null): EmotionOption | null {
  if (!key) return null;
  const normalized = normalize(key);
  return EMOTION_CATALOG.find((option) => option.key === normalized) ?? null;
}

/** Resolve um termo isolado ("ansioso", "tranquilo", "atento"). */
export function resolveEmotionTerm(value?: string | null): EmotionOption | null {
  if (!value) return null;
  const normalized = normalize(value);
  const direct = emotionByKey(normalized);
  if (direct) return direct;
  const mapped = SYNONYMS[normalized];
  return mapped ? emotionByKey(mapped) : null;
}

/** Emoji citado no texto ("😌", "hoje foi 🎉"). */
export function parseEmotionFromEmoji(text?: string | null): EmotionOption | null {
  const raw = String(text ?? "");
  for (const [emoji, key] of Object.entries(EMOJI_MAP)) {
    if (raw.includes(emoji)) return emotionByKey(key);
  }
  return null;
}

/** Nota de 1 a 5 dada como resposta ("4", "nota 4", "4 de 5", "3/5"). */
export function parseMoodScale(text?: string | null): EmotionOption | null {
  const raw = normalize(text ?? "");
  const match = raw.match(/^(?:nota\s+)?([1-5])(?:\s*(?:de|\/)\s*5)?$/)
    ?? raw.match(/\bnota\s+([1-5])\b/)
    ?? raw.match(/\b([1-5])\s*(?:de|\/)\s*5\b/);
  return match ? moodToEmotion(Number(match[1])) : null;
}

/** Resolve emoção dentro de uma frase livre ("hoje me senti bem ansioso"). */
export function parseEmotionFromText(text?: string | null): EmotionOption | null {
  const normalized = normalize(text ?? "");
  if (!normalized) return null;
  const terms = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const pattern = new RegExp(`(?:^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`);
    if (pattern.test(normalized)) return emotionByKey(SYNONYMS[term]);
  }
  return parseEmotionFromEmoji(text) ?? parseMoodScale(text);
}


/** Escala 1..5 informada diretamente ("nota 4", "4 de 5"). */
export function moodToEmotion(mood?: number | null): EmotionOption | null {
  if (mood == null || !Number.isFinite(mood)) return null;
  const value = Math.min(5, Math.max(1, Math.round(Number(mood))));
  return EMOTION_CATALOG.find((option) => option.mood === value) ?? null;
}

export function emotionOptionsSentence(): string {
  return EMOTION_CATALOG.map((option) => option.label.toLowerCase()).join(", ");
}
