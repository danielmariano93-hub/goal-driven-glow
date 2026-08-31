// AnswerCompleteness (`nino_composite.v1`) — a resposta parcial deixa de passar
// por resposta final.
//
// Antes: o executor contava "quantas subtarefas responderam" e enviava. Se o
// usuário tinha 4 metas e a evidência cobria 1, ninguém percebia — e o Nino
// ainda fechava com "quer ver o detalhe de outra categoria?".
// deno-lint-ignore-file no-explicit-any
import {
  markResolved, REQUIRED_ANSWER_LABEL_PT,
  type Requirement, type RequiredAnswer,
} from "./AnalysisRequirements.ts";

export type CompletenessReport = {
  version: "answer_completeness.v1";
  required: number;
  resolved: number;
  partial: number;
  missing: RequiredAnswer[];
  score: number;
  status: "complete" | "partial" | "incomplete";
  /** Declaração honesta do que não foi possível fechar. */
  disclosure: string | null;
};

/** Marca os requisitos com base na evidência realmente produzida. */
export function evaluateRequirements(
  requirements: Requirement[],
  assessment: any,
  opts: { comparison_requested: boolean },
): Requirement[] {
  const categories: any[] = Array.isArray(assessment?.categories) ? assessment.categories : [];
  const required = categories.length;
  let out = requirements;

  if (required > 0) out = markResolved(out, "active_goals");

  const attainment = categories.filter((c) => c?.goal && typeof c.goal.target === "number").length;
  out = markResolved(out, "attainment_per_goal", { required, covered: attainment });

  if (opts.comparison_requested) {
    const compared = categories.filter((c) => c?.historical && typeof c.historical.previous === "number").length;
    out = markResolved(out, "historical_comparison_per_entity", { required, covered: compared });
  }

  if (assessment?.aggregate?.scope === "scoped_entities") out = markResolved(out, "scoped_aggregate");
  if (assessment?.conclusions?.behavioral_evolution) out = markResolved(out, "overall_interpretation");
  if (assessment?.conclusions?.strongest_improvement || assessment?.conclusions?.strongest_deterioration) {
    out = markResolved(out, "ranking");
  }
  if (assessment?.conclusions?.priority || required > 0) out = markResolved(out, "priority");

  return out;
}

export function checkCompleteness(requirements: Requirement[]): CompletenessReport {
  const required = requirements.length;
  const resolved = requirements.filter((r) => r.status === "resolved").length;
  const partial = requirements.filter((r) => r.status === "partial").length;
  const missing = requirements.filter((r) => r.status !== "resolved").map((r) => r.key);
  const score = required === 0 ? 1 : Math.round((resolved / required) * 100) / 100;
  const status: CompletenessReport["status"] = missing.length === 0
    ? "complete"
    : resolved > 0
      ? "partial"
      : "incomplete";
  const disclosure = missing.length
    ? `Não consegui fechar ${missing.map((k) => REQUIRED_ANSWER_LABEL_PT[k]).join(" e ")} agora.`
    : null;
  return { version: "answer_completeness.v1", required, resolved, partial, missing, score, status, disclosure };
}

/**
 * Proíbe pergunta de continuação quando o usuário já pediu TODAS as entidades.
 * O convite "quer ver outra categoria?" é justamente o sintoma de resposta
 * parcial que precisamos eliminar.
 */
const CONTINUATION_RX = /(quer(?:ia)?\s+ver\s+(?:o\s+)?(?:detalhe|detalhes)?[^?]*\?|quer\s+que\s+eu\s+(?:detalhe|abra|mostre)[^?]*\?)/gi;

export function stripUnwantedContinuation(text: string, opts: { entitiesFullyCovered: boolean }): string {
  if (!opts.entitiesFullyCovered) return text;
  return String(text ?? "").replace(CONTINUATION_RX, "").replace(/\n{3,}/g, "\n\n").trim();
}
