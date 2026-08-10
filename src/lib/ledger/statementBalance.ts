// Semântica de saldo de extrato (`bank_cash_truth.v1`).
//
// ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/ledger/statementBalance.ts.
//
// Um extrato pode informar dois números muito diferentes:
//  • "SALDO DO DIA" de uma linha específica → autoridade só naquela data;
//  • "saldo atual/em conta" do cabeçalho → autoridade no fim do período.
// Tratar cabeçalho como saldo do dia corta a conciliação antes dos movimentos
// que compõem o próprio saldo — foi essa confusão que produziu o -199,48.

export type BalanceSource = "header_current" | "day_line" | "computed";

export type StatementBalanceSemantics = {
  closing_balance: number | null;
  balance_source: BalanceSource | null;
  balance_as_of: string | null;
  balance_as_of_confidence: number;
  reasons: string[];
};

export function deriveStatementBalanceSemantics(input: {
  closing_balance: number | null;
  balance_date: string | null;
  period_start: string | null;
  period_end: string | null;
  item_dates: Array<string | null | undefined>;
}): StatementBalanceSemantics {
  const reasons: string[] = [];
  const closing = Number.isFinite(Number(input.closing_balance))
    ? Number(input.closing_balance)
    : null;
  if (closing == null) {
    return {
      closing_balance: null,
      balance_source: null,
      balance_as_of: null,
      balance_as_of_confidence: 0,
      reasons: ["no_closing_balance"],
    };
  }

  const dates = input.item_dates
    .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const lastMovement = dates.length > 0 ? dates[dates.length - 1] : null;
  const periodEnd = input.period_end ?? lastMovement ?? input.balance_date ?? null;
  const stated = input.balance_date ?? null;

  // Sem data declarada: o saldo é o do fim do período coberto.
  if (!stated) {
    reasons.push("balance_date_missing");
    return {
      closing_balance: closing,
      balance_source: "header_current",
      balance_as_of: periodEnd,
      balance_as_of_confidence: periodEnd ? 0.7 : 0,
      reasons,
    };
  }

  // Data declarada anterior a movimentos que compõem o saldo → é saldo atual
  // do cabeçalho, não saldo daquele dia. Reposiciona no fim do período.
  if (lastMovement && stated < lastMovement) {
    reasons.push(`stated_before_last_movement:${stated}<${lastMovement}`);
    return {
      closing_balance: closing,
      balance_source: "header_current",
      balance_as_of: periodEnd ?? lastMovement,
      balance_as_of_confidence: 0.85,
      reasons,
    };
  }

  reasons.push("stated_covers_all_movements");
  return {
    closing_balance: closing,
    balance_source: "day_line",
    balance_as_of: stated,
    balance_as_of_confidence: 0.95,
    reasons,
  };
}

/** Guard de release: nunca reconciliar saldo contra data anterior aos movimentos. */
export function balanceAsOfIsConsistent(
  balanceAsOf: string | null,
  lastMovementDate: string | null,
): boolean {
  if (!balanceAsOf) return false;
  if (!lastMovementDate) return true;
  return balanceAsOf >= lastMovementDate;
}
