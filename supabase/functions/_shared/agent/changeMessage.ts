// nino_change_agent.v1 — ponte entre estratégia comportamental e comunicação real.
//
// A moldura (valor, estágio, ação, rota) vem SEMPRE do motor determinístico.
// Esta camada só decide COMO falar: princípio, objetivo de comunicação e o que
// é proibido. Nenhum número nasce aqui e nenhum número pode nascer da LLM.
// deno-lint-ignore-file no-explicit-any

export type CommunicationInstruction = {
  principle: string;
  strategy: string;
  communication_goal: string;
  prohibited_patterns: string[];
  context_for_llm: string;
};

export function asCommunicationInstruction(value: unknown): CommunicationInstruction | null {
  const raw = (value ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  const principle = String(raw.principle ?? "").trim();
  const strategy = String(raw.strategy ?? "").trim();
  if (!principle || !strategy) return null;
  return {
    principle,
    strategy,
    communication_goal: String(raw.communication_goal ?? "").trim(),
    prohibited_patterns: Array.isArray(raw.prohibited_patterns)
      ? raw.prohibited_patterns.map((p) => String(p)).filter(Boolean)
      : [],
    context_for_llm: String(raw.context_for_llm ?? "").trim(),
  };
}

/** Extrai a instrução de comunicação de uma evidência de situação/candidato. */
export function instructionFromEvidence(evidence: unknown): CommunicationInstruction | null {
  const ev = (evidence ?? {}) as Record<string, unknown>;
  return asCommunicationInstruction(ev.communication_instruction ?? ev.behavioral_intervention);
}

// ---------------------------------------------------------------------------
// Fechamento por estratégia. Texto de abordagem, nunca de cálculo.
// ---------------------------------------------------------------------------
const STRATEGY_CLOSING: Record<string, string> = {
  reinforce: "Isso é evidência do que você já consegue repetir — não precisa de esforço novo.",
  remind: "Sem cobrança: é só retomar de onde combinamos.",
  reframe: "Em vez de repetir o mesmo pedido, vale começar por um passo menor e com menos fricção.",
  pause: "Fico à disposição quando você quiser retomar.",
};

/**
 * Compõe o corpo da mensagem de mudança a partir do texto determinístico do
 * motor + a abordagem escolhida pela estratégia comportamental.
 */
export function composeChangeMessage(args: {
  baseMessage: string;
  instruction: CommunicationInstruction | null;
}): string {
  const base = String(args.baseMessage ?? "").trim();
  const instruction = args.instruction;
  if (!instruction) return base;
  const closing = STRATEGY_CLOSING[instruction.strategy] ?? "";
  if (!closing || base.includes(closing)) return base;
  return `${base}\n\n${closing}`.trim();
}

/** Bloco de instrução para a camada de linguagem (LLM). Nunca contém número novo. */
export function buildCommunicationInstructionPrompt(instruction: CommunicationInstruction): string {
  return [
    "[INSTRUÇÃO DE COMUNICAÇÃO COMPORTAMENTAL — nino_change_agent.v1]",
    instruction.context_for_llm,
    "Você pode adaptar linguagem, tom e naturalidade.",
    "Você NÃO pode: recalcular valor, criar valor ou percentual novo, trocar o estágio,",
    "alterar a prioridade, criar outra recomendação financeira nem violar as proibições acima.",
    "O valor e a ação vêm do motor determinístico; repita-os exatamente como recebidos.",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Guarda: texto humanizado não pode violar as proibições nem inventar número.
// ---------------------------------------------------------------------------
const MORALIZING = /\b(culpa|culpado|vergonha|irresponsáve|indisciplina|você deveria ter|falhou|preguiç)/i;

function moneyTokens(text: string): string[] {
  return (text.match(/(?:R\$\s?)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g) ?? [])
    .map((t) => t.replace(/\s/g, ""))
    .filter((t) => /\d/.test(t));
}

export function violatesCommunicationInstruction(args: {
  candidateText: string;
  baseText: string;
  instruction: CommunicationInstruction | null;
}): { violates: boolean; reason: string | null } {
  const text = String(args.candidateText ?? "");
  if (!text.trim()) return { violates: true, reason: "empty_text" };
  if (MORALIZING.test(text)) return { violates: true, reason: "moralizing_language" };
  if (/\d+\s?%/.test(text) && !/\d+\s?%/.test(args.baseText)) {
    return { violates: true, reason: "invented_percentage" };
  }
  const allowed = new Set(moneyTokens(args.baseText));
  for (const token of moneyTokens(text)) {
    if (!allowed.has(token)) return { violates: true, reason: `invented_amount:${token}` };
  }
  return { violates: false, reason: null };
}

/**
 * Aplica a instrução ao texto entregue. Se o texto humanizado viola a moldura,
 * volta ao determinístico — a verdade nunca perde para a fluidez.
 */
export function applyCommunicationInstruction(args: {
  renderedBody: string;
  deterministicBody: string;
  instruction: CommunicationInstruction | null;
}): { body: string; applied: boolean; fallback_reason: string | null } {
  const instruction = args.instruction;
  if (!instruction) return { body: args.renderedBody, applied: false, fallback_reason: null };

  const guard = violatesCommunicationInstruction({
    candidateText: args.renderedBody,
    baseText: args.deterministicBody,
    instruction,
  });
  if (guard.violates) {
    return {
      body: composeChangeMessage({ baseMessage: args.deterministicBody, instruction }),
      applied: true,
      fallback_reason: guard.reason,
    };
  }
  return {
    body: composeChangeMessage({ baseMessage: args.renderedBody, instruction }),
    applied: true,
    fallback_reason: null,
  };
}
