// Contrato canônico da extração multimodal.
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
  movement_kind?: "transaction" | "refund" | "internal_transfer" | "investment_application" | "investment_redemption" | "informational";
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
  "account" | "credit_card" | null?,
  string | null?,
  string | null?,
  ExtractedItem["movement_kind"]?,
  number | null?,
  number | null?,
  string | null?,
  string | null?,
  string | null?,
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
  const buf = await crypto.subtle.digest("SHA-256", bytes);
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

export function sanitize(result: unknown, fallbackDate: string): ExtractionResult {
  if (!result || typeof result !== "object") {
    return { document_kind: "unknown", items: [], notes: "unparseable" };
  }
  const r = result as Record<string, unknown>;
  const compactKind = typeof r.k === "string" ? r.k : null;
  const kind = String(r.document_kind ?? compactKind ?? "unknown") as ExtractionResult["document_kind"];
  const validKind: ExtractionResult["document_kind"] =
    ["receipt","invoice","statement","list","non_financial","illegible","unknown"].includes(kind)
      ? kind : "unknown";
  const rawItems = Array.isArray(r.items) ? r.items : Array.isArray(r.i) ? r.i : [];
  const items: ExtractedItem[] = [];
  for (const raw of rawItems) {
    if (Array.isArray(raw)) {
      const row = raw as CompactRow;
      const type = row[0] === "income" ? "income" : "expense";
      const description = String(row[3] ?? "").trim();
      if (!description || isNonTransactionLine(description)) continue;
      const amount = normalizeAmountBR(row[2]);
      if (amount == null) continue;
      const movementKind = (typeof row[7] === "string" ? row[7] : "transaction") as ExtractedItem["movement_kind"];
      if (movementKind === "informational") continue;
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
    if (!description || isNonTransactionLine(description)) continue;
    const movementKind = String(it.movement_kind ?? "transaction") as ExtractedItem["movement_kind"];
    // Linhas informativas não entram no livro. Transferências e movimentos de
    // investimento, porém, alteram o caixa da conta e precisam chegar à revisão.
    // Eles serão excluídos apenas dos indicadores de renda/consumo, nunca do saldo.
    if (movementKind === "informational") continue;
    const amount = normalizeAmountBR(it.amount as string | number);
    if (amount == null) continue;
    const type = it.type === "income" ? "income" : "expense";
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
  return { document_kind: validKind, items, notes: (r.notes as string | null) ?? (r.n as string | null) ?? null };
}
