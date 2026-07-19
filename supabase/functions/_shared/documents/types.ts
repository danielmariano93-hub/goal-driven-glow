// Contrato canônico da extração multimodal.
export const CANONICAL_MOVEMENT_KINDS = [
  "transaction", "refund", "internal_transfer",
  "investment_application", "investment_redemption",
] as const;
export type MovementKind = typeof CANONICAL_MOVEMENT_KINDS[number];

export type ExtractedItem = {
  type: "income" | "expense";
  description: string;
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  payment_method: "account" | "credit_card" | null;
  account_hint: string | null;
  card_hint: string | null;
  category_hint: string | null;
  installments_total: number | null;
  installment_number: number | null;
  purchase_date: string | null;
  competence_date: string | null;
  confidence: Record<string, number>;
  movement_kind?: MovementKind | "informational";
  source_span?: unknown;
};

export type ExtractionResult = {
  document_kind: "receipt" | "invoice" | "statement" | "list" | "non_financial" | "illegible" | "unknown";
  items: ExtractedItem[];
  notes: string | null;
};

type CompactRow = [
  "expense" | "income",
  string,
  string | number,
  string,
  ("account" | "credit_card" | null)?,
  (string | null)?,
  (string | null)?,
  ExtractedItem["movement_kind"]?,
  (number | null)?,
  (number | null)?,
  (string | null)?,
  (string | null)?,
  (string | null)?,
];

export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const MAX_BYTES = 20 * 1024 * 1024;

// Magic bytes: PNG, JPEG, WebP, PDF
export function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const buf = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeAmountBR(raw: string | number): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/[R$\s]/g, "");
  // 1.234,56 -> 1234.56 ; 1,234.56 -> 1234.56 ; 12.50 -> 12.50
  const commaLast = s.lastIndexOf(",");
  const dotLast = s.lastIndexOf(".");
  let n: number;
  if (commaLast > dotLast) {
    n = Number(s.replace(/\./g, "").replace(",", "."));
  } else {
    n = Number(s.replace(/,/g, ""));
  }
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Preserva `informational` como estágio intermediário. sanitize() é quem
 * remove informational da lista final — nunca vira transação persistida.
 */
export function normalizeMovementKind(
  raw: unknown,
  _type: "income" | "expense",
): MovementKind | "informational" {
  const value = String(raw ?? "transaction").trim().toLowerCase();
  const aliases: Record<string, MovementKind | "informational"> = {
    transaction: "transaction", purchase: "transaction", debit: "transaction", credit: "transaction",
    pix: "transaction", pix_in: "transaction", pix_out: "transaction",
    refund: "refund", reimbursement: "refund", estorno: "refund",
    internal_transfer: "internal_transfer", transfer: "internal_transfer",
    investment_application: "investment_application", investment_apply: "investment_application",
    investment_redemption: "investment_redemption", investment_redeem: "investment_redemption", redeem: "investment_redemption",
    informational: "informational", info: "informational",
    saldo: "informational", balance: "informational", limit: "informational", limite: "informational",
    subtotal: "informational", total: "informational", header: "informational", cabecalho: "informational",
    resumo: "informational", summary: "informational", periodo: "informational", period: "informational",
  };
  return aliases[value] ?? "transaction";
}

export function normalizeDateBR(raw: string, fallback: string, confidence = 0): string {
  if (!raw) return fallback;
  let candidate: string | null = null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!candidate && br) {
    let y = br[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    candidate = `${y}-${br[2]}-${br[1]}`;
  }
  if (!candidate) return fallback;
  const parsed = new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) return fallback;
  const reference = new Date(`${fallback}T12:00:00Z`);
  const distanceDays = Math.abs(parsed.getTime() - reference.getTime()) / 86_400_000;
  const futureDays = (parsed.getTime() - reference.getTime()) / 86_400_000;
  if (futureDays > 1) return fallback;
  // A distant date is accepted only when the model is exceptionally certain.
  // This prevents UI years and statement references from becoming transaction dates.
  if (distanceDays > 370 && confidence < 0.9) return fallback;
  return candidate;
}

