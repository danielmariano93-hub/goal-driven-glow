// Grupos de lançamentos sem categoria por favorecido (RPC my_uncategorized_counterparties).
export type CounterpartyGroup = {
  id: string;
  counterparty_key: string;
  label: string;
  display_name: string;
  transaction_type: "income" | "expense";
  direction: "pago" | "recebido";
  transactions: number;
  total: number;
  last_date: string | null;
};

const PIX_PREFIX = /^(pix|pay|transf|ted|doc)\b/i;

/** "pamela" → "Pix para Pamela"; estabelecimento fica com o nome capitalizado. */
export function counterpartyDisplayName(key: string, label: string, type: "income" | "expense"): string {
  const name = key.split(" ").map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
  if (PIX_PREFIX.test(String(label ?? "").trim())) return type === "income" ? `Pix de ${name}` : `Pix para ${name}`;
  return name;
}

export function parseCounterpartyGroups(raw: unknown): CounterpartyGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const r = row as Record<string, unknown>;
    const key = String(r.counterparty_key ?? "").trim();
    const type = r.transaction_type === "income" ? "income" : r.transaction_type === "expense" ? "expense" : null;
    if (!key || !type) return [];
    const label = String(r.label ?? key);
    return [{
      id: `${type}:${key}`,
      counterparty_key: key,
      label,
      display_name: counterpartyDisplayName(key, label, type),
      transaction_type: type,
      direction: type === "income" ? "recebido" : "pago",
      transactions: Number(r.transactions ?? 0),
      total: Number(r.total ?? 0),
      last_date: r.last_date ? String(r.last_date) : null,
    }];
  });
}
