// DialogueAct (`nino_semantic_ir.v2`) — classificação pequena, multi-label e
// conservadora. NÃO escolhe domínio, métrica, dimensão nem ferramenta.
// O objetivo é proteger estado conversacional e separar READ de WRITE.
import type { ParsedIntent } from "../parser.ts";
import { isExplicitRepair, isExplicitSubstitution } from "./ConversationRepair.ts";
export { isExplicitRepair, isExplicitSubstitution };

export type DialogueAct = {
  new_query: boolean;
  repair: boolean;
  clarification: boolean;
  write: boolean;
  conversational: boolean;
  confidence: number;
};

const CLARIFICATION_RX =
  /\b(quis dizer|na verdade eu quis|corrigindo o que eu disse|melhor dizendo|quando eu disse .{0,30} quis dizer)\b/i;
const SMALL_TALK_RX =
  /^(oi|ol[aá]|bom dia|boa tarde|boa noite|obrigad[oa]?|valeu|show|perfeito|entendi|beleza|blz)[!. ]*$/i;
const FINANCIAL_ANCHOR =
  /\b(gast|despesa|receita|renda|saldo|categoria|estabelecimento|cart[aã]o|fatura|conta|d[ií]vida|meta|patrim[oô]nio|investimento|lan[cç]amento|transa[cç][aã]o|econom)\w*/i;

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
    if (!text || text === now || SMALL_TALK_RX.test(text) || isExplicitRepair(text)) continue;
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

// ---------------------------------------------------------------------------
// `nino_semantic_ir.v3` — Dialogue State MULTI-LABEL.
// Uma mensagem pode ser repair + constraint_update ("não foi isso, eu queria
// por cartão nos últimos 90 dias"): o repair é preservado E a nova restrição é
// aplicada. Reduzir isso a um enum único era o que fazia o Nino perder metade
// da correção do usuário.
// ---------------------------------------------------------------------------
import type { DialogueActLabel } from "./FinancialQueryIR.ts";

export type DialogueConstraintHints = {
  period: boolean;
  dimension: boolean;
  entity: boolean;
};

export type DialogueState = {
  version: "nino_dialogue_state.v1";
  acts: DialogueActLabel[];
  constraints: DialogueConstraintHints;
  confidence: number;
};

const FOLLOWUP_RX =
  /^(e |mas |entao |então )|\b(e (?:no|na|nos|nas|em|do|da) |e quanto|e sobre|e (?:o|a) (?:mesma|mesmo)|desses|desse|dessa|nesse mesmo)\b/i;

// Fragmentos que só fazem sentido em relação ao foco anterior. Eles não
// carregam categoria/período próprios e, portanto, não podem ser promovidos a
// "novo tópico" apenas por não começarem com "e". Exemplos reais:
// "Quais os estabelecimentos?", "Por quê?", "Qual deles?".
const ELLIPTICAL_FOLLOWUP_RX =
  /^(?:quais?\s+(?:os\s+|as\s+)?(?:estabelecimentos?|locais|lugares|com[eé]rcios?|lojas?|restaurantes?|apps?|aplicativos?|servi[cç]os?)|qual\s+(?:deles|delas)|quais\s+(?:deles|delas)|por\s+qu[eê]|porque|e?\s*no\s+m[eê]s\s+passado|e?\s*na\s+semana\s+passada)\s*[?!.]*$/i;

const PERIOD_CONSTRAINT_RX =
  /\b(ultimos? \d+ dias|[uú]ltimos? \d+ dias|neste m[eê]s|nesse m[eê]s|m[eê]s passado|este ano|ano passado|em \d{4}|de \d{1,2}\/\d{1,2}|semana|trimestre|90 dias|30 dias|60 dias)\b/i;
const DIMENSION_CONSTRAINT_RX =
  /\b(por cart[aã]o|por conta|por categoria|por estabelecimento|s[oó] (?:cr[eé]dito|d[eé]bito))\b/i;
const ENTITY_CONSTRAINT_RX =
  /\b(no cart[aã]o [\wÀ-ú]+|na conta [\wÀ-ú]+|em [A-ZÀ-Ú][\wÀ-ú]{2,})\b/;

export function dialogueActLabels(act: DialogueAct): DialogueActLabel[] {
  const labels: DialogueActLabel[] = [];
  if (act.repair) labels.push("repair");
  if (act.clarification) labels.push("clarification");
  if (act.write) labels.push("write");
  if (act.conversational) labels.push("conversational");
  if (act.new_query) labels.push("new_query");
  return labels;
}

export function classifyDialogueState(text: string, parsed: ParsedIntent): DialogueState {
  const raw = String(text ?? "").trim();
  const act = classifyDialogueAct(raw, parsed);
  const acts = new Set<DialogueActLabel>(dialogueActLabels(act));

  const constraints: DialogueConstraintHints = {
    period: PERIOD_CONSTRAINT_RX.test(raw),
    dimension: DIMENSION_CONSTRAINT_RX.test(raw),
    entity: ENTITY_CONSTRAINT_RX.test(raw),
  };
  if (!act.write && !act.conversational
    && (constraints.period || constraints.dimension || constraints.entity)) {
    acts.add("constraint_update");
  }
  if (!act.write && !act.conversational && (FOLLOWUP_RX.test(raw) || ELLIPTICAL_FOLLOWUP_RX.test(raw))) {
    acts.add("followup");
    // Follow-up não é pergunta nova: continua o tópico.
    acts.delete("new_query");
  }
  if (act.repair) acts.delete("new_query");

  return {
    version: "nino_dialogue_state.v1",
    acts: [...acts],
    constraints,
    confidence: act.confidence,
  };
}
