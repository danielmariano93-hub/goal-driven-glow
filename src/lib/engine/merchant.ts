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
];

/**
 * Marcas conhecidas: um token estável resolve o canônico mesmo com sufixos
 * de POS ("uber trip help.uber.com", "ifood *pedido 123").
 */
const KNOWN_BRANDS: Array<{ match: RegExp; canonical: string }> = [
  { match: /\bifood\b|\bi food\b/, canonical: "iFood" },
  { match: /\buber\s*eats\b/, canonical: "Uber Eats" },
  { match: /\buber\b/, canonical: "Uber" },
  { match: /\b99\s*(app|pop|taxi)\b|\b99app\b/, canonical: "99" },
  { match: /\brappi\b/, canonical: "Rappi" },
  { match: /\bnetflix\b/, canonical: "Netflix" },
  { match: /\bspotify\b/, canonical: "Spotify" },
  { match: /\bamazon\s*prime\b/, canonical: "Amazon Prime" },
  { match: /\bamazon\b/, canonical: "Amazon" },
  { match: /\bdisney\b/, canonical: "Disney+" },
  { match: /\bhbo|\bmax\s*stream/, canonical: "HBO Max" },
  { match: /\byoutube\b/, canonical: "YouTube" },
  { match: /\bopenai\b|\bchatgpt\b/, canonical: "ChatGPT" },
  { match: /\blovable\b/, canonical: "Lovable" },
  { match: /\bgithub\b/, canonical: "GitHub" },
  { match: /\bgoogle\b/, canonical: "Google" },
  { match: /\bapple\b|\bitunes\b/, canonical: "Apple" },
  { match: /\btotalpass\b|\btotal pass\b/, canonical: "TotalPass" },
  { match: /\bgympass\b|\bwellhub\b/, canonical: "Wellhub" },
  { match: /\bifj|\bmercado\s*livre\b|\bmercadolivre\b/, canonical: "Mercado Livre" },
  { match: /\boxxo\b/, canonical: "OXXO" },
  { match: /\bstarbucks\b/, canonical: "Starbucks" },
  { match: /\bmcdonald|\bmc donalds\b|\bbk\b|\bburger king\b/, canonical: "Fast food" },
  { match: /\bposto\b|\bipiranga\b|\bshell\b|\bpetrobras\b/, canonical: "Posto de combustível" },
  { match: /\bautopass\b|\bbilhete\s*unico\b/, canonical: "Autopass" },
];

/**
 * Texto normalizado do estabelecimento: minúsculo, sem acento, sem números e
 * sem ruído bancário. Retorna `null` quando não sobra sinal utilizável.
 */
export function normalizeMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return null;

  const tokens = base
    .split(" ")
    .filter((tk) => tk.length > 0)
    .filter((tk) => !/^\d+$/.test(tk))
    .filter((tk) => !NOISE_TOKENS.includes(tk));

  const cleaned = tokens.join(" ").trim();
  if (cleaned.length < 3) return null;
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
 * Cria o resolvedor canônico. Precedência: alias do usuário/global (quando
 * confiança >= 0.5) → marca conhecida → texto normalizado.
 */
export function buildMerchantResolver(aliases: MerchantAliasRow[] = []): MerchantResolver {
  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    const normalized = normalizeMerchant(a.alias_normalized ?? null);
    const canonical = (a.canonical_name ?? "").trim();
    if (!normalized || !canonical) continue;
    if (typeof a.confidence === "number" && a.confidence < 0.5) continue;
    aliasMap.set(normalized, canonical);
  }

  const cache = new Map<string, MerchantResolution | null>();

  return {
    resolve(raw) {
      const cacheKey = String(raw ?? "");
      if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

      const normalized = normalizeMerchant(raw);
      let resolution: MerchantResolution | null = null;

      if (normalized) {
        const alias = aliasMap.get(normalized);
        if (alias) {
          resolution = { key: alias.toLowerCase(), label: alias, source: "alias" };
        } else {
          const brand = KNOWN_BRANDS.find((b) => b.match.test(normalized));
          if (brand) {
            resolution = { key: brand.canonical.toLowerCase(), label: brand.canonical, source: "brand" };
          } else {
            resolution = { key: normalized, label: merchantLabel(normalized), source: "normalized" };
          }
        }
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
