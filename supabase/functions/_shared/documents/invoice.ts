export type StatementItemKind =
  | "purchase"
  | "installment"
  | "refund"
  | "interest"
  | "fee"
  | "payment"
  | "adjustment"
  | "informational";

export type InvoiceLine = {
  amount: number;
  type: "income" | "expense";
  description?: string | null;
  movement_kind?: string | null;
  installments_total?: number | null;
  installment_number?: number | null;
  statement_item_kind?: StatementItemKind | null;
};

export type InvoiceSummary = {
  charges: number;
  credits: number;
  payments: number;
  net: number;
  count: number;
};

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function inferInstallmentDetails(
  description: string,
  current?: number | null,
  total?: number | null,
): { current: number | null; total: number | null; inferred: boolean } {
  const valid = (n: number | null | undefined) =>
    Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 48 ? Number(n) : null;
  const knownCurrent = valid(current);
  const knownTotal = valid(total);
  if (knownCurrent && knownTotal && knownCurrent <= knownTotal) {
    return { current: knownCurrent, total: knownTotal, inferred: false };
  }

  const text = fold(description);
  const pair = text.match(
    /(?:parc(?:ela)?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})(?!\d)/i,
  );
  if (pair) {
    const parsedCurrent = valid(Number(pair[1]));
    const parsedTotal = valid(Number(pair[2]));
    if (parsedCurrent && parsedTotal && parsedCurrent <= parsedTotal) {
      return {
        current: knownCurrent ?? parsedCurrent,
        total: knownTotal ?? parsedTotal,
        inferred: true,
      };
    }
  }

  const totalOnly = text.match(/\b(\d{1,2})\s*x\b/i);
  const parsedTotal = totalOnly ? valid(Number(totalOnly[1])) : null;
  if (parsedTotal && parsedTotal > 1) {
    return {
      current: knownCurrent ?? 1,
      total: knownTotal ?? parsedTotal,
      inferred: true,
    };
  }

  return {
    current: knownCurrent,
    total: knownTotal,
    inferred: false,
  };
}

export function classifyStatementItem(line: InvoiceLine): StatementItemKind {
  if (line.statement_item_kind) return line.statement_item_kind;
  const description = fold(line.description ?? "");
  const movement = fold(line.movement_kind ?? "transaction");

  if (
    movement === "informational" ||
    /\b(total da fatura|valor da fatura|total a pagar|pagamento minimo|limite (disponivel|total)|saldo (disponivel|total)|parcelas futuras|proximas faturas)\b/.test(description)
  ) return "informational";
  if (
    movement === "card_payment" ||
    /\b(pagamento (efetuado|recebido)?\s*(da|de)?\s*fatura|pagamento cartao|antecipacao (da|de)?\s*(fatura|pagamento)|pagamento antecipado)\b/.test(description)
  ) return "payment";
  if (
    movement === "refund" ||
    line.type === "income" ||
    /\b(estorno|reembolso|credito de compra|credito recebido|cancelamento parcial|credito em fatura)\b/.test(description)
  ) return "refund";
  if (/\b(juros|encargos|rotativo)\b/.test(description)) return "interest";
  if (/\b(tarifa|anuidade|iof|multa)\b/.test(description)) return "fee";

  const installment = inferInstallmentDetails(
    line.description ?? "",
    line.installment_number,
    line.installments_total,
  );
  if ((installment.total ?? 1) > 1) return "installment";
  return "purchase";
}

export function statementSignedAmount(line: InvoiceLine): number {
  const amount = Math.abs(Number(line.amount) || 0);
  const kind = classifyStatementItem(line);
  if (kind === "informational") return 0;
  if (kind === "refund" || kind === "payment") return -amount;
  return amount;
}

export function summarizeInvoiceLines(lines: InvoiceLine[]): InvoiceSummary {
  let charges = 0;
  let credits = 0;
  let payments = 0;
  let count = 0;

  for (const line of lines) {
    const amount = Math.abs(Number(line.amount) || 0);
    const kind = classifyStatementItem(line);
    if (!amount || kind === "informational") continue;
    count++;
    if (kind === "payment") payments += amount;
    else if (kind === "refund") credits += amount;
    else charges += amount;
  }

  return {
    charges: roundMoney(charges),
    credits: roundMoney(credits),
    payments: roundMoney(payments),
    net: roundMoney(charges - credits - payments),
    count,
  };
}

export function invoiceReconciliation(
  statedTotal: number | null | undefined,
  calculatedTotal: number,
  tolerance = 0.05,
): { difference: number | null; reconciled: boolean } {
  if (statedTotal == null || !Number.isFinite(Number(statedTotal))) {
    return { difference: null, reconciled: false };
  }
  const difference = roundMoney(Number(statedTotal) - calculatedTotal);
  return { difference, reconciled: Math.abs(difference) <= tolerance };
}
