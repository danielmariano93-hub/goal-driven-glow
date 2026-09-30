// Normalização canônica de estabelecimento (`merchant_truth.v1`).
// Fonte ÚNICA para todo o produto: relatórios, Nino, WhatsApp, antecipação e
// motores novos. Determinística e pura — nenhuma dependência de I/O.

export interface MerchantAliasRow {
  /** Texto normalizado observado no extrato/fatura. */
  alias_normalized?: string | null;
  /** Nome canônico escolhido pelo usuário ou pelo consenso global. */
  canonical_name?: string | null;
  /** Confiança do alias (0..1). Aliases fracos não sobrepõem o canônico. */
  confidence?: number | null;
}

/** Ruído recorrente de extratos e faturas brasileiros. */
const NOISE_TOKENS = [
  "compra",
  "cartao",
  "cartão",
  "debito",
  "credito",
  "pagamento",
  "pag",
  "pgto",
  "pix",
  "ted",
  "doc",
  "tarifa",
  "parcela",
  "parc",
  "recebimento",
  "transferencia",
  "boleto",
  "brl",
  "br",
  "ltda",
  "me",
  "sa",
  "eireli",
  "de",
  "da",
  "do",
  "em",
  "no",
  "na",
  "com",
  // Ruído de POS/PIX que escondia a marca real ("PIX WHATS QRCODE 99 FOOD").
  "whats",
  "whatsapp",
  "qrcode",
  "qr",
  "code",
  "atm",
  "tmob",
];

/**
 * Marcas cujo nome é (ou contém) apenas números. Sem esta lista o filtro de
 * tokens numéricos apagava "99" e o gasto desaparecia do ranking mesmo
 * continuando na categoria. `merchant_truth.v2`.
 */
const NUMERIC_BRAND_TOKENS = new Set(["99", "123", "365", "1746"]);

/** Prefixos de captura que antecedem o nome real no extrato. `merchant_truth.v3`. */
const POS_PREFIX_TOKENS = new Set(["pay", "on", "qrs", "transf", "ec", "mp", "elcss", "aut", "est"]);


/**
 * Marcas conhecidas: um token estável resolve o canônico mesmo com sufixos
 * de POS ("uber trip help.uber.com", "ifood *pedido 123").
 */
const KNOWN_BRANDS: Array<{ match: RegExp; canonical: string }> = [
  { match: /\bifood\b|\bi food\b|\bifd\b/, canonical: "iFood" },
  { match: /\buber\s*eats\b/, canonical: "Uber Eats" },
  // "DL*UBER" chega truncado como "PAY DL Ub" (processadora dLocal).
  { match: /\buber\b|\bdl\s*ub\b/, canonical: "Uber" },
  // 99 Food (delivery) antes de 99 (mobilidade): sinal específico manda, mesmo
  // com dígitos colados pelo extrato ("99 FOOD02/08", "PAY 99Foo", "99foo").
  { match: /\b99\s*foo\w*|\b99foo\w*|\b99\s*food/, canonical: "99 Food" },
  { match: /\b99\s*(app|pop|taxi)\b|\b99app\b|(?:^|\s)99(?:$|\s)/, canonical: "99" },
  { match: /\brappi\b/, canonical: "Rappi" },
  { match: /\bnetflix\b|\bnetfl\b/, canonical: "Netflix" },
  { match: /\bspotify\b/, canonical: "Spotify" },
  { match: /\bamazon\s*prime\b/, canonical: "Amazon Prime" },
  { match: /\bamazon\b/, canonical: "Amazon" },
  { match: /\bdisney\b/, canonical: "Disney+" },
  { match: /\bhbo|\bmax\s*stream/, canonical: "HBO Max" },
  { match: /\byoutube\b/, canonical: "YouTube" },
  { match: /\bopenai\b|\bchatgpt\b/, canonical: "ChatGPT" },
  { match: /\blovable/, canonical: "Lovable" },
  { match: /\bhostinger/, canonical: "Hostinger" },
  { match: /\bfacebk\b|\bfacebook\b|\bmeta\s*ads\b/, canonical: "Facebook" },
  { match: /\bgithub\b/, canonical: "GitHub" },
  { match: /\bgoogle\b/, canonical: "Google" },
  { match: /\bapple\b|\bitunes\b/, canonical: "Apple" },
  { match: /\btotalpass\b|\btotal pass\b/, canonical: "TotalPass" },
  { match: /\bgympass\b|\bwellhub\b/, canonical: "Wellhub" },
  { match: /\bifj|\bmercado\s*livre\b|\bmercadolivre\b/, canonical: "Mercado Livre" },
  { match: /\boxxo\b/, canonical: "OXXO" },
  { match: /\bstarbucks\b/, canonical: "Starbucks" },
  { match: /\bmcdon|\bmc donalds\b|\bbk\b|\bburger king\b/, canonical: "Fast food" },
  { match: /\bposto\b|\bipiranga\b|\bshell\b|\bpetrobras\b/, canonical: "Posto de combustível" },
  { match: /\bautopass\b|\bautop\b|\bbilhete\s*unico\b/, canonical: "Autopass" },
  { match: /\bmarket\s*4\s*you\b|\bmarket4you\b/, canonical: "Market4you" },
  { match: /\bsouk\s*4/, canonical: "Souk4u" },
  { match: /\blocaliza/, canonical: "Localiza" },
  { match: /\bturbi/, canonical: "Turbi" },
  { match: /\blalamove/, canonical: "Lalamove" },
  { match: /\bwhoosh\b/, canonical: "Whoosh" },
  { match: /\brd\s*saude/, canonical: "RD Saúde" },
  { match: /\bdroga\s*raia\b|\braia\d*\b|\bdrogasil\b/, canonical: "Droga Raia" },
  { match: /\bsympla\b/, canonical: "Sympla" },
  { match: /\beventim\b/, canonical: "Eventim" },
  { match: /\bmep\b/, canonical: "MEP Eventos" },
  { match: /\bzig\s*pay\b|\bzigpay\b|\bzig\b/, canonical: "ZigPay" },
  { match: /\bjim\s*com\b|\bjim\s*c\b/, canonical: "Jim.com" },
  { match: /\bblackzone\b|\bmp\s*bl\b/, canonical: "Blackzone" },
];

