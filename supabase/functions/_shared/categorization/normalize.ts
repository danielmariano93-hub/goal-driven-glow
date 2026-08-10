// Canonical merchant normalization for Category Truth V2.
// IMPORTANT: this contract intentionally preserves digits (Souk4u, 99, etc.)
// and mirrors public.category_alias_key() for persisted personal knowledge.

const NOISE_TOKENS = new Set([
  "pay", "pix", "ted", "doc", "compra", "pagamento", "pgto", "debito", "credito", "cred",
  "deb", "cartao", "boleto", "transf", "transferencia", "recebimento",
  "redecard", "stone", "cielo", "getnet", "rede", "pagseguro", "pagbank",
  "mercpago", "mercadopago", "picpay", "de", "do", "da", "em", "no", "na",
  "atm", "tmob",
  "ltda", "me", "sa", "eireli", "mei", "epp",
]);

export function storageMerchantKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function normalizeDescription(raw: string | null | undefined): string {
  const key = storageMerchantKey(raw)
    .replace(/\b\d{2}[ -]\d{2}(?:[ -]\d{2,4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return "";
  const tokens = key.split(" ").filter((t) =>
    t && t.length >= 2 && !NOISE_TOKENS.has(t) && (!/^\d+$/.test(t) || t === "99")
  );
  return tokens.join(" ").trim().slice(0, 120);
}

/** Merchant matching key: first 3 stable tokens, preserving embedded digits. */
export function normalizedPattern(raw: string | null | undefined): string {
  return normalizeDescription(raw).split(" ").filter(Boolean).slice(0, 3).join(" ");
}


/**
 * Compatibility contract for existing import/dedupe consumers.
 * Uses the canonical Category Truth V2 merchant identity.
 */
export function merchantCanonical(
  raw: string | null | undefined,
): string {
  return normalizedPattern(raw);
}
