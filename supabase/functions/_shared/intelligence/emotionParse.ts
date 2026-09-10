// emotion_parse.v1 — leitura determinística de sentimento em pt-BR.
// Espelha o catálogo canônico do app (src/lib/emotions/catalog.ts): o Nino
// grava sempre `emotion_key` + `mood` deste catálogo, nunca texto livre.
//
// `nino_language.v1`: ansiedade NÃO é mais traduzida para "atento". Ansioso é
// uma emoção própria; atento voltou a significar atenção. Palavra que a pessoa
// insistir e não exista aqui vira sentimento PESSOAL dela (`user_emotions`).

export type EmotionOption = { key: string; label: string; mood: number; emoji: string; custom?: boolean };

export const EMOTION_CATALOG: readonly EmotionOption[] = [
  { key: "tranquilo", label: "Tranquilo", mood: 5, emoji: "😌" },
  { key: "ansioso", label: "Ansioso", mood: 2, emoji: "😰" },
  { key: "atento", label: "Atento", mood: 3, emoji: "🧐" },
  { key: "preocupado", label: "Preocupado", mood: 1, emoji: "😟" },
  { key: "triste", label: "Triste", mood: 1, emoji: "😢" },
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

  ansioso: "ansioso", ansiosa: "ansioso", ansiedade: "ansioso", nervoso: "ansioso",
  nervosa: "ansioso", apreensivo: "ansioso", apreensiva: "ansioso", tenso: "ansioso",
  tensa: "ansioso", agitado: "ansioso", agitada: "ansioso", aflito: "ansioso",

  atento: "atento", alerta: "atento", "de olho": "atento", vigilante: "atento",

  preocupado: "preocupado", preocupada: "preocupado", angustiado: "preocupado",
  "com medo": "preocupado", inseguro: "preocupado",

  triste: "triste", tristeza: "triste", "pra baixo": "triste", "para baixo": "triste", desanimado: "triste",

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
  "meio pra baixo": "triste", "meio triste": "triste", "sem animo": "triste",
  "meio ansioso": "ansioso", "meio tenso": "ansioso", "no automatico": "impulsivo",
  "gastei sem pensar": "impulsivo",
};

/** Emoji do catálogo: resposta de um toque também é resposta. */
const EMOJI_MAP: Record<string, string> = {
  "😌": "tranquilo", "🧐": "atento", "😟": "preocupado", "🙂": "confiante",
  "⚡": "impulsivo", "😤": "frustrado", "🎉": "celebrando", "😞": "culpado",
  "😀": "celebrando", "😃": "celebrando", "😄": "celebrando", "😊": "confiante",
  "😢": "triste", "😭": "triste", "😡": "frustrado", "😠": "frustrado",
  "😰": "ansioso", "😥": "preocupado", "😴": "frustrado", "🥲": "culpado",
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

// ---------------------------------------------------------------------------
// nino_language.v1 — correção natural e sentimento pessoal
// ---------------------------------------------------------------------------

export type EmotionCorrection = {
  /** o que a pessoa nega ("atento"), quando ela cita */
  fromTerm: string | null;
  /** o que ela afirma ("ansioso") */
  toTerm: string;
  /** emoção canônica do termo afirmado, quando existir no catálogo */
  option: EmotionOption | null;
};

/**
 * "Não foi atento, foi ansioso", "não era triste, era cansado",
 * "não é ansioso, é apatia", "quis dizer ansioso".
 * Só devolve correção quando a pessoa AFIRMA um termo novo — negação solta
 * ("não foi isso") continua sendo clarificação, não substituição.
 */
export function parseEmotionCorrection(text?: string | null): EmotionCorrection | null {
  const normalized = normalize(text ?? "");
  if (!normalized) return null;

  // O verbo se repete depois da negação: "não foi X, foi Y". Sem essa
  // exigência, "não foi fácil, mas consegui economizar" virava correção.
  const pair = normalized.match(
    /\bnao\s+(?:foi|era|e|eh|estava|esta|sou|estou)\s+([a-z]{3,20}(?:\s+[a-z]{2,20})?)\s*[,;]?\s*(?:mas\s+|e\s+)?(?:foi|era|e|eh|estava|esta|sou|estou)\s+([a-z]+(?:\s+[a-z]+)?)\b/,
  );
  if (pair) {
    const toTerm = pair[2].trim();
    return { fromTerm: pair[1].trim() || null, toTerm, option: resolveEmotionTerm(toTerm) };
  }

  const meant = normalized.match(/\b(?:quis dizer|queria dizer|na verdade (?:foi|era|estou|e))\s+([a-z]+(?:\s+[a-z]+)?)\b/);
  if (meant) {
    const toTerm = meant[1].trim();
    return { fromTerm: null, toTerm, option: resolveEmotionTerm(toTerm) };
  }

  return null;
}

const STOP_WORDS = new Set([
  "sim", "nao", "isso", "hoje", "agora", "muito", "bem", "mal", "mais", "menos",
  "estou", "estava", "sou", "fui", "foi", "era", "meio", "bastante", "ta", "to",
  "eu", "me", "senti", "sinto", "sentindo", "acho", "que", "assim", "de", "do",
  "da", "um", "uma", "e", "eh", "mas", "ainda", "tipo",
]);

export function emotionSlug(term: string): string {
  return normalize(term).replace(/[^a-z ]/g, "").replace(/\s+/g, "_").slice(0, 32);
}

/**
 * Palavra que a pessoa usou para nomear o sentimento e que o catálogo não
 * conhece ("apatia", "saudade"). Base do sentimento PESSOAL: nunca é
 * transformada em outra emoção por aproximação.
 */
export function candidateFeelingTerm(text?: string | null): string | null {
  const normalized = normalize(text ?? "");
  if (!normalized) return null;
  if (parseEmotionFromText(normalized)) return null;
  const words = normalized.split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  if (words.length !== 1) return null;
  return words[0];
}

/** Sentimento pessoal da pessoa vira uma opção com a mesma forma do catálogo. */
export function customEmotionOption(row: {
  emotion_key: string;
  label?: string | null;
  mood?: number | null;
  emoji?: string | null;
}): EmotionOption {
  const label = String(row.label ?? row.emotion_key);
  return {
    key: row.emotion_key,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    mood: Math.min(5, Math.max(1, Math.round(Number(row.mood ?? 3)))),
    emoji: row.emoji || "🫥",
    custom: true,
  };
}
