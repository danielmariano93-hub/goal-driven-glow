// Explicit response-preference learning.
//
// Only first-person/meta-instructions are accepted. This prevents ordinary
// financial text ("gastei pouco", "quero mais renda") from mutating how Nino
// speaks. The output maps directly to user_ai_preferences.
import type { Preferences } from "./PersonalizationEngine.ts";

export type LearnedResponsePreference = {
  patch: Partial<Preferences>;
  evidence: string;
};

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

const META_RX =
  /\b(prefiro|eu prefiro|quero que (?:voce|vc)|responda|me responda|seja|fale comigo|explique|pode (?:me )?(?:responder|explicar|sugerir)|nao (?:quero|precisa) que (?:voce|vc)|evite|pare de)\b/;

export function detectResponsePreference(text: string): LearnedResponsePreference | null {
  const t = norm(text);
  if (!t || !META_RX.test(t)) return null;

  const patch: Partial<Preferences> = {};

  if (/\b(curta|curtas|curto|direta|diretas|direto|objetiva|objetivas|objetivo|sem textao|sem texto grande|menos detalhes|mais resumid[oa]s?)\b/.test(t)) {
    patch.verbosity = "concise";
  } else if (/\b(detalhada|detalhadas|detalhado|detalhados|mais detalhes|aprofund|explique melhor|explicacao completa|resposta completa)\b/.test(t)) {
    patch.verbosity = "detailed";
  }

  if (/\b(mais tecnic[oa]|nivel avancado|pode usar jargao|termos tecnicos|seja tecnic[oa])\b/.test(t)) {
    patch.technical_level = "advanced";
    patch.explanation_style = "technical";
  } else if (/\b(linguagem simples|sem jargao|menos tecnic[oa]|explica simples|explique simples|mais simples)\b/.test(t)) {
    patch.technical_level = "basic";
    patch.explanation_style = "plain";
  }

  if (/\b(nao sugira|sem sugestoes|pare de sugerir|so responda|apenas responda|nao precisa sugerir|menos sugestoes)\b/.test(t)) {
    patch.suggestion_frequency = "low";
  } else if (/\b(pode sugerir|me de sugestoes|quero sugestoes|traga sugestoes|sugira proximos passos|proximos passos)\b/.test(t)) {
    patch.suggestion_frequency = "high";
  }

  if (/\b(mais formal|seja formal|tom formal)\b/.test(t)) {
    patch.tone = "formal";
  } else if (/\b(mais humano|mais natural|mais amigavel|tom amigavel|mais acolhedor)\b/.test(t)) {
    patch.tone = "friendly";
  } else if (/\b(tom neutro|mais neutro|seja neutro)\b/.test(t)) {
    patch.tone = "neutral";
  }

  if (!Object.keys(patch).length) return null;
  return { patch, evidence: String(text ?? "").trim().slice(0, 300) };
}
