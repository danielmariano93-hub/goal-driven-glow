import { normalizedPattern, storageMerchantKey } from "./normalize.ts";
import { matchCuratedMerchant } from "./merchantCatalog.ts";

export type CategorySource = "user" | "personal" | "alias" | "history" | "global" | "rule" | "llm" | "none";
export type CategoryDecision = {
  category_id: string | null;
  category_source: CategorySource;
  category_confidence: number;
  category_reason: string;
};
export type CategoryCandidate = { id: string; name: string; slug?: string | null; user_id?: string | null };
export type HistoryRow = { pattern: string; category_id: string | null; count: number };
export type AliasRow = { pattern: string; category_id: string | null; confidence: number };
export type PersonalPreferenceRow = { merchant_key: string; category_id: string | null; evidence_count?: number | null };
export type GlobalKnowledgeRow = {
  merchant_key: string; canonical_name?: string | null; semantic_category_slug: string;
  confidence: number; source?: string | null; status?: string | null; patterns?: string[] | null;
};

export const THRESHOLDS = { AUTO: 0.85, SUGGEST: 0.6 } as const;
export type EffectiveThresholds = {
  AUTO: number; SUGGEST: number;
  per_source: { rule: number; history: number; alias: number; llm: number; personal: number; global: number };
};
export type ThresholdOverrides = Partial<Omit<EffectiveThresholds,"per_source">> & { per_source?: Partial<EffectiveThresholds["per_source"]> };
const DEFAULT_THRESHOLDS: EffectiveThresholds = {
  AUTO: 0.85, SUGGEST: 0.6,
  per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 1.0, personal: 0.95, global: 0.95 },
};

// deno-lint-ignore no-explicit-any
export function parseThresholds(raw: any): EffectiveThresholds {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const out: EffectiveThresholds = { ...DEFAULT_THRESHOLDS, per_source: { ...DEFAULT_THRESHOLDS.per_source } };
    if (typeof v?.AUTO === "number" && v.AUTO >= 0 && v.AUTO <= 1) out.AUTO = v.AUTO;
    if (typeof v?.SUGGEST === "number" && v.SUGGEST >= 0 && v.SUGGEST <= 1) out.SUGGEST = v.SUGGEST;
    for (const k of ["rule", "history", "alias", "llm", "personal", "global"] as const) {
      const n = v?.per_source?.[k]; if (typeof n === "number" && n >= 0 && n <= 1) out.per_source[k] = n;
    }
    return out;
  } catch { return DEFAULT_THRESHOLDS; }
}

// deno-lint-ignore no-explicit-any
export async function loadEffectiveThresholds(sb: any): Promise<EffectiveThresholds> {
  try {
    const { data } = await sb.from("platform_public_config").select("value").eq("key", "categorization.thresholds").maybeSingle();
    return parseThresholds(data?.value);
  } catch { return DEFAULT_THRESHOLDS; }
}

const RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(uber|99|cabify|indriver)\b/, category: "transporte" },
  { pattern: /\b(restaurante|lanchonete|padaria|caf[eé]|pizza|burger|mcdonald|outback)\b/, category: "alimentacao" },
  { pattern: /\b(drogaria|farmacia|pacheco|panvel)\b/, category: "saude" },
  { pattern: /\b(supermerc|mercado|extra|atacadao|hortifruti|sams?\s*club|oxxo)\b/, category: "mercado" },
  { pattern: /\b(bar|boteco|pub|balada|cervejaria|choperia|cinema|teatro|show|ingresso|festival|parque)\b/, category: "lazer" },
  { pattern: /\b(disney|hbo|max\.com|youtube\s*premium|apple\.com\/bill|google\s*one|icloud)\b/, category: "assinaturas" },
  { pattern: /\b(posto|gasolina|combustivel|shell|petrobras|ipiranga)\b/, category: "transporte" },
  { pattern: /\b(escola|faculdade|curso|udemy|alura|livraria)\b/, category: "educacao" },
  { pattern: /\b(aluguel|condominio|energia|sabesp|copasa|internet|vivo\s*fibra|claro\s*net)\b/, category: "moradia" },
  { pattern: /\b(hospital|clinica|laboratorio|consulta|dentista|odonto)\b/, category: "saude" },
  { pattern: /\b(petshop|veterinar)\b/, category: "pets" },
  { pattern: /\b(renner|riachuelo|cea\b|c&a|zara|shein|roupa|calcados|calçados)\b/, category: "vestuario" },
  { pattern: /\b(iof|tarifa|anuidade|juros|multa|imposto|ipva|iptu)\b/, category: "impostos e taxas" },
  { pattern: /(lovable(?:\.dev)?|openai|chatgpt|canva|adobe|github|hostinger|dominio|domínio)/, category: "servicos" },
];

