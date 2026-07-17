// Normalização amigável de descrições bancárias e fingerprint de dedupe.
// Uso: raw = texto original do banco; friendly = descrição apresentada ao usuário.

const MERCHANT_DICT: Array<{ pattern: RegExp; canonical: string; category?: string }> = [
  { pattern: /\bubereats\b|\buber\s*eats\b/i, canonical: "Uber Eats", category: "Alimentação" },
  { pattern: /\buber(?!\s*eats)\b|\buber\s*trip\b|\buber\s*br\b/i, canonical: "Uber", category: "Transporte" },
  { pattern: /\b99\s*(?:app|pop|taxi)?\b/i, canonical: "99", category: "Transporte" },
  { pattern: /\bifood\b|\bi[- ]?food\b/i, canonical: "iFood", category: "Alimentação" },
  { pattern: /\brappi\b/i, canonical: "Rappi", category: "Alimentação" },
  { pattern: /\bnetflix\b/i, canonical: "Netflix", category: "Assinaturas" },
  { pattern: /\bspotify\b/i, canonical: "Spotify", category: "Assinaturas" },
  { pattern: /\bamazon\s*prime\b/i, canonical: "Amazon Prime", category: "Assinaturas" },
  { pattern: /\bamazon\b/i, canonical: "Amazon", category: "Compras" },
  { pattern: /\bmercado\s*livre\b|\bmercadolivre\b/i, canonical: "Mercado Livre", category: "Compras" },
  { pattern: /\bshopee\b/i, canonical: "Shopee", category: "Compras" },
  { pattern: /\baliexpress\b/i, canonical: "AliExpress", category: "Compras" },
  { pattern: /\bpicpay\b/i, canonical: "PicPay" },
  { pattern: /\bmercadopago\b|\bmercado\s*pago\b/i, canonical: "Mercado Pago" },
  { pattern: /\bposto\b|\bshell\b|\bipiranga\b|\bpetrobr[aá]s?\b|\bipiranga\b/i, canonical: "Combustível", category: "Transporte" },
  { pattern: /\bfarma(?:cia)?\b|\bdrogar?ia\b|\bdrogasil\b|\bpacheco\b|\braia\b/i, canonical: "Farmácia", category: "Saúde" },
  { pattern: /\bmc\s*donalds?\b|\bmcdonalds?\b/i, canonical: "McDonald's", category: "Alimentação" },
  { pattern: /\bburger\s*king\b|\bbk\b/i, canonical: "Burger King", category: "Alimentação" },
  { pattern: /\bstarbucks\b/i, canonical: "Starbucks", category: "Alimentação" },
  { pattern: /\bcarrefour\b/i, canonical: "Carrefour", category: "Mercado" },
  { pattern: /\bp[aã]o\s*de\s*a[çc][uú]car\b/i, canonical: "Pão de Açúcar", category: "Mercado" },
  { pattern: /\bassa[íi]\b/i, canonical: "Assaí", category: "Mercado" },
  { pattern: /\bextra\b/i, canonical: "Extra", category: "Mercado" },
  { pattern: /\bautopass\b|\bautop\b/i, canonical: "Autopass", category: "Transporte" },
  { pattern: /\benel\b/i, canonical: "Enel", category: "Moradia" },
  { pattern: /\bclaro\b/i, canonical: "Claro", category: "Moradia" },
  { pattern: /\btotal\s*pass\b/i, canonical: "TotalPass", category: "Saúde" },
  { pattern: /\bcobasi\b/i, canonical: "Cobasi", category: "Pets" },
  { pattern: /\bsympla\b/i, canonical: "Sympla", category: "Lazer" },
  { pattern: /\bseguro\s+cart[aã]o\b/i, canonical: "Seguro do cartão", category: "Financeiro" },
  { pattern: /\bnetfl\b/i, canonical: "Netflix", category: "Assinaturas" },
  { pattern: /\b99\s*food\b/i, canonical: "99Food", category: "Alimentação" },
  { pattern: /\baplica[cç][aã]o\s+cdb\b/i, canonical: "Aplicação em CDB" },
  { pattern: /\bresgate\s+cdb\b/i, canonical: "Resgate de CDB" },
  { pattern: /\brend\s+pago\s+aplic\b/i, canonical: "Rendimento de aplicação" },
];

