// Deterministic continuation for analytical comparison follow-ups.
//
// The previous tool result is captured as structured evidence in the Reference
// Store. Follow-ups such as "qual ficou menos acima?", "quanto ela ficou?" and
// "são médias ou totais?" are answered from that evidence instead of asking an
// LLM to reconstruct money or methodology from conversation text.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type {
  ComparisonEvidence,
  ComparisonEvidenceRow,
  ReferenceObject,
} from "./ConversationReferenceStore.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedDirection(text: string): "increase" | "decrease" | null {
  const value = norm(text);
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

function requestedRank(text: string): { direction: "increase" | "decrease"; limit: number } | null {
  const value = norm(text);
  const match = /\b(?:top\s*)?(\d{1,2})\b/.exec(value);
  if (!match) return null;
  const limit = Math.max(1, Math.min(20, Number(match[1])));
  if (/\b(?:mais acima|maiores? altas?|mais aument\w*|que mais ficaram acima)\b/.test(value)) {
    return { direction: "increase", limit };
  }
  if (/\b(?:mais abaixo|maiores? quedas?|mais diminu\w*|que mais ficaram abaixo)\b/.test(value)) {
    return { direction: "decrease", limit };
  }
  return null;
}

function asksStatisticExplanation(text: string): boolean {
  const value = norm(text);
  const hasMean = /\b(?:media|medias|mensal|mensais)\b/.test(value);
  const hasTotal = /\b(?:total|totais|somados|soma)\b/.test(value);
  return (hasMean && hasTotal)
    || /\b(?:esses|esses valores|os valores).*(?:media|mensal|total)\b/.test(value);
}

function asksSelectedEntityAmount(text: string): boolean {
  const value = norm(text);
  const amount = /\b(?:quanto|valor|diferenca|delta)\b/.test(value);
  const relation = /\b(?:ela|ele|essa|esse|acima|abaixo|media)\b/.test(value);
  return amount && relation;
}

function samePeriod(
  a: { from: string; to: string } | null | undefined,
  b: { from: string; to: string } | null | undefined,
): boolean {
  return !!a && !!b && a.from === b.from && a.to === b.to;
}

function evidenceOf(reference: ReferenceObject): ComparisonEvidence | null {
  return reference.source?.context?.evidence ?? null;
}

