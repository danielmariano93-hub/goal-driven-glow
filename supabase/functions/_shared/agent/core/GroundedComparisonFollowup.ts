// Deterministic continuation for a very narrow class of analytical follow-ups.
//
// The previous result already carries the engine and the entity set that the
// user saw. A phrase such as "qual delas ficou mais acima?" changes only two
// slots of that comparison: direction and limit. Asking the LLM to rebuild the
// whole financial contract here creates an avoidable semantic failure point.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { ReferenceObject } from "./ConversationReferenceStore.ts";

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedDirection(text: string): "increase" | "decrease" | null {
  const value = norm(text);
  if (!/\b(?:delas|dessas|destas|entre elas)\b/.test(value)) return null;
  if (/\b(?:mais acima|mais aument\w*|maior aument\w*|mais subiu|maior alta|mais piorou)\b/.test(value)) {
    return "increase";
  }
  if (/\b(?:mais abaixo|mais diminu\w*|maior diminu\w*|mais caiu|maior queda)\b/.test(value)) {
    return "decrease";
  }
  return null;
}

function latestComparisonReference(memory: ConversationMemory): ReferenceObject | null {
  const refs = (memory.references ?? [])
    .filter((ref) =>
      ref.status === "active"
      && ref.turns_remaining > 0
      && ref.target === "category"
      && ref.entity_labels.length > 1
      && /(?:^|\+)compare_(?:to_monthly_average|periods)(?:\+|$)/.test(String(ref.source?.tool_name ?? ""))
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return refs[0] ?? null;
}

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

function periodLabel(period: { from: string; to: string; label?: string | null } | null | undefined): string | null {
  const explicit = String(period?.label ?? "").trim();
  if (explicit) return explicit;
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(period?.from ?? ""));
  if (!match) return null;
  const month = MONTHS_PT[Number(match[2]) - 1];
  return month ? `${month} de ${match[1]}` : null;
}

function historicalWindow(memory: ConversationMemory, reference: ReferenceObject): number | null {
  const fromContext = Number(reference.source?.context?.months);
  if (Number.isInteger(fromContext) && fromContext >= 2 && fromContext <= 24) return fromContext;
  const summary = norm(memory.conversation_summary ?? "");
  const match = /media (?:dos )?(?:ultimos )?(\d{1,2}) meses/.exec(summary);
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value >= 2 && value <= 24 ? value : null;
}

function comparisonQuery(args: {
  direction: "increase" | "decrease";
  baseline: "period" | "mean_previous_complete_months";
  months?: number | null;
  baselineLabel?: string | null;
  targetLabel: string;
}) {
  return {
    metric: "expense_amount" as const,
    operation: "compare" as const,
    group_by: ["category" as const],
    filters: [],
    limit: 1,
    comparison_direction: args.direction,
    comparison_baseline: args.baseline,
    comparison_baseline_window: args.baseline === "mean_previous_complete_months" ? args.months ?? null : null,
    comparison_baseline_expression: args.baseline === "period" ? args.baselineLabel ?? null : null,
    comparison_target_expression: args.targetLabel,
  };
}

export function resolveGroundedComparisonFollowup(
  text: string,
  memory: ConversationMemory | null,
): CanonicalConversationTurnContract | null {
  const direction = requestedDirection(text);
  if (!direction || !memory) return null;
  const reference = latestComparisonReference(memory);
  if (!reference) return null;

  const context = reference.source?.context ?? null;
  const tool = String(reference.source?.tool_name ?? "");
  const targetPeriod = context?.target_period ?? context?.period_b ?? memory.active_period;
  const targetLabel = periodLabel(targetPeriod);
  if (!targetLabel) return null;

  let baseline: "period" | "mean_previous_complete_months";
  let baselineLabel: string | null = null;
  let months: number | null = null;
  let canonical: string;
  let periodExpressions: string[];

  if (tool.includes("compare_to_monthly_average")) {
    baseline = "mean_previous_complete_months";
    months = historicalWindow(memory, reference);
    if (!months) return null;
    canonical = direction === "increase"
      ? `Qual categoria ficou mais acima da média dos últimos ${months} meses em ${targetLabel}?`
      : `Qual categoria ficou mais abaixo da média dos últimos ${months} meses em ${targetLabel}?`;
    periodExpressions = [targetLabel];
  } else if (tool.includes("compare_periods")) {
    baseline = "period";
    const comparisonPeriod = context?.period_a ?? memory.comparison_period;
    baselineLabel = periodLabel(comparisonPeriod);
    if (!baselineLabel) return null;
    canonical = direction === "increase"
      ? `Qual categoria mais aumentou de ${baselineLabel} para ${targetLabel}?`
      : `Qual categoria mais diminuiu de ${baselineLabel} para ${targetLabel}?`;
    periodExpressions = [baselineLabel, targetLabel];
  } else {
    return null;
  }

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: canonical,
    inherit_focus: true,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: periodExpressions[0],
      period_expressions: periodExpressions,
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "resolved",
      time: "resolved",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: {
      kind: "previous_result_set",
      target: "category",
      expression: /\bdelas\b/i.test(text) ? "delas" : "essas categorias",
      status: "resolved",
    },
    financial_read: {
      intent: "analyze",
      queries: [comparisonQuery({ direction, baseline, months, baselineLabel, targetLabel })],
    },
    advisory_kind: null,
  });
}
