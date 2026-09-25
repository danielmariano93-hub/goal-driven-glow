// Nino Runtime V3 — evidence envelope.
//
// Personal financial claims must be backed by execution evidence. Conversation
// memory may help resolve context, but it is never a truth source for money.

export type EvidenceSourceV3 =
  | "financial_engine"
  | "goal_engine"
  | "advisory_engine"
  | "write_workflow";

export type EvidenceEnvelopeV3<T = unknown> = {
  version: "nino_evidence.v3";
  task_index: number;
  capability_family: "financial.query" | "goals" | "advisory" | "financial.write";
  source: EvidenceSourceV3;
  scope: Record<string, unknown>;
  payload: T;
  formula_version: string | null;
  executed_at: string;
  query_fingerprint: string;
};

export type EvidenceValidationV3 = {
  ok: boolean;
  errors: string[];
};

export function validateEvidenceEnvelopeV3(value: EvidenceEnvelopeV3): EvidenceValidationV3 {
  const errors: string[] = [];
  if (value.version !== "nino_evidence.v3") errors.push("evidence_version_invalid");
  if (!Number.isInteger(value.task_index) || value.task_index < 0) errors.push("task_index_invalid");
  if (!String(value.query_fingerprint ?? "").trim()) errors.push("query_fingerprint_required");
  if (!String(value.executed_at ?? "").trim() || Number.isNaN(Date.parse(value.executed_at))) {
    errors.push("executed_at_invalid");
  }
  if (!value.scope || typeof value.scope !== "object" || Array.isArray(value.scope)) errors.push("scope_invalid");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * Response composition may only state personal financial facts for a task when
 * a valid evidence envelope from that task is present.
 */
export function evidenceForTaskV3(
  taskIndex: number,
  envelopes: EvidenceEnvelopeV3[],
): EvidenceEnvelopeV3[] {
  return envelopes.filter((envelope) => envelope.task_index === taskIndex && validateEvidenceEnvelopeV3(envelope).ok);
}
