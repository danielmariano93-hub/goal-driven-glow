// Deterministic continuation for a narrow class of analytical follow-ups.
//
// The previous result already carries the engine and the entity set that the
// user saw. Follow-ups that only change the comparison superlative or ask what
// statistic was used must not be recompiled by an LLM: doing so creates an
// avoidable semantic failure point and can contradict the executed engine.

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

function requestedLeastDirection(text: string): "increase" | "decrease" | null {
  const value = norm(text);
  if (/\b(?:menos acima|menor alta|menos aument\w*|menor aument\w*|menos subiu)\b/.test(value)) {
    return "increase";
  }
  if (/\b(?:menos abaixo|menor queda|menos diminu\w*|menor diminu\w*|menos caiu)\b/.test(value)) {
    return "decrease";
  }
  return null;
}

function asksStatisticExplanation(text: string): boolean {
  const value = norm(text);
  const hasMean = /\b(?:media|medias|mensal|mensais)\b/.test(value);
  const hasTotal = /\b(?:total|totais|somados|soma)\b/.test(value);
  return hasMean && hasTotal
    || /\b(?:esses|esses valores|os valores).*(?:media|mensal|total)\b/.test(value);
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

const MONTH_NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};

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
  const match = /media (?:dos )?(?:ultimos )?(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) meses?/.exec(summary);
  const raw = match?.[1] ?? "";
  const value = MONTH_NUMBER_WORDS[raw] ?? Number(raw);
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

function directReplyContract(
  text: string,
  reply: string,
): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "converse",
    domain: "conversation",
    canonical_request: text,
    inherit_focus: true,
    focus: {
      category: null,
      merchant: null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: reply,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: "resolved",
      time: "not_applicable",
      entity: "not_applicable",
      action: "not_applicable",
    },
    reference: {
      kind: "previous_result_set",
      target: "category",
      expression: "resultado anterior",
      status: "resolved",
    },
    financial_read: null,
    advisory_kind: null,
  });
}

export function resolveGroundedComparisonFollowup(
  text: string,
  memory: ConversationMemory | null,
): CanonicalConversationTurnContract | null {
  if (!memory) return null;
  const reference = latestComparisonReference(memory);
  if (!reference) return null;
  const tool = String(reference.source?.tool_name ?? "");

  // Meta-pergunta sobre a conta que acabou de ser exibida. A resposta vem do
  // contrato do motor, não de uma nova interpretação da LLM.
  if (asksStatisticExplanation(text) && tool.includes("compare_to_monthly_average")) {
    const months = historicalWindow(memory, reference);
    const suffix = months ? ` dos ${months} meses completos anteriores` : " dos meses completos anteriores";
    return directReplyContract(
      text,
      `São médias mensais dos dois lados. O período analisado é normalizado para uma média mensal e comparado com a média mensal${suffix}. Não estou comparando o total de vários meses com a média de um único mês.`,
    );
  }

  // "menos acima" / "menos abaixo" é uma seleção do conjunto que o usuário
  // acabou de ver. Esse conjunto já está ordenado pelo formatter canônico, então
  // o último item é o menor desvio dentro da direção exibida. Não recalculamos
  // dinheiro pela memória: respondemos apenas a entidade pedida.
  const leastDirection = requestedLeastDirection(text);
  if (leastDirection) {
    const summary = norm(memory.conversation_summary ?? "");
    const summaryMatchesDirection = leastDirection === "increase"
      ? /\b(?:acima|aument\w*|subiu|alta)\b/.test(summary)
      : /\b(?:abaixo|diminu\w*|caiu|queda)\b/.test(summary);
    if (summaryMatchesDirection) {
      const entity = reference.entity_labels[reference.entity_labels.length - 1];
      if (entity) {
        const phrase = leastDirection === "increase" ? "menos acima" : "menos abaixo";
        return directReplyContract(
          text,
          `Entre as categorias que eu tinha acabado de listar, a que ficou ${phrase} foi *${entity}*.`,
        );
      }
    }
  }

  const direction = requestedDirection(text);
  if (!direction) return null;

  const context = reference.source?.context ?? null;
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
