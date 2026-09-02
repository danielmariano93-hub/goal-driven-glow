// ClarificationResponse (`nino_semantic_ir.v3`)
//
// Pergunta determinística quando o IR marca slot ambíguo. Nenhum motor
// financeiro roda antes da escolha: perguntar é mais barato e mais honesto do
// que calcular o recorte errado.
export const MAX_CLARIFICATION_OPTIONS = 5;

export type ClarificationSlot = "card" | "account" | "category" | "period" | "goal" | "unknown";

const PROMPTS: Record<ClarificationSlot, (options: string[]) => string> = {
  card: (o) => o.length
    ? `Você tem mais de um cartão. Qual deles: ${o.join(", ")}?`
    : "De qual cartão você quer falar?",
  account: (o) => o.length
    ? `Qual conta você quer usar: ${o.join(", ")}?`
    : "De qual conta você quer falar?",
  category: (o) => o.length
    ? `Qual categoria você quer ver: ${o.join(", ")}?`
    : "De qual categoria você quer falar?",
  period: (o) => o.length
    ? `Qual período você quer considerar: ${o.join(", ")}?`
    : "Qual período você quer considerar?",
  goal: (o) => o.length
    ? `Qual meta você quer olhar: ${o.join(", ")}?`
    : "Qual meta você quer olhar?",
  unknown: () => "Me diz só um detalhe pra eu não te dar o número errado: sobre o que exatamente você quer ver?",
};

export function normalizeSlot(raw: string): ClarificationSlot {
  const t = String(raw ?? "").toLowerCase();
  if (/cart|credit/.test(t)) return "card";
  if (/conta|account/.test(t)) return "account";
  if (/categor/.test(t)) return "category";
  if (/per[ií]odo|data|m[eê]s|period/.test(t)) return "period";
  if (/meta|goal/.test(t)) return "goal";
  return "unknown";
}

export type ClarificationQuestion = {
  version: "nino_clarification.v1";
  slot: ClarificationSlot;
  options: string[];
  reply: string;
};

export function buildClarification(args: {
  slot: string;
  options?: string[];
}): ClarificationQuestion {
  const slot = normalizeSlot(args.slot);
  const options = [...new Set((args.options ?? []).map((o) => String(o).trim()).filter(Boolean))]
    .slice(0, MAX_CLARIFICATION_OPTIONS);
  return {
    version: "nino_clarification.v1",
    slot,
    options,
    reply: PROMPTS[slot](options),
  };
}
