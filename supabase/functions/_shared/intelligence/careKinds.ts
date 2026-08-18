// care_kinds.v1 — comunicações de cuidado e operacionais.
//
// Elas não disputam a mesma cota escassa dos insights financeiros: um lembrete
// carinhoso de check-in emocional não deve ser engolido por um alerta de caixa,
// nem o contrário. Também não passam pelo piso de materialidade: não têm (e não
// precisam ter) impacto em reais.
export const CARE_KINDS = new Set<string>([
  "emotional_checkin_due",
  "advisor_review_weekly",
  "advisor_review_monthly",
  "engagement_drop",
]);

export function isCareKind(kind: string): boolean {
  return CARE_KINDS.has(kind);
}

export type CareQuota = { maxPerDay: number; maxPerWeek: number };

export const DEFAULT_CARE_QUOTA: CareQuota = { maxPerDay: 1, maxPerWeek: 4 };
