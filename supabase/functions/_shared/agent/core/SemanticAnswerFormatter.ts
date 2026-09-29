// SemanticAnswerFormatter (`nino_semantic_ir.v4`)
//
// Deterministic response generation from engine evidence. The LLM never
// recalculates or rewrites monetary truth.
// deno-lint-ignore-file no-explicit-any
import {
  formatFinancialSnapshot, formatForecastMonthClose, formatGoalsOverview,
  formatMerchantDistribution, formatSpendingAnalysis, formatEngineNarrative,
} from "./DeterministicAnswers.ts";
import {
  formatAverageComparisonEnhanced,
  formatPeriodComparisonEnhanced,
} from "./ComparisonPresentation.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDebtStatus(result: any): string | null {
  const facts = result?.facts ?? null;
  const rows = Array.isArray(result?.breakdown) ? result.breakdown : [];
  if (!facts) return null;
  const count = Number(facts.debts_analyzed ?? rows.length ?? 0);
  if (count <= 0) return "Você não tem dívidas ativas registradas.";
  const total = Number(facts.total_outstanding ?? rows.reduce((sum: number, row: any) => sum + Number(row?.outstanding_balance ?? 0), 0));
  const visible = rows.slice(0, 8).map((row: any) => {
    const name = String(row?.name ?? "Dívida").trim();
    const outstanding = Number(row?.outstanding_balance ?? 0);
    return `• ${name}: ${BRL.format(outstanding)}`;
  }).join("\n");
  const more = rows.length > 8 ? `\n• +${rows.length - 8} outra(s)` : "";
  return `Você tem ${count} dívida(s) ativa(s), com saldo total de ${BRL.format(total)}.${visible ? `\n\n${visible}${more}` : ""}`;
}

const FORMATTERS: Record<string, (result: any) => string | null> = {
  analyze_spending: formatSpendingAnalysis,
  merchant_distribution: formatMerchantDistribution,
  compare_to_monthly_average: formatAverageComparisonEnhanced,
  get_financial_snapshot: formatFinancialSnapshot,
  get_goals_overview: formatGoalsOverview,
  get_debt_status: formatDebtStatus,
  forecast_month_close: formatForecastMonthClose,
  compare_periods: formatPeriodComparisonEnhanced,
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
    } catch { /* fallback to canonical narrative/headline */ }
  }
  try {
    const narrative = formatEngineNarrative(result as any);
    if (narrative && narrative.trim()) return narrative.trim();
  } catch { /* ignore */ }
  return headline(result);
}
