// anticipation_contract.v1 — utilidade determinística e auditável.
// Sem modelo opaco: cada componente é explicado e persistido no breakdown.

export type UtilityInput = {
  confidence: number;
  absolute_delta: number;
  monthly_reference: number;
  consistency: number;
  actionable: boolean;
  hours_until_window_end: number;
  receptivity: number;
  interruption_cost: number;
  fatigue: number;
};

export type UtilityResult = {
  score: number;
  breakdown: Record<string, number>;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export function computeUtility(input: UtilityInput): UtilityResult {
  const confidence = clamp01(input.confidence);
  const reference = input.monthly_reference > 0 ? input.monthly_reference : 1000;
  const impact = clamp01(Math.abs(input.absolute_delta) / (reference * 0.1));
  const consistency = clamp01(input.consistency);
  const actionability = input.actionable ? 1 : 0.4;
  const timeliness = input.hours_until_window_end <= 0
    ? 0
    : clamp01(Math.min(1, input.hours_until_window_end / 12));
  const receptivity = clamp01(input.receptivity);
  const interruption = clamp01(input.interruption_cost);
  const fatigue = clamp01(input.fatigue);

  const positive = confidence * 0.28
    + impact * 0.24
    + consistency * 0.16
    + actionability * 0.12
    + timeliness * 0.12
    + receptivity * 0.08;
  const score = Math.max(0, Math.min(1, positive - interruption * 0.15 - fatigue * 0.2));

  return {
    score: Math.round(score * 1000) / 1000,
    breakdown: {
      confidence,
      impact,
      consistency,
      actionability,
      timeliness,
      receptivity,
      interruption_cost: interruption,
      fatigue,
      positive: Math.round(positive * 1000) / 1000,
    },
  };
}

/**
 * Fadiga cresce com comunicações recentes e com feedback negativo, então o
 * motor fala menos com quem já foi avisado ou já disse que não ajudou.
 */
export function fatigueFactor(args: {
  deliveries_last_7d: number;
  not_useful_last_30d: number;
  dismissed_last_30d: number;
}): number {
  return clamp01(
    args.deliveries_last_7d * 0.15
    + args.not_useful_last_30d * 0.25
    + args.dismissed_last_30d * 0.1,
  );
}

/** Receptividade determinística: interações úteis recentes sobre entregas. */
export function receptivityFactor(args: { useful_last_60d: number; deliveries_last_60d: number }): number {
  if (args.deliveries_last_60d <= 0) return 0.5;
  return clamp01(args.useful_last_60d / args.deliveries_last_60d);
}
