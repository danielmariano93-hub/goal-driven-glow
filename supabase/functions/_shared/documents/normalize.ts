// Normalização amigável de descrições bancárias e fingerprint de dedupe.
// Uso: raw = texto original do banco; friendly = descrição apresentada ao usuário.
// Também emite `movement_kind` quando a assinatura da descrição é inequívoca
// (aplicação/resgate/rendimento/crédito de empréstimo/estorno). Nunca inferir
// estabelecimentos ambíguos (PIX genérico, códigos opacos).

type Rule = { pattern: RegExp; canonical: string; category?: string; movement_kind?: string };

const MERCHANT_DICT: Array<Rule> = [
  // Delivery / apps
  { pattern: /\bubereats\b|\buber\s*eats\b/i, canonical: "Uber Eats", category: "Alimentação" },
  { pattern: /\bestorno\s+uber\b|\buber\s+estorno\b/i, canonical: "Estorno Uber", category: "Transporte", movement_kind: "refund" },
  { pattern: /\buber(?!\s*eats)\b|\buber\s*trip\b|\buber\s*br\b/i, canonical: "Uber", category: "Transporte" },
  { pattern: /\b99\s*(?:app|pop|taxi)?\b/i, canonical: "99", category: "Transporte" },
  { pattern: /\bifood\b|\bi[- ]?food\b|\bpay\s*ifd\b|\bpay\s*if\b/i, canonical: "iFood", category: "Alimentação" },
  { pattern: /\brappi\b/i, canonical: "Rappi", category: "Alimentação" },
  // Streaming / assinaturas
  { pattern: /\bnetflix\b|\bnetfl\b/i, canonical: "Netflix", category: "Assinaturas" },
  { pattern: /\bspotify\b/i, canonical: "Spotify", category: "Assinaturas" },
  { pattern: /\bamazon\s*prime\b/i, canonical: "Amazon Prime", category: "Assinaturas" },
  { pattern: /\bamazon\b/i, canonical: "Amazon", category: "Compras" },
  // Marketplaces
  { pattern: /\bmercado\s*livre\b|\bmercadolivre\b/i, canonical: "Mercado Livre", category: "Compras" },
  { pattern: /\bshopee\b/i, canonical: "Shopee", category: "Compras" },
  { pattern: /\baliexpress\b/i, canonical: "AliExpress", category: "Compras" },
  { pattern: /\bpicpay\b/i, canonical: "PicPay" },
  { pattern: /\bmercadopago\b|\bmercado\s*pago\b/i, canonical: "Mercado Pago" },
  // Combustível
  { pattern: /\bposto\b|\bshell\b|\bipiranga\b|\bpetrobr[aá]s?\b/i, canonical: "Combustível", category: "Transporte" },
  { pattern: /\bfarma(?:cia)?\b|\bdrogar?ia\b|\bdrogasil\b|\bpacheco\b|\braia\b/i, canonical: "Farmácia", category: "Saúde" },
  // Fast food
  { pattern: /\bmc\s*donalds?\b|\bmcdonalds?\b/i, canonical: "McDonald's", category: "Alimentação" },
  { pattern: /\bburger\s*king\b|\bbk\b/i, canonical: "Burger King", category: "Alimentação" },
  { pattern: /\bstarbucks\b/i, canonical: "Starbucks", category: "Alimentação" },
  { pattern: /\bpay\s*lanch\w*\b|\blanchonete\b/i, canonical: "Lanche", category: "Alimentação" },
  // Mercado
  { pattern: /\bcarrefour\b/i, canonical: "Carrefour", category: "Mercado" },
  { pattern: /\bp[aã]o\s*de\s*a[çc][uú]car\b/i, canonical: "Pão de Açúcar", category: "Mercado" },
  { pattern: /\bassa[íi]\b/i, canonical: "Assaí", category: "Mercado" },
  { pattern: /\bextra\b/i, canonical: "Extra", category: "Mercado" },
  { pattern: /\bpay\s*souk4\b|\bmarket\s*4\s*you\b|\bmarket4you\b/i, canonical: "Market4you", category: "Mercado" },
  { pattern: /\bpay\s*oxxo\b|\boxxo\b/i, canonical: "OXXO", category: "Mercado" },
  // Nutri / restaurantes locais
  { pattern: /\bnutricar\b|\bnutri\b(?!\w)/i, canonical: "Nutricar", category: "Alimentação" },
  // Lazer / eventos
  { pattern: /\bpay\s*mep\b|\bmep\s*eventos?\b/i, canonical: "MEP Eventos", category: "Lazer" },
  { pattern: /\bsympla\b/i, canonical: "Sympla", category: "Lazer" },
  // Transporte urbano
  { pattern: /\bautopass\b|\bautop\b/i, canonical: "Autopass", category: "Transporte" },
  // Moradia / contas
  { pattern: /\benel\b/i, canonical: "Enel", category: "Moradia" },
  { pattern: /\bclaro\b/i, canonical: "Claro", category: "Moradia" },
  { pattern: /\btotal\s*pass\b/i, canonical: "TotalPass", category: "Saúde" },
  { pattern: /\bcobasi\b/i, canonical: "Cobasi", category: "Pets" },
  // Financeiro / seguros
  { pattern: /\bseguro\s+(?:cart[aã]o|do\s+cart[aã]o)\b/i, canonical: "Seguro do cartão", category: "Seguros" },
  { pattern: /\b99\s*food\b/i, canonical: "99Food", category: "Alimentação" },
  // Investimentos e crédito — inferências patrimoniais seguras (definem movement_kind).
  { pattern: /\baplica[cç][aã]o\s+(?:cdb|autom[aá]tica)\b|\baplic\s+autom/i, canonical: "Aplicação em CDB", movement_kind: "investment_application" },
  { pattern: /\bresgate\s+(?:cdb|autom[aá]tico)\b|\bresg\s+autom/i, canonical: "Resgate de CDB", movement_kind: "investment_redemption" },
  { pattern: /\brend\s+pago\s+aplic\b|\brendimento\s+(?:pago|aplic)/i, canonical: "Rendimento de aplicação", movement_kind: "investment_yield" },
  { pattern: /\bbanco\s+pan\b.*\breneg/i, canonical: "Pagamento de renegociação — Banco PAN", category: "Dívidas e empréstimos" },
  { pattern: /\brecebimento\s+reneg\b|\bempr[eé]stimo\s+creditado\b|\bconsignado\s+creditad/i, canonical: "Crédito de empréstimo", category: "Dívidas e empréstimos", movement_kind: "loan_proceeds" },
];

const NOISE_PATTERNS: RegExp[] = [
  /\b(?:on|electron|compra|pag|pagamento|pgto|debito|d[eé]bito|credito|cr[eé]dito|par[cç]?|parc(?:ela)?)\b/gi,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{4,}\b/g,
  /\btrip\b/gi,
  /\*+/g,
  /[·•]+/g,
];

/** Chave canônica para busca em merchant_aliases (mesma normalização do RPC). */
export function aliasKeyFrom(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
}


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
  ordinal?: number | null;
}): Promise<string> {
  const parts = [
    input.user_id,
    input.type,
    input.occurred_at,
    Math.round(input.amount * 100).toString(),
    input.account_id ?? input.credit_card_id ?? "",
    input.bank_reference ?? "",
    (input.normalized_description ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    // Preserva multiplicidade legítima: duas linhas idênticas no mesmo doc ganham
    // ordinais diferentes e portanto fingerprints distintos. Ignorado quando há
    // referência bancária (essa já é única por natureza).
    input.ordinal != null && !input.bank_reference ? `#${input.ordinal}` : "",
  ];
  const raw = parts.join("|");
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
