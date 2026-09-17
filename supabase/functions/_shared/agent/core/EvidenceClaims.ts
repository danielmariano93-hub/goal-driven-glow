// EvidenceClaims (`nino_semantic_ir.v3`)
//
// Camada semântica SOBRE o EvidencePack (não substitui). Traduz o resultado dos
// motores em afirmações tipadas que a resposta pode fazer — e só elas. Nada aqui
// recalcula verdade financeira: apenas lê o que o motor devolveu.
import type { EvidenceClaimType, FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import type { SemanticExecutionResult, SemanticQueryOutcome } from "./SemanticQueryExecutor.ts";

export const ALLOWED_DERIVATIONS = [
  "rounded_money", "difference", "ratio", "percentage_share", "rank_position",
] as const;
export type AllowedDerivation = typeof ALLOWED_DERIVATIONS[number];

export type EvidenceClaim = {
  id: string;
  query_id: string;
  type: EvidenceClaimType;
  /** Valor numérico canônico (money/percentage/count/rank). */
  value: number | null;
  /** Rótulo canônico (entity/period/direction). */
  label: string | null;
  /** Posição no ranking, quando aplicável. */
  rank: number | null;
  engine: string | null;
};

export type EvidenceClaimSet = {
  version: "nino_evidence_claims.v1";
  period: { from: string; to: string; label: string };
  comparison_period: { from: string; to: string; label: string } | null;
  currency: "BRL";
  allowed_derivations: AllowedDerivation[];
  claims: EvidenceClaim[];
};

const MONEY_FIELDS = [
  "total_metric", "total", "amount", "value", "available", "balance",
  "net_worth", "projected_total", "total_expense", "total_income", "delta",
];

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function claimsFromOutcome(outcome: SemanticQueryOutcome, seq: () => string): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  if (outcome.status !== "ok" || !outcome.result || typeof outcome.result !== "object") return claims;
  const result = outcome.result as Record<string, unknown>;
  const base = { query_id: outcome.query_id, engine: outcome.engine };

  for (const field of MONEY_FIELDS) {
    const v = num(result[field]);
    if (v != null) {
      claims.push({ id: seq(), ...base, type: "money", value: v, label: field, rank: null });
    }
  }
  const totals = result.totals as Record<string, unknown> | undefined;
  if (totals && typeof totals === "object") {
    for (const [key, raw] of Object.entries(totals)) {
      const v = num(raw);
      if (v != null) claims.push({ id: seq(), ...base, type: "money", value: v, label: key, rank: null });
    }
  }

  const count = num(result.transactions_count ?? result.count);
  if (count != null) claims.push({ id: seq(), ...base, type: "count", value: count, label: "transactions", rank: null });

  // compare_periods: o resultado possui dois totais e deltas por categoria.
  // Transformamos essa estrutura em claims explícitas para completude/grounding;
  // sem isso o formatter determinístico era bloqueado mesmo com evidência válida.
  const isComparison = num(result.total_a) != null && num(result.total_b) != null && Array.isArray(result.by_group);
  if (isComparison) {
    const totalA = num(result.total_a)!;
    const totalB = num(result.total_b)!;
    const delta = num(result.delta_abs) ?? (totalB - totalA);
    claims.push({ id: seq(), ...base, type: "money", value: totalA, label: "total_a", rank: null });
    claims.push({ id: seq(), ...base, type: "money", value: totalB, label: "total_b", rank: null });
    claims.push({ id: seq(), ...base, type: "money", value: Math.abs(delta), label: "delta_abs", rank: null });

    const categoryMode = String(result.requested_group_by ?? "none") === "category";
    if (categoryMode) {
      const increases = (result.by_group as Array<Record<string, unknown>>)
        .filter((row) => Number(row?.delta_abs ?? 0) > 0.005)
        .slice()
        .sort((a, b) => Number(b?.delta_abs ?? 0) - Number(a?.delta_abs ?? 0));
      increases.forEach((row, index) => {
        const name = typeof row.name === "string" ? row.name : null;
        if (!name) return;
        const change = Math.abs(Number(row.delta_abs ?? 0));
        claims.push({ id: seq(), ...base, type: "rank", value: change, label: name, rank: index + 1 });
        claims.push({ id: seq(), ...base, type: "entity", value: change, label: name, rank: index + 1 });
        for (const [field, raw] of [["total_a", row.total_a], ["total_b", row.total_b], ["delta_abs", row.delta_abs]] as const) {
          const value = num(raw);
          if (value != null) claims.push({ id: seq(), ...base, type: "money", value: Math.abs(value), label: `${name}:${field}`, rank: null });
        }
      });
      claims.push({
        id: seq(), ...base, type: "direction", value: null,
        label: increases.length ? "increase" : "no_increase", rank: null,
      });
    } else {
      claims.push({
        id: seq(), ...base, type: "direction", value: null,
        label: delta > 0.005 ? "increase" : delta < -0.005 ? "decrease" : "flat", rank: null,
      });
    }
  }

  const rows = isComparison ? [] : Array.isArray(result.top) ? result.top
    : Array.isArray(result.rows) ? result.rows
    : Array.isArray(result.breakdown) ? result.breakdown
    : [];
  rows.forEach((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : typeof row.label === "string" ? row.label : null;
    const v = num(row.value ?? row.total ?? row.amount);
    if (!name) return;
    claims.push({ id: seq(), ...base, type: "rank", value: v, label: name, rank: index + 1 });
    claims.push({ id: seq(), ...base, type: "entity", value: v, label: name, rank: index + 1 });
    const share = num(row.share ?? row.percent ?? row.percentage);
    if (share != null) {
      claims.push({ id: seq(), ...base, type: "percentage", value: share, label: name, rank: index + 1 });
    }
  });

  if (rows.length === 0 && (count === 0 || num(result.total_metric) === 0)) {
    claims.push({ id: seq(), ...base, type: "absence", value: 0, label: "sem_dados_no_recorte", rank: null });
  }

  const period = result.period as Record<string, unknown> | undefined;
  if (period?.from && period?.to) {
    claims.push({
      id: seq(), ...base, type: "period", value: null,
      label: `${String(period.from)}..${String(period.to)}`, rank: null,
    });
  }
  const direction = typeof result.direction === "string" ? result.direction
    : typeof (result.change as Record<string, unknown>)?.direction === "string"
      ? String((result.change as Record<string, unknown>).direction)
      : null;
  if (direction) claims.push({ id: seq(), ...base, type: "direction", value: null, label: direction, rank: null });

  return claims;
}

export function buildEvidenceClaims(
  ir: FinancialQueryIRv2,
  execution: SemanticExecutionResult,
): EvidenceClaimSet {
  let counter = 0;
  const seq = () => `c${++counter}`;
  const claims = execution.outcomes.flatMap((o) => claimsFromOutcome(o, seq));
  return {
    version: "nino_evidence_claims.v1",
    period: ir.period,
    comparison_period: ir.comparison_period,
    currency: "BRL",
    allowed_derivations: [...ALLOWED_DERIVATIONS],
    claims,
  };
}

export function claimsOfType(set: EvidenceClaimSet, type: EvidenceClaimType, queryId?: string): EvidenceClaim[] {
  return set.claims.filter((c) => c.type === type && (!queryId || c.query_id === queryId));
}
