// SemanticAnswerFormatter (`nino_semantic_ir.v3`)
//
// Response Generation do caminho semântico: texto determinístico a partir do
// resultado do motor. A LLM não recebe catálogo de tools nem reescreve número.
// Sem formatter específico, cai na headline canônica do próprio motor.
// deno-lint-ignore-file no-explicit-any
import {
  formatFinancialSnapshot, formatForecastMonthClose, formatGoalsOverview,
  formatMerchantDistribution, formatSpendingAnalysis, formatEngineNarrative,
} from "./DeterministicAnswers.ts";

const FORMATTERS: Record<string, (result: any) => string | null> = {
  analyze_spending: formatSpendingAnalysis,
  analyze_merchants: formatMerchantDistribution,
  get_financial_snapshot: formatFinancialSnapshot,
  get_goals_overview: formatGoalsOverview,
  forecast_month_close: formatForecastMonthClose,
};

function headline(result: any): string | null {
  const h = result?.answer_format?.headline ?? result?.headline;
  return typeof h === "string" && h.trim().length > 8 ? h.trim() : null;
}

export function semanticBlockText(engine: string | null, result: unknown): string | null {
  if (!engine || !result) return null;
  const formatter = FORMATTERS[engine];
  if (formatter) {
    try {
      const text = formatter(result as any);
      if (text && text.trim()) return text.trim();
    } catch { /* cai para narrativa/headline canônica */ }
  }
  try {
    const narrative = formatEngineNarrative(result as any);
    if (narrative && narrative.trim()) return narrative.trim();
  } catch { /* ignore */ }
  return headline(result);
}
