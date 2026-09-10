// CATÁLOGO EMOCIONAL CANÔNICO — emotion_catalog.v1
// ================================================
// Fonte ÚNICA das emoções do Meu Nino. Toda superfície (Home, Emoções,
// WhatsApp, Nino) grava `emotion_key` deste catálogo e o `mood` derivado.
// `nino_language.v1`: ansiedade deixou de ser traduzida como "atento". Atento é
// atenção; ansioso é ansioso. Emoção que a pessoa insistir e não existir aqui
// vira sentimento PESSOAL dela (tabela `user_emotions`), nunca emoção global.
export const EMOTION_CATALOG_VERSION = "emotion_catalog.v3";

export interface EmotionOption {
  key: string;
  label: string;
  /** escala 1..5 usada nas correlações e no pulso */
  mood: number;
  emoji: string;
  /** chips primários aparecem sem precisar expandir */
  primary: boolean;
}

export const EMOTION_CATALOG: readonly EmotionOption[] = [
  { key: "tranquilo", label: "Tranquilo", mood: 5, emoji: "😌", primary: true },
  { key: "ansioso", label: "Ansioso", mood: 2, emoji: "😰", primary: true },
  { key: "atento", label: "Atento", mood: 3, emoji: "🧐", primary: true },
  { key: "preocupado", label: "Preocupado", mood: 1, emoji: "😟", primary: true },
  { key: "triste", label: "Triste", mood: 1, emoji: "😢", primary: false },
  { key: "confiante", label: "Confiante", mood: 4, emoji: "🙂", primary: false },
  { key: "impulsivo", label: "Impulsivo", mood: 2, emoji: "⚡", primary: false },
  { key: "frustrado", label: "Frustrado", mood: 1, emoji: "😤", primary: false },
  { key: "celebrando", label: "Celebrando", mood: 5, emoji: "🎉", primary: false },
  { key: "culpado", label: "Culpado", mood: 2, emoji: "😞", primary: false },
] as const;

export const PRIMARY_EMOTIONS = EMOTION_CATALOG.filter((e) => e.primary);
export const EXTRA_EMOTIONS = EMOTION_CATALOG.filter((e) => !e.primary);

/** Aliases legados (`trigger_label` antigo) → chave canônica. */
const ALIASES: Record<string, string> = {
  ansiosa: "ansioso",
  ansiedade: "ansioso",
  nervoso: "ansioso",
  nervosa: "ansioso",
  tenso: "ansioso",
  tensa: "ansioso",
  agitado: "ansioso",
  agitada: "ansioso",
  apreensivo: "ansioso",
  apreensiva: "ansioso",
  tédio: "impulsivo",
  tedio: "impulsivo",
  impulso: "impulsivo",
  celebração: "celebrando",
  celebracao: "celebrando",
  segurança: "confiante",
  seguranca: "confiante",
  culpa: "culpado",
  tranquilidade: "tranquilo",
  tristeza: "triste",
  desanimado: "triste",
};

export function resolveEmotion(value?: string | null): EmotionOption | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  const key = ALIASES[raw] ?? raw;
  return EMOTION_CATALOG.find((e) => e.key === key) ?? null;
}

export function emotionLabel(value?: string | null, fallbackMood?: number | null): string {
  const found = resolveEmotion(value);
  if (found) return `${found.emoji} ${found.label}`;
  if (fallbackMood != null) {
    const byMood = EMOTION_CATALOG.find((e) => e.mood === Number(fallbackMood));
    if (byMood) return `${byMood.emoji} ${byMood.label}`;
  }
  return value ?? "Sem registro";
}
