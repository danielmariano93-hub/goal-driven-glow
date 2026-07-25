import { interpretSemanticQuery } from "./semanticQuery.ts";
import { composeWeekdayPatternReply } from "./evidence.ts";
import type { ToolCallEvidence } from "./contracts.ts";
import type { WeekdayPatternResult } from "../analytics/weekdayPattern.ts";

export type ClaimValidation = { ok: boolean; reasons: string[]; safe_reply?: string };

export function validateAnalyticalClaims(
  reply: string,
  userText: string,
  toolCalls: ToolCallEvidence[] = [],
): ClaimValidation {
  const query = interpretSemanticQuery(userText);
  if (!query || query.intent !== "weekday_pattern") return { ok: true, reasons: [] };

  const robust = toolCalls.find(c => c.ok && c.tool_name === "get_weekday_spending_pattern");
  if (robust?.result) {
    const result = robust.result as WeekdayPatternResult;
    if (query.interpretation === "typical_behavior" && result.confidence === "insufficient" && /\b(geralmente|normalmente|costuma|seu dia)\b/i.test(reply)) {
      return {
        ok: false,
        reasons: ["typical_claim_with_insufficient_sample"],
        safe_reply: composeWeekdayPatternReply(result, query),
      };
    }
    return { ok: true, reasons: [] };
  }

  const hotspot = toolCalls.find(c => c.ok && c.tool_name === "get_spending_highlights");
  if (hotspot && query.interpretation === "typical_behavior") {
    return {
      ok: false,
      reasons: ["total_concentration_used_for_typical_behavior"],
      safe_reply: "Esse dado mostra apenas onde o valor total se concentrou. Ele pode ter sido puxado por uma compra atípica e não é suficiente para dizer em qual dia você normalmente gasta mais. Vou tratar média, recorrência e picos separadamente.",
    };
  }

  if (/\b(geralmente|normalmente|costuma)\b/i.test(reply) && /\b\d{1,3}%\b/.test(reply)) {
    return {
      ok: false,
      reasons: ["unsupported_typical_percentage_claim"],
      safe_reply: "Ainda não tenho uma análise robusta suficiente para chamar isso de padrão. Preciso separar concentração total, média por ocorrência e gastos atípicos antes de concluir.",
    };
  }
  return { ok: true, reasons: [] };
}
