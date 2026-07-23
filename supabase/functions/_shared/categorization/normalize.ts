// Normalização de descrições bancárias para chegar a um "merchant canônico".
// Remove tokens de meio de pagamento, adquirentes, IDs, datas e diacríticos.
const NOISE_TOKENS = new Set([
  "pay", "pix", "ted", "doc", "compra", "pagamento", "debito", "credito", "cred",
  "deb", "cartao", "boleto", "transf", "transferencia", "recebimento",
  "redecard", "stone", "cielo", "getnet", "rede", "pagseguro", "pagbank",
  "mercpago", "mercadopago", "picpay", "de", "em", "no", "na", "do", "da",
  "ltda", "me", "sa", "eireli", "mei", "epp",
]);

export function normalizeDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[*#@_]+/g, " ")
    .replace(/\d{2}[\/\-]\d{2}([\/\-]\d{2,4})?/g, " ") // datas
    .replace(/\d{4,}/g, " ")                            // ids longos
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(t => t && !NOISE_TOKENS.has(t) && t.length >= 2);
  return tokens.join(" ").trim();
}

/** Merchant canônico: primeiros 2–3 tokens estáveis. */
export function merchantCanonical(raw: string | null | undefined): string {
  const norm = normalizeDescription(raw);
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.slice(0, 3).join(" ");
}

/** Padrão de matching para aliases: alfa-restrito, curto. */
export function normalizedPattern(raw: string | null | undefined): string {
  return merchantCanonical(raw);
}
