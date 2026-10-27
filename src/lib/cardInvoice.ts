const PURCHASE_KINDS = ["purchase", "installment"];
const CREDIT_KINDS = ["payment", "refund"];

/** Resumo no formato do app do banco: pagamentos e estornos, compras e ajustes/encargos. A soma é o total da fatura. */
export function summarizeInvoiceItems(items: Array<{ item_kind: string; amount: number | string }>) {
  let credits = 0;
  let purchases = 0;
  let other = 0;
  for (const it of items) {
    const amount = Number(it.amount || 0);
    if (CREDIT_KINDS.includes(it.item_kind)) credits += amount;
    else if (PURCHASE_KINDS.includes(it.item_kind)) purchases += amount;
    else other += amount;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { credits: r(credits), purchases: r(purchases), other: r(other), total: r(credits + purchases + other) };
}
