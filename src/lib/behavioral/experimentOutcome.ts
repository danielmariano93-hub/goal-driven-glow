import type { BehaviorExperiment } from "@/lib/behavioral/client";

const DAY_MS = 86_400_000;

export type ExperimentRecommendation = "continue" | "switch" | "observe";

export type ExperimentOutcome = {
  baseline: number | null;
  current: number | null;
  deltaPct: number | null;
  recommendation: ExperimentRecommendation;
  savedPerDay: number | null;
  savedTotal: number | null;
  durationDays: number;
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Traduz a linha do experimento para um resultado de produto. Não recalcula a
 * medição: baseline/current/result_delta_pct continuam vindo do RPC canônico.
 * Para redução de gasto, baseline_value é gasto médio diário anterior e
 * current_value/result_delta_pct representam a redução percentual observada.
 */
export function experimentOutcome(experiment: BehaviorExperiment): ExperimentOutcome {
  const baseline = finite(experiment.baseline_value);
  const rawCurrent = finite(experiment.result_value ?? experiment.current_value);
  const deltaPct = finite(experiment.result_delta_pct);
  const start = new Date(experiment.started_at).getTime();
  const end = new Date(experiment.completed_at ?? experiment.ends_at).getTime();
  const durationDays = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(1, Math.ceil(Math.max(DAY_MS, end - start) / DAY_MS))
    : 1;

  let current = rawCurrent;
  let savedPerDay: number | null = null;
  let savedTotal: number | null = null;

  if (experiment.tracking_kind === "spend_reduction_pct" && baseline != null && baseline > 0) {
    const reduction = deltaPct ?? rawCurrent;
    if (reduction != null) {
      current = round2(Math.max(0, baseline * (1 - reduction / 100)));
      savedPerDay = round2(baseline - current);
      savedTotal = round2(savedPerDay * durationDays);
    }
  }

  const reachedTarget = Number(experiment.progress) >= 100 || experiment.status === "completed";
  const meaningfulSpendReduction = experiment.tracking_kind === "spend_reduction_pct"
    ? (deltaPct ?? rawCurrent ?? 0) >= 5
    : null;

  let recommendation: ExperimentRecommendation = "observe";
  if (experiment.status === "abandoned" || experiment.status === "expired") {
    recommendation = "switch";
  } else if (experiment.status === "completed") {
    recommendation = experiment.tracking_kind === "spend_reduction_pct"
      ? (meaningfulSpendReduction ? "continue" : "switch")
      : (reachedTarget ? "continue" : "switch");
  }

  return { baseline, current, deltaPct, recommendation, savedPerDay, savedTotal, durationDays };
}
