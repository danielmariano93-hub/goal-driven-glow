/**
 * Observabilidade de contrato de dados (`data_contract.v1`).
 *
 * Fallback existe para a UX não quebrar — mas fallback não pode esconder
 * regressão para sempre. Quando um campo de negócio OBRIGATÓRIO chega vazio
 * mesmo com a chave presente, registramos a violação aqui (contadores em
 * memória + aviso no console). NENHUM valor financeiro é registrado: só o
 * tipo da violação, a superfície e a chave técnica.
 */
export type DataContractViolationKind =
  | "snapshot_contract_mismatch"
  | "category_name_missing"
  | "account_name_missing"
  | "card_name_missing"
  | "read_model_missing_required_field"
  | "orphan_navigation_route";

type Violation = {
  kind: DataContractViolationKind;
  surface: string;
  /** Identificador técnico (id/uuid/contrato). Nunca valores financeiros. */
  ref?: string;
};

const counters = new Map<DataContractViolationKind, number>();
const seen = new Set<string>();

export function recordDataContractViolation(violation: Violation): void {
  const { kind, surface, ref } = violation;
  counters.set(kind, (counters.get(kind) ?? 0) + 1);
  const dedupe = `${kind}|${surface}|${ref ?? ""}`;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  // Um aviso por combinação — telemetria leve, sem inundar o console.
  console.warn(`[data-contract] ${kind} em ${surface}${ref ? ` (${ref})` : ""}`);
}

export function dataContractViolations(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [kind, count] of counters) out[kind] = count;
  return out;
}

export function resetDataContractViolations(): void {
  counters.clear();
  seen.clear();
}

/**
 * Invariante de negócio: se existe `category_id`, o nome PRECISA existir.
 * Devolve o rótulo a exibir e registra a violação quando o nome faltou.
 */
export function resolveRequiredLabel(params: {
  kind: DataContractViolationKind;
  surface: string;
  id?: string | null;
  name?: string | null;
  fallback: string;
}): string {
  const { kind, surface, id, name, fallback } = params;
  if (name && name.trim()) return name;
  if (id) recordDataContractViolation({ kind, surface, ref: id });
  return fallback;
}
