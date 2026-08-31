/**
 * READ MODEL VERSIONED CONTRACT (`read_model_contract.v1`).
 *
 * Snapshot materializado NÃO pode sobreviver silenciosamente a uma mudança de
 * contrato. Quem espera `home_snapshot.v4` nunca aceita `home_snapshot.v2`,
 * mesmo que o payload pareça válido: o consumidor trata como stale, recomputa
 * e — nunca — preenche campo ausente como se fosse verdade.
 */
import { recordDataContractViolation } from "@/lib/observability/dataContract";

export const READ_MODEL_CONTRACTS = {
  homeSnapshot: "home_snapshot.v4",
  performance: "advisor_performance.v1",
} as const;

export type SnapshotContractResult<T> =
  | { ok: true; fresh: T }
  | { ok: false; reason: "contract_mismatch" | "missing_contract" | "empty"; stale: true };

/**
 * Só devolve `ok` quando o contrato declarado no payload é exatamente o
 * esperado. Qualquer divergência vira `stale` + violação observável.
 */
export function assertSnapshotContract<T extends { contract_version?: string | null }>(
  snapshot: T | null | undefined,
  expectedContract: string,
  surface: string,
): SnapshotContractResult<T> {
  if (!snapshot) return { ok: false, reason: "empty", stale: true };
  const found = snapshot.contract_version;
  if (!found) {
    recordDataContractViolation({ kind: "snapshot_contract_mismatch", surface, ref: `missing!=${expectedContract}` });
    return { ok: false, reason: "missing_contract", stale: true };
  }
  if (found !== expectedContract) {
    recordDataContractViolation({ kind: "snapshot_contract_mismatch", surface, ref: `${found}!=${expectedContract}` });
    return { ok: false, reason: "contract_mismatch", stale: true };
  }
  return { ok: true, fresh: snapshot };
}

/**
 * Campo obrigatório de read model. Retorna `false` (e registra) quando falta,
 * para o consumidor decidir entre recomputar ou degradar honestamente.
 */
export function assertRequiredFields(
  payload: Record<string, unknown> | null | undefined,
  required: readonly string[],
  surface: string,
): boolean {
  if (!payload) return false;
  const missing = required.filter((field) => payload[field] === undefined || payload[field] === null);
  if (!missing.length) return true;
  recordDataContractViolation({
    kind: "read_model_missing_required_field",
    surface,
    ref: missing.join(","),
  });
  return false;
}
