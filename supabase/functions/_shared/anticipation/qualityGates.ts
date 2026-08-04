// anticipation_contract.v1 — portões de qualidade de dados.
// Nenhum padrão é publicado sobre dado ruim: sem cobertura de categorização,
// sem amostra e sem janela mínima, o motor simplesmente não fala.

import type { DailyFact, DetectorConfig } from "./contracts.ts";

export type QualityReport = {
  ok: boolean;
  reasons: string[];
  coverage: number;
  days_with_data: number;
  window_days: number;
  amount_uncategorized: number;
};

export function assessDataQuality(
  days: DailyFact[],
  opts: { minCoverage?: number; minWindowDays?: number; minDaysWithData?: number } = {},
): QualityReport {
  const minCoverage = opts.minCoverage ?? 0.85;
  const minWindowDays = opts.minWindowDays ?? 56;
  const minDaysWithData = opts.minDaysWithData ?? 20;

  const reasons: string[] = [];
  const withData = days.filter((d) => d.entries_count > 0);
  const totalConsumption = withData.reduce((s, d) => s + d.total_consumption, 0);
  const uncategorized = withData.reduce((s, d) => s + Math.abs(d.amount_uncategorized), 0);
  const denominator = totalConsumption + uncategorized;
  const coverage = denominator > 0 ? Math.max(0, 1 - uncategorized / denominator) : 0;

  const windowDays = days.length === 0
    ? 0
    : Math.round(
      (Date.parse(days[days.length - 1].local_date) - Date.parse(days[0].local_date)) / 86_400_000,
    ) + 1;

  if (windowDays < minWindowDays) reasons.push("insufficient_window");
  if (withData.length < minDaysWithData) reasons.push("insufficient_days_with_data");
  if (coverage < minCoverage) reasons.push("low_categorization_coverage");
  if (denominator <= 0) reasons.push("no_behavioral_amount");

  return {
    ok: reasons.length === 0,
    reasons,
    coverage: Math.round(coverage * 100) / 100,
    days_with_data: withData.length,
    window_days: windowDays,
    amount_uncategorized: Math.round(uncategorized * 100) / 100,
  };
}

/** Um detector só roda quando a qualidade atende o próprio limiar dele. */
export function detectorEligible(report: QualityReport, config: DetectorConfig): boolean {
  return report.coverage >= config.min_coverage
    && report.window_days >= config.min_window_days
    && report.days_with_data >= Math.max(8, Math.floor(config.min_window_days / 6));
}
