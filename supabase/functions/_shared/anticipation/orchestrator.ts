// anticipation_contract.v1 — orquestrador de atenção.
// Uma única antecipação principal por janela: o resto vai para o app ou espera.

import type { AnticipationOpportunity, DetectorKey } from "./contracts.ts";

/** Prioridade fixa do produto — quanto menor o número, mais importante. */
export const DETECTOR_PRIORITY: Record<DetectorKey, number> = {
  upcoming_cash_pressure: 1,
  card_cycle_acceleration: 2,
  expected_recurring_payment: 3,
  weekday_spending_risk: 4,
  weekend_spending_risk: 5,
  month_phase_spending_risk: 6,
  small_spend_acceleration: 7,
};

export type OrchestrationResult = {
  primary: AnticipationOpportunity | null;
  appOnly: AnticipationOpportunity[];
  deferred: AnticipationOpportunity[];
};

export function orchestrateAttention(
  candidates: AnticipationOpportunity[],
  opts: { minUtility?: number; maxAppOnly?: number } = {},
): OrchestrationResult {
  const minUtility = opts.minUtility ?? 0;
  const maxAppOnly = opts.maxAppOnly ?? 2;

  const eligible = candidates
    .filter((c) => c.utility_score >= minUtility)
    .sort((a, b) => {
      const pa = DETECTOR_PRIORITY[a.detector] ?? 99;
      const pb = DETECTOR_PRIORITY[b.detector] ?? 99;
      if (pa !== pb) return pa - pb;
      if (b.utility_score !== a.utility_score) return b.utility_score - a.utility_score;
      return a.opportunity_date.localeCompare(b.opportunity_date);
    });

  const [primary, ...rest] = eligible;
  return {
    primary: primary ?? null,
    appOnly: rest.slice(0, maxAppOnly).map((c) => ({ ...c, channel_target: "app" as const })),
    deferred: rest.slice(maxAppOnly),
  };
}