/**
 * Intermediadores de pagamento: NÃO são o estabelecimento econômico. Quando a
 * descrição só traz o intermediador, o gasto fica sem merchant resolvido (e
 * entra na cobertura como "não identificado") em vez de virar verdade.
 */
const PASS_THROUGH_BRANDS: RegExp[] = [
  /\bpagseguro\b/,
  /\bpag\s*bank\b|\bpagbank\b/,
  /\bmercado\s*pago\b|\bmercpago\b|\bmercadopago\b/,
  /\bpicpay\b/,
  /\bstone\b|\bcielo\b|\bgetnet\b|\bredecard\b/,
  /\bebanx\b|\badyen\b|\bpagar\s*me\b|\bstripe\b|\bpaygo\b|\bpagueveloz\b/,
];

/** A descrição traz apenas um intermediador de pagamento? */
export function isPassThroughMerchant(raw: string | null | undefined): boolean {
  const base = baseText(raw);
  if (!base) return false;
  if (!PASS_THROUGH_BRANDS.some((rx) => rx.test(base))) return false;
  // Se além do intermediador existir uma marca conhecida, a marca vence.
  return !KNOWN_BRANDS.some((b) => b.match.test(base));
}

function baseText(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Data colada ao nome pelo extrato ("UBER TRIP H03/01", "LALAMOVE TE09/03").
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Precedência canônica da identidade do estabelecimento (`merchant_truth.v2`).
 * Uma fonte única para todo o produto; nunca inventa texto.
 */
export function merchantSourceText(row: {
  merchant_name?: string | null;
  normalized_description?: string | null;
  friendly_description?: string | null;
  description?: string | null;
  bank_description?: string | null;
  raw_description?: string | null;
}): string | null {
  const candidates = [
    row.merchant_name,
    row.normalized_description,
    row.friendly_description,
    row.description,
    row.bank_description,
    row.raw_description,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;
    if (normalizeMerchant(value)) return value;
  }
  return null;
}

/**
 * Texto normalizado do estabelecimento: minúsculo, sem acento, sem ruído
 * bancário. Números só sobrevivem quando fazem parte de uma marca conhecida
 * ("99", "Market4you"). Retorna `null` quando não sobra sinal utilizável.
 */
export function normalizeMerchant(raw: string | null | undefined): string | null {
  const base = baseText(raw);
  if (!base) return null;

  const tokens = base
    .split(" ")
    .filter((tk) => tk.length > 0)
    .filter((tk) => !/^\d+$/.test(tk) || NUMERIC_BRAND_TOKENS.has(tk))
    .filter((tk) => !NOISE_TOKENS.includes(tk));
  // Prefixos de maquininha/PIX/e-commerce não são o estabelecimento
  // ("PAY -VENDI", "ON UBER", "PIX QRS ...", "MP*BLACKZONE", "EC *LOJA").
  while (tokens.length > 1 && POS_PREFIX_TOKENS.has(tokens[0])) tokens.shift();

  const cleaned = tokens.join(" ").trim();
  if (!cleaned) return null;
  const hasNumericBrand = tokens.some((tk) => NUMERIC_BRAND_TOKENS.has(tk));
  if (cleaned.length < 3 && !hasNumericBrand) return null;
  return cleaned;
}


/** Nome apresentável a partir do texto normalizado. */
export function merchantLabel(normalized: string): string {
  return normalized
    .split(" ")
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

export interface MerchantResolution {
  /** Chave estável usada para agrupar. */
  key: string;
  /** Nome exibível. */
  label: string;
  /** Como o canônico foi decidido. */
  source: "alias" | "brand" | "normalized";
}

export interface MerchantResolver {
  resolve(raw: string | null | undefined): MerchantResolution | null;
}

/**
 * Aliases genéricos jamais impõem identidade/categoria: são prefixos de POS,
 * não estabelecimentos. Governança de `merchant_truth.v2` (alias hygiene).
 */
const GENERIC_ALIAS_KEYS = new Set([
  "pay", "est", "pag", "pagto", "compra", "celular", "conta", "loja", "mercado",
  "posto", "farmacia", "padaria", "restaurante", "servico", "servicos", "outros",
]);

/** Classificação de risco de um alias aprendido. */
export function aliasSafety(alias: MerchantAliasRow & { confirmed?: boolean }): "safe" | "needs_review" | "dangerous" {
  const key = normalizeMerchant(alias.alias_normalized ?? null);
  if (!key) return "dangerous";
  if (GENERIC_ALIAS_KEYS.has(key)) return "dangerous";
  const tokens = key.split(" ").filter(Boolean);
  const specific = key.length >= 4 || tokens.some((tk) => NUMERIC_BRAND_TOKENS.has(tk));
  if (!specific) return "dangerous";
  const confidence = typeof alias.confidence === "number" ? alias.confidence : 0;
  if (alias.confirmed && confidence >= 0.9) return "safe";
  if (confidence >= 0.9) return "needs_review";
  return "needs_review";
}

/**
 * Cria o resolvedor canônico. Precedência: alias específico do usuário/global
 * (confiança >= 0.5 e não genérico) → marca conhecida → texto normalizado.
 * Intermediadores de pagamento sozinhos não resolvem estabelecimento.
 */
export function buildMerchantResolver(aliases: MerchantAliasRow[] = []): MerchantResolver {
  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    const normalized = normalizeMerchant(a.alias_normalized ?? null);
    const canonical = (a.canonical_name ?? "").trim();
    if (!normalized || !canonical) continue;
    if (typeof a.confidence === "number" && a.confidence < 0.5) continue;
    if (aliasSafety(a) === "dangerous") continue;
    aliasMap.set(normalized, canonical);
  }

  const cache = new Map<string, MerchantResolution | null>();

  return {
    resolve(raw) {
      const cacheKey = String(raw ?? "");
      if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

      const base = baseText(raw);
      const normalized = normalizeMerchant(raw);
      let resolution: MerchantResolution | null = null;

      // Marca conhecida vence intermediador e ruído, mesmo antes da limpeza.
      const brandFromBase = base ? KNOWN_BRANDS.find((b) => b.match.test(base)) : undefined;

      if (isPassThroughMerchant(raw)) {
        cache.set(cacheKey, null);
        return null;
      }

      if (normalized) {
        const alias = aliasMap.get(normalized);
        const brand = brandFromBase ?? KNOWN_BRANDS.find((b) => b.match.test(normalized));
        if (alias) {
          resolution = { key: alias.toLowerCase(), label: alias, source: "alias" };
        } else if (brand) {
          resolution = { key: brand.canonical.toLowerCase(), label: brand.canonical, source: "brand" };
        } else {
          resolution = { key: normalized, label: merchantLabel(normalized), source: "normalized" };
        }
      } else if (brandFromBase) {
        resolution = { key: brandFromBase.canonical.toLowerCase(), label: brandFromBase.canonical, source: "brand" };
      }

      cache.set(cacheKey, resolution);
      return resolution;
    },
  };
}


/** Resolve um termo digitado pelo usuário ("uber", "ifood") para chave canônica. */
export function merchantQueryKey(term: string, resolver?: MerchantResolver): string | null {
  const r = (resolver ?? buildMerchantResolver()).resolve(term);
  return r?.key ?? null;
}

/** O termo buscado casa com esta chave canônica? (aceita busca parcial). */
export function merchantMatches(key: string, label: string, term: string): boolean {
  const normalizedTerm = normalizeMerchant(term);
  if (!normalizedTerm) return false;
  const haystack = `${key} ${label}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return haystack.includes(normalizedTerm) || normalizedTerm.includes(key.toLowerCase());
}