function foldName(value: string): string { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
function slugLike(value: string): string { return foldName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function matchByName(candidates: CategoryCandidate[], name: string): string | null {
  const target = foldName(name); const targetSlug = slugLike(name);
  const exact = candidates.find(c => foldName(c.name) === target || (c.slug && slugLike(c.slug) === targetSlug));
  if (exact) return exact.id;
  const partial = candidates.find(c => foldName(c.name).includes(target) || target.includes(foldName(c.name)));
  return partial?.id ?? null;
}
function tokens(value: string): Set<string> { return new Set(storageMerchantKey(value).split(/\s+/).filter((x) => x.length >= 2)); }
export function tokenSimilarity(left: string, right: string): number {
  const a=tokens(left), b=tokens(right); if (!a.size || !b.size) return 0;
  const i=[...a].filter(x=>b.has(x)).length; const u=new Set([...a,...b]).size; return u ? i/u : 0;
}

export function decideExplicit(userChoice: string | null | undefined, candidates: CategoryCandidate[]): CategoryDecision | null {
  if (!userChoice) return null; const id=matchByName(candidates,userChoice); if (!id) return null;
  return { category_id:id, category_source:"user", category_confidence:1, category_reason:"escolha explícita" };
}
export function decideByPersonalPreference(raw: string, preferences: PersonalPreferenceRow[]): CategoryDecision | null {
  const key=normalizedPattern(raw); if (!key) return null;
  const hit=preferences.find(p=>p.merchant_key===key && p.category_id); if (!hit) return null;
  return { category_id:hit.category_id, category_source:"personal", category_confidence:0.99,
    category_reason:`preferência pessoal confirmada (${Math.max(1, Number(hit.evidence_count ?? 1))} evidência(s))` };
}
export function decideByAlias(pattern: string, aliases: AliasRow[]): CategoryDecision | null {
  const hit=aliases.find(a=>a.pattern===pattern && a.category_id); if (!hit) return null;
  return { category_id:hit.category_id, category_source:"alias", category_confidence:Math.min(0.99,Math.max(0.7,Number(hit.confidence)||0.9)), category_reason:`alias pessoal confirmado (${pattern})` };
}
export function decideByFuzzyAlias(pattern: string, aliases: AliasRow[]): CategoryDecision | null {
  if (!pattern) return null;
  const ranked=aliases.filter(a=>a.category_id).map(item=>({item,similarity:tokenSimilarity(pattern,item.pattern)})).filter(x=>x.similarity>=0.8).sort((a,b)=>b.similarity-a.similarity);
  const best=ranked[0]; if (!best) return null; const second=ranked[1];
  if (second && second.item.category_id!==best.item.category_id && best.similarity-second.similarity<0.08) return null;
  return { category_id:best.item.category_id, category_source:"alias", category_confidence:round2(Math.min(0.97,0.90+(best.similarity-0.8)*0.35)), category_reason:`alias pessoal semelhante (${Math.round(best.similarity*100)}% de tokens em comum)` };
}
export function decideByHistory(pattern: string, history: HistoryRow[]): CategoryDecision | null {
  const rel=history.filter(h=>h.pattern===pattern&&h.category_id); if (!rel.length) return null;
  const total=rel.reduce((s,h)=>s+h.count,0); if (total<3) return null;
  const by=new Map<string,number>(); for (const h of rel) by.set(h.category_id!, (by.get(h.category_id!)??0)+h.count);
  const top=[...by.entries()].sort((a,b)=>b[1]-a[1])[0]; const ratio=top[1]/total; if (ratio<0.8) return null;
  return { category_id:top[0], category_source:"history", category_confidence:round2(Math.min(0.95,0.85+(ratio-0.8)*0.5)), category_reason:`${top[1]}/${total} correções pessoais anteriores nesse merchant` };
}
export function decideByGlobalKnowledge(raw: string, candidates: CategoryCandidate[], knowledge: GlobalKnowledgeRow[]): CategoryDecision | null {
  const key=normalizedPattern(raw);
  const exact=knowledge.find(k=>k.merchant_key===key && ["curated","verified"].includes(String(k.status??"verified")));
  const fuzzy=exact ?? knowledge.find(k=>Array.isArray(k.patterns) && k.patterns.some(p=>tokenSimilarity(key,p)>=0.9));
  if (!fuzzy) return null; const id=matchByName(candidates,fuzzy.semantic_category_slug); if (!id) return null;
  return { category_id:id, category_source:"global", category_confidence:Math.max(0.95,Math.min(0.995,Number(fuzzy.confidence??0.95))), category_reason:`conhecimento global verificado: ${fuzzy.canonical_name??fuzzy.merchant_key}` };
}
export function decideByCuratedCatalog(raw: string, candidates: CategoryCandidate[]): CategoryDecision | null {
  const hit=matchCuratedMerchant(raw); if (!hit) return null; const id=matchByName(candidates,hit.semantic_category); if (!id) return null;
  return { category_id:id, category_source:"global", category_confidence:0.99, category_reason:`catálogo global curado: ${hit.canonical_name}` };
}
/**
 * Marcas autoritativas vencem qualquer aprendizado (alias/preferência) porque o
 * aprendizado pode ter sido poluído por importação. Ex.: "99 FOOD02/08" jamais
 * é Transporte; "Seguro do cartão" jamais é Assinaturas.
 */
export function decideByAuthoritativeMerchant(raw: string, candidates: CategoryCandidate[]): CategoryDecision | null {
  const hit=matchAuthoritativeMerchant(raw); if (!hit) return null; const id=matchByName(candidates,hit.semantic_category); if (!id) return null;
  return { category_id:id, category_source:"global", category_confidence:0.99, category_reason:`marca canônica: ${hit.canonical_name}` };
}
/**
 * Intermediador de pagamento sozinho não é evidência categórica: o lançamento
 * fica sem categoria (necessita revisão) em vez de herdar um alias inventado.
 */
export function isPassThroughOnly(raw: string | null | undefined): boolean {
  return isPassThroughDescriptor(raw);
}
export function decideByRule(description: string, candidates: CategoryCandidate[]): CategoryDecision | null {
  const target=description.toLowerCase(); for (const r of RULES) if (r.pattern.test(target)) { const id=matchByName(candidates,r.category); if (id) return { category_id:id, category_source:"rule", category_confidence:0.75, category_reason:`regra: ${r.category}` }; } return null;
}
const REFUND_MARKERS=/\b(estorno|estornado|reembolso|reembolsado|devolucao|devolução|refund|cancelamento|chargeback)\b/i;
export function looksLikeRefund(description:string){return REFUND_MARKERS.test(description.normalize("NFC"));}
export function decideByRefundOrigin(input:{description:string;candidates:CategoryCandidate[];aliases:AliasRow[];history:HistoryRow[]}):CategoryDecision|null{
  if(!looksLikeRefund(input.description))return null; const stripped=input.description.replace(new RegExp(REFUND_MARKERS.source,"gi")," ").replace(/\s+/g," ").trim(); if(stripped.length<3)return null;
  const pattern=normalizedPattern(stripped); const inherited=decideByAlias(pattern,input.aliases)??decideByFuzzyAlias(pattern,input.aliases)??decideByHistory(pattern,input.history)??decideByRule(stripped,input.candidates); return inherited?{...inherited,category_reason:`estorno herda a categoria do gasto original — ${inherited.category_reason}`}:null;
}
export function decideCategoryDeterministic(input:{explicit?:string|null;description:string;candidates:CategoryCandidate[];aliases:AliasRow[];history:HistoryRow[];preferences?:PersonalPreferenceRow[];globalKnowledge?:GlobalKnowledgeRow[]}):CategoryDecision|null{
  const pattern=normalizedPattern(input.description);
  return decideExplicit(input.explicit,input.candidates)
    ?? decideByPersonalPreference(input.description,input.preferences??[])
    ?? decideByAlias(pattern,input.aliases)
    ?? decideByFuzzyAlias(pattern,input.aliases)
    ?? decideByHistory(pattern,input.history)
    ?? decideByRefundOrigin(input)
    ?? decideByGlobalKnowledge(input.description,input.candidates,input.globalKnowledge??[])
    ?? decideByCuratedCatalog(input.description,input.candidates)
    ?? decideByRule(input.description,input.candidates);
}
export function shouldAutoApply(decision:CategoryDecision|null,thresholds?:ThresholdOverrides):boolean{
  if(!decision)return false; const T:EffectiveThresholds={...DEFAULT_THRESHOLDS,...(thresholds??{}),per_source:{...DEFAULT_THRESHOLDS.per_source,...(thresholds?.per_source??{})}};
  const key=decision.category_source as keyof EffectiveThresholds["per_source"];
  const per=(T.per_source as Record<string,number>)[key]??T.AUTO; return decision.category_confidence>=Math.max(T.AUTO,per);
}
function round2(n:number){return Math.round((n+Number.EPSILON)*100)/100;}