// Palavras-chave que NUNCA viram lançamento
const NON_TX_KEYWORDS = [
  "saldo disponível", "saldo total", "saldo anterior", "saldo atual", "saldo em conta", "saldo do dia",
  "limite disponível", "limite utilizado", "limite da conta", "limite total", "subtotal", "total da fatura", "vencimento",
  "período de visualização", "periodo de visualizacao", "emitido em", "extrato conta", "lançamentos",
  "pagamento efetuado - fatura", "pagamento fatura", "pagamento da fatura",
];

export function isNonTransactionLine(description: string): boolean {
  const d = description.toLowerCase();
  return NON_TX_KEYWORDS.some((k) => d.includes(k));
}

export type SanitizeCounters = { informational_dropped: number; non_transaction_dropped: number };
export type SanitizeResult = ExtractionResult & { informational_dropped?: number; non_transaction_dropped?: number };

export function sanitize(result: unknown, fallbackDate: string): SanitizeResult {
  if (!result || typeof result !== "object") {
    return { document_kind: "unknown", items: [], notes: "unparseable", informational_dropped: 0, non_transaction_dropped: 0 };
  }
  const r = result as Record<string, unknown>;
  const compactKind = typeof r.k === "string" ? r.k : null;
  const kind = String(r.document_kind ?? compactKind ?? "unknown") as ExtractionResult["document_kind"];
  const validKind: ExtractionResult["document_kind"] =
    ["receipt","invoice","statement","list","non_financial","illegible","unknown"].includes(kind)
      ? kind : "unknown";
  const rawItems = Array.isArray(r.items) ? r.items : Array.isArray(r.i) ? r.i : [];
  const items: ExtractedItem[] = [];
  let informational_dropped = 0;
  let non_transaction_dropped = 0;
  for (const raw of rawItems) {
    if (Array.isArray(raw)) {
      const row = raw as CompactRow;
      const type = row[0] === "income" ? "income" : "expense";
      const description = String(row[3] ?? "").trim();
      if (!description) continue;
      if (isNonTransactionLine(description)) { non_transaction_dropped++; continue; }
      const movementKind = normalizeMovementKind(row[7], type);
      if (movementKind === "informational") { informational_dropped++; continue; }
      const amount = normalizeAmountBR(row[2]);
      if (amount == null) continue;
      const occurred_at = normalizeDateBR(String(row[1] ?? ""), fallbackDate, 0.9);
      const paymentRaw = row[4];
      const payment_method = paymentRaw === "account" || paymentRaw === "credit_card" ? paymentRaw : null;
      items.push({
        type,
        description: description.slice(0, 200),
        amount,
        occurred_at,
        payment_method,
        account_hint: typeof row[5] === "string" ? row[5] : null,
        card_hint: typeof row[6] === "string" ? row[6] : null,
        category_hint: typeof row[12] === "string" ? row[12] : null,
        installments_total: typeof row[8] === "number" && row[8] >= 1 && row[8] <= 48 ? row[8] : null,
        installment_number: typeof row[9] === "number" && row[9] >= 1 && row[9] <= 48 ? row[9] : null,
        purchase_date: typeof row[10] === "string" ? normalizeDateBR(row[10], occurred_at) : null,
        competence_date: typeof row[11] === "string" ? normalizeDateBR(row[11], occurred_at) : null,
        confidence: { amount: 0.85, occurred_at: 0.85 },
        movement_kind: movementKind,
        source_span: null,
      });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const description = String(it.description ?? "").trim();
    if (!description) continue;
    if (isNonTransactionLine(description)) { non_transaction_dropped++; continue; }
    const type = it.type === "income" ? "income" : "expense";
    const movementKind = normalizeMovementKind(it.movement_kind, type);
    if (movementKind === "informational") { informational_dropped++; continue; }
    const amount = normalizeAmountBR(it.amount as string | number);
    if (amount == null) continue;
    const conf = (it.confidence && typeof it.confidence === "object") ? it.confidence as Record<string, number> : {};
    const dateConfidence = Number(conf.occurred_at ?? 0);
    const occurred_at = normalizeDateBR(String(it.occurred_at ?? ""), fallbackDate, dateConfidence);
    const paymentRaw = it.payment_method;
    const payment_method = paymentRaw === "account" || paymentRaw === "credit_card" ? paymentRaw : null;
    items.push({
      type,
      description: description.slice(0, 200),
      amount,
      occurred_at,
      payment_method,
      account_hint: (it.account_hint as string | null) ?? null,
      card_hint: (it.card_hint as string | null) ?? null,
      category_hint: (it.category_hint as string | null) ?? null,
      installments_total: typeof it.installments_total === "number" && it.installments_total >= 1 && it.installments_total <= 48 ? it.installments_total : null,
      installment_number: typeof it.installment_number === "number" && it.installment_number >= 1 && it.installment_number <= 48 ? it.installment_number : null,
      purchase_date: typeof it.purchase_date === "string" ? normalizeDateBR(it.purchase_date, occurred_at) : null,
      competence_date: typeof it.competence_date === "string" ? normalizeDateBR(it.competence_date, occurred_at) : null,
      confidence: conf,
      movement_kind: movementKind,
      source_span: it.source_span,
    });
  }
  return {
    document_kind: validKind,
    items,
    notes: (r.notes as string | null) ?? (r.n as string | null) ?? null,
    informational_dropped,
    non_transaction_dropped,
  };
}

// ---------- Whitelists (must mirror extracted_items CHECK constraints) ----------
export const ALLOWED_TYPES = new Set(["income", "expense"]);
export const ALLOWED_MOVEMENT_KINDS: Set<string> = new Set(CANONICAL_MOVEMENT_KINDS);
export const ALLOWED_PAYMENT_METHODS = new Set(["account", "credit_card"]);
export const ALLOWED_STATUSES = new Set([
  "needs_review", "ignored", "confirmed",
  "duplicate_suspect", "rejected", "failed", "rolled_back",
]);

export type ValidationOutcome<T> =
  | { ok: true; row: T }
  | { ok: false; reason: string; field: string };

/** Guards every field a row will hit against the real DB constraints. Any
 *  unknown/invalid value produces a quarantined row instead of a hard failure.
 */
export function validateExtractedRow<T extends Record<string, unknown>>(row: T): ValidationOutcome<T> {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "invalid_amount", field: "amount" };

  const type = String(row.type ?? "");
  if (!ALLOWED_TYPES.has(type)) return { ok: false, reason: "invalid_type", field: "type" };

  const mk = String(row.movement_kind ?? "transaction");
  if (!ALLOWED_MOVEMENT_KINDS.has(mk)) return { ok: false, reason: "invalid_movement_kind", field: "movement_kind" };

  const pm = row.payment_method;
  if (pm != null && !ALLOWED_PAYMENT_METHODS.has(String(pm))) return { ok: false, reason: "invalid_payment_method", field: "payment_method" };

  const occ = String(row.occurred_at ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occ)) return { ok: false, reason: "invalid_date", field: "occurred_at" };
  const parsed = new Date(`${occ}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== occ) {
    return { ok: false, reason: "invalid_date", field: "occurred_at" };
  }

  const description = String(row.description ?? "").trim();
  if (!description) return { ok: false, reason: "empty_description", field: "description" };

  const it = Number(row.installments_total ?? 0);
  if (row.installments_total != null && (!Number.isInteger(it) || it < 1 || it > 48)) {
    return { ok: false, reason: "invalid_installments_total", field: "installments_total" };
  }
  const iN = Number(row.installment_number ?? 0);
  if (row.installment_number != null && (!Number.isInteger(iN) || iN < 1 || iN > 48)) {
    return { ok: false, reason: "invalid_installment_number", field: "installment_number" };
  }

  return { ok: true, row: { ...row, movement_kind: mk } as T };
}
