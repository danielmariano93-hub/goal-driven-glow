// Política temporal única para leituras financeiras sem período explícito.
//
// Precedência de produto:
// 1. período explícito do turno;
// 2. período ativo da conversa;
// 3. período do último resultado relacionado;
// 4. mês corrente;
// 5. clarification apenas para ambiguidades semânticas reais (decidida antes
//    desta função, por exemplo uma comparação sem alvo identificável).

import {
  normalizePeriodExpressions,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";

export type PeriodCandidate = { from: string; to: string; label?: string | null };

export type ImplicitPeriodSource =
  | "explicit_turn"
  | "active_conversation"
  | "last_related_result"
  | "current_month";

export type ImplicitPeriodResolution = {
  period: { from: string; to: string; label: string };
  source: ImplicitPeriodSource;
};

function valid(candidate: PeriodCandidate | null | undefined): candidate is PeriodCandidate {
  if (!candidate) return false;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  return ymd.test(candidate.from) && ymd.test(candidate.to) && candidate.from <= candidate.to;
}

function canonical(candidate: PeriodCandidate, fallbackLabel: string) {
  return {
    from: candidate.from,
    to: candidate.to,
    label: String(candidate.label ?? "").trim() || fallbackLabel,
  };
}

export function resolveImplicitPeriod(args: {
  explicit?: PeriodCandidate | null;
  active?: PeriodCandidate | null;
  last_related?: PeriodCandidate | null;
  current_month: PeriodCandidate;
}): ImplicitPeriodResolution {
  if (valid(args.explicit)) {
    return { period: canonical(args.explicit, "período solicitado"), source: "explicit_turn" };
  }
  if (valid(args.active)) {
    return { period: canonical(args.active, "período ativo"), source: "active_conversation" };
  }
  if (valid(args.last_related)) {
    return { period: canonical(args.last_related, "último período analisado"), source: "last_related_result" };
  }
  return { period: canonical(args.current_month, "este mês"), source: "current_month" };
}

/**
 * Converts a period-only clarification back into an executable factual read.
 * This is intentionally narrower than a generic "repair": the Brain must have
 * already supplied the complete financial query, no explicit date may exist,
 * and every non-time slot must be resolved. Software only applies the temporal
 * default; it never reconstructs missing financial meaning.
 */
export function applyImplicitPeriodToClarification(
  contract: CanonicalConversationTurnContract,
  fallbackCanonicalRequest: string,
): CanonicalConversationTurnContract {
  if (contract.mode !== "clarify" || contract.domain !== "financial_read") return contract;
  if (!contract.financial_read?.queries?.length) return contract;
  if (normalizePeriodExpressions(contract.focus).length > 0) return contract;
  if (!["missing", "ambiguous"].includes(contract.resolution.time)) return contract;
  if (!["resolved", "not_applicable", "ambiguous"].includes(contract.resolution.intent)) return contract;
  if (!["resolved", "not_applicable"].includes(contract.resolution.entity)) return contract;
  if (!["resolved", "not_applicable"].includes(contract.resolution.reference)) return contract;
  if (contract.financial_read.queries.some((query) => ["compare", "explain"].includes(query.operation))) return contract;
  const canonicalRequest = String(contract.canonical_request ?? fallbackCanonicalRequest).trim();
  if (!canonicalRequest) return contract;
  return {
    ...contract,
    mode: "read",
    canonical_request: canonicalRequest,
    clarification_question: null,
    resolution: {
      ...contract.resolution,
      intent: "resolved",
      time: "not_applicable",
    },
  };
}
