import { storageMerchantKey } from "./normalize.ts";

export type CuratedMerchant = {
  canonical_name: string;
  semantic_category: string;
  patterns: RegExp[];
  /**
   * Marca de altíssima precisão: nenhuma camada aprendida (alias/preferência
   * pessoal poluída por importação) pode contradizê-la. `merchant_truth.v2`.
   */
  authoritative?: boolean;
};

// High-precision, cross-user knowledge only. Ambiguous merchants stay out.
export const CURATED_MERCHANTS: CuratedMerchant[] = [
  { canonical_name: "Autopass", semantic_category: "Transporte", authoritative: true, patterns: [/\bautopass\b/i, /\bautop\b/i] },
  { canonical_name: "Uber Eats", semantic_category: "Alimentação", authoritative: true, patterns: [/\buber[\s*._-]*eats\b/i] },
  { canonical_name: "Uber", semantic_category: "Transporte", authoritative: true, patterns: [/\buber(?![\s*._-]*eats)\b/i] },
  // 99 Food (delivery) SEMPRE antes de 99 (mobilidade). Dígitos colados no
  // extrato ("99 FOOD02/08", "PAY 99Foo") não podem cair em Transporte.
  {
    canonical_name: "99 Food",
    semantic_category: "Alimentação",
    authoritative: true,
    patterns: [/\b99\s*foo\w*/i, /\b99foo\w*/i, /\b99\s*food/i, /\bpay\s*99\s*foo\w*/i],
  },
  {
    canonical_name: "99",
    semantic_category: "Transporte",
    authoritative: true,
    patterns: [/\b99\s*(?:app|pop|taxi)\b/i, /\b99app\b/i],
  },
  // Seguro de cartão é proteção financeira, nunca assinatura de serviço.
  {
    canonical_name: "Seguro de cartão",
    semantic_category: "Seguros",
    authoritative: true,
    patterns: [/\bseguro\s+(?:do\s+)?cart[aã]o\b/i, /\bseguro\s+cart[aã]o\b/i, /\bseguro\s+prote[cç][aã]o\s+cart/i],
  },
  { canonical_name: "iFood", semantic_category: "Alimentação", patterns: [/\bifood\b/i, /\bi[- ]?food\b/i, /\bpay\s*ifd\b/i] },
  { canonical_name: "Rappi", semantic_category: "Alimentação", patterns: [/\brappi\b/i] },
  { canonical_name: "Drogasil", semantic_category: "Saúde", patterns: [/\bdrogasil\b/i] },
  { canonical_name: "Droga Raia", semantic_category: "Saúde", patterns: [/\bdroga\s*raia\b/i, /\braia\b/i] },
  { canonical_name: "Carrefour", semantic_category: "Mercado", patterns: [/\bcarrefour\b/i] },
  { canonical_name: "Assaí", semantic_category: "Mercado", patterns: [/\bassa[ií]\b/i] },
  { canonical_name: "Pão de Açúcar", semantic_category: "Mercado", patterns: [/\bp[aã]o\s*de\s*a[cç][uú]car\b/i] },
  { canonical_name: "Market4You", semantic_category: "Mercado", patterns: [/\bmarket\s*4\s*you\b/i, /\bmarket4you\b/i, /\bpay\s*souk4\b/i, /\bsouk4u\b/i] },
  { canonical_name: "Netflix", semantic_category: "Assinaturas", patterns: [/\bnetflix\b/i, /\bnetfl\b/i] },
  { canonical_name: "Spotify", semantic_category: "Assinaturas", patterns: [/\bspotify\b/i] },
  { canonical_name: "Amazon Prime", semantic_category: "Assinaturas", patterns: [/\bamazon\s*prime\b/i] },
  { canonical_name: "Petz", semantic_category: "Pets", patterns: [/\bpetz\b/i] },
  { canonical_name: "Cobasi", semantic_category: "Pets", patterns: [/\bcobasi\b/i] },
  { canonical_name: "Enel", semantic_category: "Moradia", patterns: [/\benel\b/i] },
  { canonical_name: "Sympla", semantic_category: "Lazer", patterns: [/\bsympla\b/i] },
  { canonical_name: "Shotgun", semantic_category: "Lazer", patterns: [/\bshotgun\b/i] },
  { canonical_name: "TotalPass", semantic_category: "Saúde", patterns: [/\btotal\s*pass\b/i] },
];

export function matchCuratedMerchant(raw: string | null | undefined): CuratedMerchant | null {
  const text = String(raw ?? "");
  if (!text.trim()) return null;
  return CURATED_MERCHANTS.find((m) => m.patterns.some((p) => p.test(text))) ?? null;
}

/** Só as marcas de altíssima precisão (nenhum aprendizado pode contradizer). */
export function matchAuthoritativeMerchant(raw: string | null | undefined): CuratedMerchant | null {
  const hit = matchCuratedMerchant(raw);
  return hit?.authoritative ? hit : null;
}

/**
 * Intermediadores de pagamento: aparecem no extrato mas NÃO são o comércio
 * econômico. Sozinhos nunca determinam merchant nem categoria.
 */
const PASS_THROUGH_DESCRIPTORS: RegExp[] = [
  /\bpagseguro\b/i,
  /\bpag\s*bank\b|\bpagbank\b/i,
  /\bmercado\s*pago\b|\bmercpago\b|\bmercadopago\b/i,
  /\bpicpay\b/i,
  /\bstone\b|\bcielo\b|\bgetnet\b|\bredecard\b/i,
  /\bpjbank\b/i,
];

/** A descrição só traz intermediador de pagamento (sem marca conhecida)? */
export function isPassThroughDescriptor(raw: string | null | undefined): boolean {
  const text = String(raw ?? "");
  if (!text.trim()) return false;
  if (!PASS_THROUGH_DESCRIPTORS.some((rx) => rx.test(text))) return false;
  return !matchCuratedMerchant(text);
}


export function curatedStorageKeys(): Array<{ merchant_key: string; canonical_name: string; semantic_category: string }> {
  return CURATED_MERCHANTS.map((m) => ({
    merchant_key: storageMerchantKey(m.canonical_name),
    canonical_name: m.canonical_name,
    semantic_category: m.semantic_category,
  }));
}
