// NarrativeVariation (`nino_narrative.v1`)
//
// Variação de forma, nunca de fato: abertura, estrutura e pergunta rodam por
// usuário + assunto para o Nino não repetir "Notei que..." toda semana.
import type { NarrativeTone } from "./TonePolicy.ts";

const OPENINGS: Record<NarrativeTone, string[]> = {
  risk: ["Preciso te mostrar uma coisa:", "Olhei seu mês e tem um ponto apertado:", "Vale sua atenção agora:"],
  attention: ["Reparei numa mudança de ritmo:", "Seu mês mudou de padrão:", "Tem algo diferente por aqui:"],
  achievement: ["Boa:", "Isso merece registro:", "Você segurou bem:"],
  behavior: ["Notei um padrão seu:", "Tem um comportamento se repetindo:", "Percebi uma tendência sua:"],
  goal: ["Sobre a sua meta:", "Sua meta pede uma decisão:", "Atualizando sua meta:"],
  opportunity: ["Encontrei um espaço aqui:", "Tem dinheiro parado num lugar evitável:", "Dá pra ganhar folga aqui:"],
  report: ["Fechando o período:", "Resumo do período:", "O que mudou no período:"],
};

const STRUCTURES = ["conclusion_first", "observation_then_number", "context_then_conclusion"] as const;
export type NarrativeStructure = typeof STRUCTURES[number];

const STRUCTURE_GUIDANCE: Record<NarrativeStructure, string> = {
  conclusion_first: "Comece pela conclusão, depois um único número de prova.",
  observation_then_number: "Comece pela observação do padrão, depois o número que a sustenta.",
  context_then_conclusion: "Comece pelo contexto do período, depois a conclusão.",
};

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export type VariationChoice = {
  opening: string;
  structure: NarrativeStructure;
  structure_guidance: string;
  variant_index: number;
};

/**
 * Escolha determinística e estável por usuário+assunto, deslocada pelo número
 * de entregas recentes do mesmo assunto (histórico curto anti-repetição).
 */
export function chooseVariation(args: {
  userId: string;
  subjectKey: string;
  tone: NarrativeTone;
  recentSameSubject?: number;
}): VariationChoice {
  const base = hash(`${args.userId}:${args.subjectKey}`) + Math.max(0, args.recentSameSubject ?? 0);
  const openings = OPENINGS[args.tone];
  const opening = openings[base % openings.length];
  const structure = STRUCTURES[(base + 1) % STRUCTURES.length];
  return {
    opening,
    structure,
    structure_guidance: STRUCTURE_GUIDANCE[structure],
    variant_index: base % openings.length,
  };
}
