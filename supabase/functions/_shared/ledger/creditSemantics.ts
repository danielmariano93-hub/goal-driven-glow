// Semântica de CRÉDITO em documentos financeiros (fonte única).
//
// ESTE ARQUIVO É ESPELHADO em src/lib/ledger/creditSemantics.ts.
// Qualquer alteração precisa ser aplicada nos dois (teste de contrato garante).
//
// Problema que este módulo resolve (Onda 1 / P0-2):
// a extração por visão devolvia "Cancelamento Parcial De ..." como DESPESA
// positiva. O item entrava no ledger inflando gasto, ritmo e obrigação do
// cartão, e a fatura passava a divergir do total oficial.
//
// Regra: a descrição manda quando o vocabulário é inequivocamente de crédito.
// Nunca o contrário — nada aqui transforma crédito em despesa.

/** Vocabulário inequívoco de crédito/estorno em faturas e extratos brasileiros. */
const CREDIT_PATTERNS: RegExp[] = [
  /\bestorn\w*/,
  /\breembols\w*/,
  /\bcancelament\w*/,
  /\bdevoluc\w*/,
  /\bcredito de compra\b/,
  /\bcredito de estorno\b/,
  /\bajuste a credito\b/,
  /\bchargeback\b/,
  /\brefund\b/,
  /\breversao de compra\b/,
];

/**
 * Termos que parecem crédito mas NÃO são: "cancelamento de assinatura" é o
 * nome comercial de uma cobrança, e "credito rotativo"/"credito parcelado"
 * são encargos (despesa).
 */
const CREDIT_FALSE_POSITIVES: RegExp[] = [
  /\bcredito rotativ\w*/,
  /\bcredito parcelad\w*/,
  /\bjuros? de credito\b/,
  /\bcompra a credito\b/,
];

export function foldForCreditMatch(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** true quando a descrição é inequivocamente um crédito/estorno. */
export function isCreditDescription(description?: string | null): boolean {
  const folded = foldForCreditMatch(description ?? "");
  if (!folded) return false;
  if (CREDIT_FALSE_POSITIVES.some((re) => re.test(folded))) return false;
  return CREDIT_PATTERNS.some((re) => re.test(folded));
}

export type CreditGuardInput = {
  type: "income" | "expense";
  amount: number;
  description?: string | null;
  movement_kind?: string | null;
};

export type CreditGuardResult<T extends CreditGuardInput> = T & {
  type: "income" | "expense";
  amount: number;
  movement_kind: string | null | undefined;
  /** motivos aplicados — vão para `reasons` do movimento canônico e para auditoria */
  credit_guard_reasons: string[];
};

/**
 * Normaliza sinal e `movement_kind` de itens de crédito.
 *
 *  1. valor negativo em item de despesa ⇒ é crédito (income, valor absoluto);
 *  2. descrição de crédito em item de despesa ⇒ vira income;
 *  3. todo crédito recebe `movement_kind = "refund"`, exceto quando já é um
 *     movimento não-consumo declarado (card_payment, internal_transfer...).
 *
 * `amount` sai sempre positivo: o sinal vive em `type`, nunca no valor.
 */
export function applyCreditSignGuard<T extends CreditGuardInput>(item: T): CreditGuardResult<T> {
  const reasons: string[] = [];
  let type = item.type;
  let amount = Number(item.amount ?? 0);
  let movement_kind = item.movement_kind;

  if (amount < 0 && type === "expense") {
    type = "income";
    reasons.push("negative_expense_is_credit");
  }
  amount = Math.abs(amount);

  if (type === "expense" && isCreditDescription(item.description)) {
    type = "income";
    reasons.push("credit_description_overrides_expense");
  }

  const declaredNonConsumption = new Set([
    "card_payment", "internal_transfer", "debt_payment", "loan_proceeds",
    "investment_application", "investment_redemption", "investment_yield",
  ]);
  const mk = String(movement_kind ?? "");
  if (type === "income" && reasons.length > 0 && !declaredNonConsumption.has(mk)) {
    if (mk !== "refund") reasons.push("movement_kind_set_to_refund");
    movement_kind = "refund";
  }

  return { ...item, type, amount, movement_kind, credit_guard_reasons: reasons };
}
