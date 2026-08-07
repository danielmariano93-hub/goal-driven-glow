export type BehavioralDateSource =
  | "automation_timestamp"
  | "purchase_date"
  | "user_entered"
  | "recurring_schedule"
  | "bank_posting_date";

export type BehavioralDateRow = {
  occurred_at: string;
  behavioral_day?: string | null;
  behavior_date_source?: string | null;
  behavior_date_confidence?: number | string | null;
};

export type ResolvedBehavioralDate = {
  day: string;
  source: BehavioralDateSource;
  confidence: number;
  eligibleForBehavior: boolean;
};

export const MIN_BEHAVIOR_DATE_CONFIDENCE = 0.65;

/**
 * Resolve a dimensão comportamental sem alterar a data contábil. Registros
 * antigos/externos sem evidência temporal continuam no livro-caixa, mas não
 * viram afirmações do tipo “você costuma gastar mais na segunda-feira”.
 */
export function resolveBehavioralDate(row: BehavioralDateRow): ResolvedBehavioralDate {
  const contractPresent = Object.prototype.hasOwnProperty.call(row, "behavioral_day")
    || Object.prototype.hasOwnProperty.call(row, "behavior_date_confidence");
  const day = String(row.behavioral_day || row.occurred_at || "").slice(0, 10);
  const rawConfidence = Number(row.behavior_date_confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : contractPresent ? 0.35 : 1;
  const source = (row.behavior_date_source || (contractPresent ? "bank_posting_date" : "user_entered")) as BehavioralDateSource;
  return {
    day,
    source,
    confidence,
    eligibleForBehavior: Boolean(day) && confidence >= MIN_BEHAVIOR_DATE_CONFIDENCE,
  };
}
