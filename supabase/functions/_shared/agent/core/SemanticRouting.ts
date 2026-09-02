// SemanticRouting (`nino_semantic_ir.v3`)
//
// Precedência do turno. Na v2, `rawDeterministic` e a allowlist `IR_REROUTABLE`
// impediam o compilador de ver parte dos READs financeiros — foi assim que
// "quanto gastei com transporte neste mês" virou saldo disponível. Na v3 todo
// READ financeiro elegível passa pelo compilador, exceto quando o Fast Path tem
// match de ALTÍSSIMA precisão.
//
// Política do Fast Path: falso negativo é aceitável; falso positivo não.
import { fastFinancialIR, type DialogueActLabel, type FinancialQueryIR } from "./FinancialQueryIR.ts";

/** Capabilities de escrita/confirmação/conversa seguem os contratos próprios. */
const NON_READ_CAPABILITIES = new Set([
  "transaction_entry", "transfer_entry", "goal_entry", "goal_contribution",
  "confirmation", "cancellation", "conversational", "emotional_checkin",
  "emotion_finance", "bulk_entry", "document_import", "audio_transcription",
]);

export function isSemanticReadEligible(args: {
  capability_name: string;
  acts: DialogueActLabel[];
  has_clarification: boolean;
}): boolean {
  if (args.has_clarification) return false;
  if (args.acts.includes("write") || args.acts.includes("conversational")) return false;
  return !NON_READ_CAPABILITIES.has(args.capability_name);
}

/**
 * Fast Path de alta precisão: métrica canônica única, sem group_by, sem filtro,
 * sem comparação, sem "por quê", sem investigação, sem repair e sem atualização
 * de restrição. Qualquer ambiguidade vai para o Semantic Compiler.
 */
export function fastPathIR(args: {
  text: string;
  acts: DialogueActLabel[];
  constraints: { period: boolean; dimension: boolean; entity: boolean };
  period: { from: string; to: string; label?: string };
  comparison_period?: { from: string; to: string; label?: string } | null;
}): FinancialQueryIR | null {
  if (args.acts.includes("repair") || args.acts.includes("clarification")) return null;
  if (args.acts.includes("constraint_update") || args.acts.includes("followup")) return null;
  if (args.constraints.period || args.constraints.dimension || args.constraints.entity) return null;
  const t = String(args.text ?? "").toLowerCase();
  if (/\b(por que|porque|por qu[eê]|compar|vs|versus|maior|mais|top|ranking|por categoria|por cart[aã]o|por conta|explica)\b/.test(t)) {
    return null;
  }
  const ir = fastFinancialIR(args.text, args.period, args.comparison_period ?? null);
  if (!ir) return null;
  const q = ir.queries[0];
  if (!q) return null;
  if (q.group_by.length || q.filters.length) return null;
  if (!["value", "sum"].includes(q.operation)) return null;
  return ir;
}