const NOISE_PATTERNS: RegExp[] = [
  /\b(?:on|electron|compra|pag|pagamento|pgto|debito|d[eé]bito|credito|cr[eé]dito|par[cç]?|parc(?:ela)?)\b/gi,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // dates dd/mm or dd/mm/yy
  /\b\d{4,}\b/g, // long codes
  /\btrip\b/gi,
  /\*+/g,
  /[·•]+/g,
];

/** Extrai referência bancária (código de autorização, id de transação) se detectável. */
export function extractBankReference(raw: string): string | null {
  if (!raw) return null;
  // "ID: 123456", "Aut. 987654", "Ref 123..."
  const m = raw.match(/\b(?:id|aut(?:oriza[cç][aã]o)?|ref(?:er[êe]ncia)?)[:\s.]+([A-Z0-9-]{6,32})\b/i);
  if (m) return m[1].toUpperCase();
  // Long numeric-only sequences 10+ digits (some banks use for e2e)
  const n = raw.match(/\b(\d{10,32})\b/);
  return n ? n[1] : null;
}

/** Extrai contraparte de PIX de forma amigável. */
function extractPixCounterparty(raw: string): string | null {
  // Padrões: "PIX ENVIADO JOAO DA SILVA", "PIX RECEBIDO - MARIA", "PIX QRCODE ABC"
  const m = raw.match(/\bpix(?:\s+(?:enviado|recebido|out|in|transf(?:er[êe]ncia)?|qr(?:code)?|whats?(?:app)?))?[\s\-:]+([\p{L}][\p{L}\s.'-]{2,60})/iu);
  if (!m) return null;
  const name = m[1].trim()
    .replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/g, "")
    .replace(/\d{4}\s*$/g, "")
    .replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(name)) return null;
  // Title case
  return name.split(" ").map((w) => w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/**
 * Normaliza descrição para exibição ao usuário.
 * Estratégia: 1) merchant dictionary; 2) PIX contraparte; 3) limpeza de ruído; 4) fallback = texto do banco limpo.
 * Nunca inventa: se o banco não deu nada útil, retorna raw sanitizado.
 */
export function normalizeDescription(raw: string): { friendly: string; category_hint: string | null } {
  const cleanRaw = (raw ?? "").trim();
  if (!cleanRaw) return { friendly: "", category_hint: null };

  for (const entry of MERCHANT_DICT) {
    if (entry.pattern.test(cleanRaw)) {
      return { friendly: entry.canonical, category_hint: entry.category ?? null };
    }
  }

  const pix = extractPixCounterparty(cleanRaw);
  if (pix) return { friendly: `PIX ${pix}`, category_hint: null };

  let cleaned = cleanRaw;
  for (const p of NOISE_PATTERNS) cleaned = cleaned.replace(p, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Title case for uppercase-only strings
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned.toLowerCase().split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return { friendly: cleaned || cleanRaw, category_hint: null };
}

/** Chave estável para dedupe. Usa referência bancária quando disponível (chave forte). */
export async function computeFingerprint(input: {
  user_id: string;
  type: "income" | "expense";
  occurred_at: string;
  amount: number;
  account_id?: string | null;
  credit_card_id?: string | null;
  bank_reference?: string | null;
  normalized_description?: string | null;
}): Promise<string> {
  const parts = [
    input.user_id,
    input.type,
    input.occurred_at,
    Math.round(input.amount * 100).toString(),
    input.account_id ?? input.credit_card_id ?? "",
    input.bank_reference ?? "",
    (input.normalized_description ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
  ];
  const raw = parts.join("|");
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