function latestComparisonReference(memory: ConversationMemory): ReferenceObject | null {
  // loadConversationMemory/advanceReferences is the single authority that turns
  // TTL into status=expired. Avoid a second wall-clock decision here: it made
  // deterministic tests and adjacent follow-ups disagree at the exact boundary.
  const refs = (memory.references ?? [])
    .filter((ref) =>
      ref.status === "active"
      && ref.target === "category"
      && ref.entity_labels.length >= 1
      && /(?:^|\+)compare_(?:to_monthly_average|periods)(?:\+|$)/.test(String(ref.source?.tool_name ?? ""))
    );
  if (!refs.length) return null;

  return refs.sort((a, b) => {
    const aTopic = memory.active_topic_id && a.topic_id === memory.active_topic_id ? 1 : 0;
    const bTopic = memory.active_topic_id && b.topic_id === memory.active_topic_id ? 1 : 0;
    if (aTopic !== bTopic) return bTopic - aTopic;
    const aPeriod = a.source?.context?.target_period ?? a.source?.context?.period_b ?? null;
    const bPeriod = b.source?.context?.target_period ?? b.source?.context?.period_b ?? null;
    const aSame = samePeriod(aPeriod, memory.active_period) ? 1 : 0;
    const bSame = samePeriod(bPeriod, memory.active_period) ? 1 : 0;
    if (aSame !== bSame) return bSame - aSame;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  })[0] ?? null;
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
  const fromEvidence = Number(evidenceOf(reference)?.baseline_window_months);
  if (Number.isInteger(fromEvidence) && fromEvidence >= 2 && fromEvidence <= 24) return fromEvidence;
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
  category: string | null = null,
): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "converse",
    domain: "conversation",
    canonical_request: text,
    inherit_focus: true,
    focus: {
      category,
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
      entity: category ? "resolved" : "not_applicable",
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

function sortedRows(evidence: ComparisonEvidence, direction: "increase" | "decrease"): ComparisonEvidenceRow[] {
  const rows = [...evidence.rows];
  if (direction === "increase") {
    return rows.filter((row) => row.delta_abs > 0.005).sort((a, b) => b.delta_abs - a.delta_abs);
  }
  return rows.filter((row) => row.delta_abs < -0.005).sort((a, b) => a.delta_abs - b.delta_abs);
}

function rowForEntity(evidence: ComparisonEvidence, entity: string | null | undefined): ComparisonEvidenceRow | null {
  const wanted = norm(entity ?? "");
  if (!wanted) return null;
  return evidence.rows.find((row) => norm(row.name) === wanted) ?? null;
}

function relationWord(row: ComparisonEvidenceRow): string {
  return row.delta_abs >= 0 ? "acima" : "abaixo";
}

function rowReply(row: ComparisonEvidenceRow): string {
  return `*${row.name}* ficou ${BRL.format(Math.abs(row.delta_abs))} ${relationWord(row)} da referência: ${BRL.format(row.total_b)} versus ${BRL.format(row.total_a)}.`;
}

function statisticReply(evidence: ComparisonEvidence, months: number | null): string {
  if (evidence.comparison_alignment === "aligned_month_to_date") {
    return `Estou comparando valores acumulados até o mesmo dia do mês: o período atual até hoje contra a média do mesmo recorte nos ${months ?? "meses"} anteriores. Assim, mês parcial não é comparado com mês completo.`;
  }
  if (evidence.comparison_alignment === "preceding_rolling_window") {
    return `Estou comparando médias mensais de janelas equivalentes: a média mensal do período analisado contra a média mensal da janela imediatamente anterior. Não misturo total de vários meses com média de um mês.`;
  }
  return `São valores mensais comparáveis: o mês analisado contra a média mensal dos ${months ?? "meses"} meses completos anteriores. Não estou comparando um total de vários meses com uma média mensal.`;
}

export function resolveGroundedComparisonFollowup(
  text: string,
  memory: ConversationMemory | null,
): CanonicalConversationTurnContract | null {
  if (!memory) return null;
  const reference = latestComparisonReference(memory);
  if (!reference) return null;
  const tool = String(reference.source?.tool_name ?? "");
  const evidence = evidenceOf(reference);

  if (asksStatisticExplanation(text) && evidence) {
    return directReplyContract(text, statisticReply(evidence, historicalWindow(memory, reference)));
  }

  if (evidence && asksSelectedEntityAmount(text)) {
    const selected = rowForEntity(evidence, memory.active_category);
    if (selected) return directReplyContract(text, rowReply(selected), selected.name);
  }

  const leastDirection = requestedLeastDirection(text);
  if (leastDirection && evidence) {
    const rows = sortedRows(evidence, leastDirection);
    const selected = rows[rows.length - 1] ?? null;
    if (selected) return directReplyContract(text, rowReply(selected), selected.name);
  }

  const rank = requestedRank(text);
  if (rank && evidence) {
    const rows = sortedRows(evidence, rank.direction);
    if (rows.length >= rank.limit) {
      const selected = rows.slice(0, rank.limit);
      const lines = selected.map((row, index) => `${index + 1}. *${row.name}* — ${BRL.format(Math.abs(row.delta_abs))} ${relationWord(row)}`);
      return directReplyContract(text, lines.join("\n"));
    }
  }

  const direction = requestedDirection(text);
  if (direction && evidence) {
    const selected = sortedRows(evidence, direction)[0] ?? null;
    if (selected) return directReplyContract(text, rowReply(selected), selected.name);
  }

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
