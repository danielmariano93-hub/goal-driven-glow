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

export type BehavioralDateBasis = "behavioral" | "bank_posting";

export type ResolvedBehavioralDate = {
  day: string;
  source: BehavioralDateSource;
  confidence: number;
  eligibleForBehavior: boolean;
  /**
   * `bank_posting` sinaliza que a data veio do extrato (data de lançamento).
   * O dado ENTRA na série comportamental — descartar 3 de cada 4 lançamentos
   * produzia números que o usuário não reconhecia —, mas a origem viaja junto
   * para que a resposta possa dizer a ressalva em voz alta.
   */
  basis: BehavioralDateBasis;
};

export const MIN_BEHAVIOR_DATE_CONFIDENCE = 0.65;
/** Piso de confiança aplicado a datas de extrato aceitas na série comportamental. */
export const BANK_POSTING_BEHAVIOR_CONFIDENCE = 0.7;

/**
 * Resolve a dimensão comportamental sem alterar a data contábil.
 * Datas de postagem bancária participam do padrão semanal com ressalva
 * explícita; somente registros sem data alguma ficam fora.
 */
export function resolveBehavioralDate(row: BehavioralDateRow): ResolvedBehavioralDate {
  const contractPresent = Object.prototype.hasOwnProperty.call(row, "behavioral_day")
    || Object.prototype.hasOwnProperty.call(row, "behavior_date_confidence");
  const day = String(row.behavioral_day || row.occurred_at || "").slice(0, 10);
  const rawConfidence = Number(row.behavior_date_confidence);
  const rawResolved = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : contractPresent ? 0.35 : 1;
  const source = (row.behavior_date_source || (contractPresent ? "bank_posting_date" : "user_entered")) as BehavioralDateSource;
  const basis: BehavioralDateBasis = source === "bank_posting_date" ? "bank_posting" : "behavioral";
  const confidence = basis === "bank_posting"
    ? Math.max(rawResolved, BANK_POSTING_BEHAVIOR_CONFIDENCE)
    : rawResolved;
  return {
    day,
    source,
    confidence,
    basis,
    eligibleForBehavior: Boolean(day) && confidence >= MIN_BEHAVIOR_DATE_CONFIDENCE,
  };
}

