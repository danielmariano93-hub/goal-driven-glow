// DialogueAct (`nino_semantic_ir.v2`) — classificação pequena, multi-label e
// conservadora. NÃO escolhe domínio, métrica, dimensão nem ferramenta.
// O objetivo é proteger estado conversacional e separar READ de WRITE.
import type { ParsedIntent } from "../parser.ts";

export type DialogueAct = {
  new_query: boolean;
  repair: boolean;
  clarification: boolean;
  write: boolean;
  conversational: boolean;
  confidence: number;
};

const REPAIR_RX =
  /\b(n[aã]o foi isso(?: que eu (?:perguntei|pedi))?|n[aã]o era isso|voc[eê] n[aã]o respondeu(?: o que eu perguntei)?|isso n[aã]o respondeu(?: minha pergunta)?|respondeu outra coisa|entendeu errado|faltou responder|eu perguntei .{0,40} n[aã]o|eu queria .{0,40} n[aã]o)\b/i;
const CLARIFICATION_RX =
  /\b(quis dizer|na verdade eu quis|corrigindo o que eu disse|melhor dizendo|quando eu disse .{0,30} quis dizer)\b/i;
const SMALL_TALK_RX =
  /^(oi|ol[aá]|bom dia|boa tarde|boa noite|obrigad[oa]?|valeu|show|perfeito|entendi|beleza|blz)[!. ]*$/i;
const FINANCIAL_ANCHOR =
  /\b(gast|despesa|receita|renda|saldo|categoria|estabelecimento|cart[aã]o|fatura|conta|d[ií]vida|meta|patrim[oô]nio|investimento|lan[cç]amento|transa[cç][aã]o|econom)\w*/i;

export function isExplicitRepair(text: string): boolean {
  return REPAIR_RX.test(String(text ?? "").trim());
}

export function classifyDialogueAct(text: string, parsed: ParsedIntent): DialogueAct {
  const raw = String(text ?? "").trim();
  const repair = isExplicitRepair(raw);
  const clarification = CLARIFICATION_RX.test(raw);
  const write = ["transaction", "transfer", "goal_contribution", "goal", "confirm", "cancel"]
    .includes(parsed.kind);
  const conversational = !write && SMALL_TALK_RX.test(raw);
  return {
    new_query: !repair && !clarification && !conversational,
    repair,
    clarification,
    write,
    conversational,
    confidence: write || repair || conversational ? 1 : 0.8,
  };
}

/**
 * Procura a pergunta financeira anterior mais próxima, ignorando small-talk e
 * outras mensagens de repair. É propositalmente uma janela curta; não pretende
 * substituir a futura pilha de Conversation State por tópico.
 */
export function findRepairBaseQuery(
  history: Array<{ role: string; content: string }>,
  current: string,
): string | null {
  const now = String(current ?? "").trim();
  for (const entry of [...(history ?? [])].reverse().slice(0, 12)) {
    if (entry.role !== "user") continue;
    const text = String(entry.content ?? "").trim();
    if (!text || text === now || SMALL_TALK_RX.test(text) || REPAIR_RX.test(text)) continue;
    if (FINANCIAL_ANCHOR.test(text)) return text;
  }
  return null;
}

export function repairEffectiveQuery(args: {
  current: string;
  previous_user_query?: string | null;
  act: DialogueAct;
}): string {
  if (!args.act.repair || !args.previous_user_query) return args.current;
  return [
    args.previous_user_query.trim(),
    "[CORREÇÃO DO USUÁRIO]",
    args.current.trim(),
  ].join("\n");
}
