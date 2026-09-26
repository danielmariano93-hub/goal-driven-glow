// Política temporal única para leituras financeiras sem período explícito.
//
// Precedência de produto:
// 1. período explícito do turno;
// 2. período ativo da conversa;
// 3. período do último resultado relacionado;
// 4. mês corrente;
// 5. clarification apenas para ambiguidades semânticas reais (decidida antes
//    desta função, por exemplo uma comparação sem alvo identificável).

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
