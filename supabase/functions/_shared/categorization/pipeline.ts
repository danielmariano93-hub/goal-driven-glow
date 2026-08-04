// Pipeline híbrido de categorização — determinístico primeiro, LLM só como
// último recurso e SEMPRE em lote. Nunca sobrescreve edição manual do usuário.
//
// Estágios (curto-circuita no primeiro com confidence >= threshold):
//  1. explicit (source=user, conf=1.0)   — categoria explícita já vinda no draft
//  2. alias    (source=alias, conf=0.98) — merchant_aliases.confirmed_by_user_at
//  3. history  (source=history, conf=0.85–0.95) — >=3 tx do mesmo user/merchant
//  4. rule     (source=rule, conf=0.75)  — dicionário curado
//  5. llm      (source=llm, conf>=0.7)   — batelada
//  6. none     (source=none)             — abaixo do threshold
import { normalizedPattern } from "./normalize.ts";

export type CategoryDecision = {
  category_id: string | null;
  category_source: "user" | "alias" | "history" | "rule" | "llm" | "none";
  category_confidence: number;
  category_reason: string;
};

export type CategoryCandidate = { id: string; name: string };
export type HistoryRow = { pattern: string; category_id: string | null; count: number };
export type AliasRow = { pattern: string; category_id: string | null; confidence: number };

export const THRESHOLDS = {
  AUTO: 0.85,
  SUGGEST: 0.6,
} as const;

/** Thresholds efetivos, calibráveis via platform_public_config.
 *  Preservam defaults quando a configuração está ausente/inválida. */
export type EffectiveThresholds = {
  AUTO: number;
  SUGGEST: number;
  per_source: { rule: number; history: number; alias: number; llm: number };
};

const DEFAULT_THRESHOLDS: EffectiveThresholds = {
  AUTO: 0.85, SUGGEST: 0.6,
  per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 0.75 },
};

// deno-lint-ignore no-explicit-any
export function parseThresholds(raw: any): EffectiveThresholds {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const out: EffectiveThresholds = { ...DEFAULT_THRESHOLDS, per_source: { ...DEFAULT_THRESHOLDS.per_source } };
    if (typeof v?.AUTO === "number" && v.AUTO >= 0 && v.AUTO <= 1) out.AUTO = v.AUTO;
    if (typeof v?.SUGGEST === "number" && v.SUGGEST >= 0 && v.SUGGEST <= 1) out.SUGGEST = v.SUGGEST;
    for (const k of ["rule", "history", "alias", "llm"] as const) {
      const n = v?.per_source?.[k];
      if (typeof n === "number" && n >= 0 && n <= 1) out.per_source[k] = n;
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
  { pattern: /\b(ifood|rappi|zé\s*delivery|ze\s*delivery|james|restaurante|lanchonete|padaria|caf[eé]|pizza|burger|mcdonald|outback)\b/, category: "alimentacao" },
  { pattern: /\b(drogaria|farmacia|drogasil|pacheco|raia|panvel)\b/, category: "saude" },
  { pattern: /\b(supermerc|mercado|carrefour|extra|assai|atacadao|paodeacucar|pao\s*de\s*acucar|hortifruti|sams?\s*club|oxxo)\b/, category: "mercado" },
  { pattern: /\b(bar|boteco|pub|balada|cervejaria|choperia)\b/, category: "lazer" },
  { pattern: /\b(cinema|teatro|show|ingresso|festival|parque)\b/, category: "lazer" },
  { pattern: /\b(netflix|spotify|disney|hbo|max\.com|amazon\s*prime|youtube\s*premium|apple\.com\/bill|google\s*one|icloud)\b/, category: "assinaturas" },
  { pattern: /\b(posto|gasolina|combustivel|shell|petrobras|ipiranga)\b/, category: "transporte" },
  { pattern: /\b(escola|faculdade|curso|udemy|alura|livraria)\b/, category: "educacao" },
  { pattern: /\b(aluguel|condominio|energia|enel|sabesp|copasa|internet|vivo\s*fibra|claro\s*net)\b/, category: "moradia" },
  { pattern: /\b(hospital|clinica|laboratorio|consulta|dentista|odonto)\b/, category: "saude" },
  { pattern: /\b(petshop|petz|cobasi|veterinar)\b/, category: "pets" },
  { pattern: /\b(renner|riachuelo|cea\b|c&a|zara|shein|roupa|calcados|calçados)\b/, category: "vestuario" },
  { pattern: /\b(i(o|0)f|tarifa|anuidade|juros|multa|imposto|ipva|iptu)\b/, category: "impostos e taxas" },
  { pattern: /(lovable(?:\.dev)?|openai|chatgpt|canva|adobe|github|hostinger|dominio|domínio)/, category: "servicos" },
  { pattern: /\b(localiza|movida|unidas|turbi)\b/, category: "transporte" },
  { pattern: /\b(shotgun|sympla|eventim|ticketmaster)\b/, category: "lazer" },
  { pattern: /\b(apple|google play|microsoft|amazon web services|aws)\b/, category: "servicos" },
];

function foldName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function matchByName(candidates: CategoryCandidate[], name: string): string | null {
  const target = foldName(name);
  const exact = candidates.find(c => foldName(c.name) === target);
  if (exact) return exact.id;
  const partial = candidates.find(c => foldName(c.name).includes(target) || target.includes(foldName(c.name)));
  return partial ? partial.id : null;
}

function tokens(value: string): Set<string> {
  return new Set((value ?? "").split(/\s+/).map((item) => item.trim()).filter((item) => item.length >= 2));
}

export function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

export function decideByFuzzyAlias(pattern: string, aliases: AliasRow[]): CategoryDecision | null {
  if (!pattern) return null;
  const candidates = aliases
    .filter((item) => item.category_id)
    .map((item) => ({ item, similarity: tokenSimilarity(pattern, item.pattern) }))
    .filter((entry) => entry.similarity >= 0.8)
    .sort((a, b) => b.similarity - a.similarity);
  const best = candidates[0];
  if (!best) return null;
  const second = candidates[1];
  if (second && second.item.category_id !== best.item.category_id && best.similarity - second.similarity < 0.08) return null;
  const confidence = Math.min(0.94, 0.86 + Math.max(0, best.similarity - 0.8) * 0.4);
  return {
    category_id: best.item.category_id,
    category_source: "alias",
    category_confidence: round2(confidence),
    category_reason: `alias semelhante (${Math.round(best.similarity * 100)}% de tokens em comum)`,
  };
}

export function decideExplicit(userChoice: string | null | undefined, candidates: CategoryCandidate[]): CategoryDecision | null {
  if (!userChoice) return null;
  const id = matchByName(candidates, userChoice);
  if (!id) return null;
  return { category_id: id, category_source: "user", category_confidence: 1.0, category_reason: "escolha explícita" };
}

export function decideByAlias(pattern: string, aliases: AliasRow[]): CategoryDecision | null {
  if (!pattern) return null;
  const hit = aliases.find(a => a.pattern === pattern && a.category_id);
  if (!hit) return null;
  return {
    category_id: hit.category_id,
    category_source: "alias",
    category_confidence: Math.min(0.98, Math.max(0.7, Number(hit.confidence) || 0.9)),
    category_reason: `alias confirmado (${pattern})`,
  };
}

export function decideByHistory(pattern: string, history: HistoryRow[]): CategoryDecision | null {
  if (!pattern) return null;
  const relevant = history.filter(h => h.pattern === pattern && h.category_id);
  if (relevant.length === 0) return null;
  const total = relevant.reduce((s, h) => s + h.count, 0);
  if (total < 3) return null;
  // categoria dominante
  const byCat = new Map<string, number>();
  for (const h of relevant) byCat.set(h.category_id!, (byCat.get(h.category_id!) ?? 0) + h.count);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const ratio = top[1] / total;
  if (ratio < 0.8) return null;
  const conf = Math.min(0.95, 0.85 + (ratio - 0.8) * 0.5);
  return {
    category_id: top[0],
    category_source: "history",
    category_confidence: round2(conf),
    category_reason: `${top[1]}/${total} lançamentos anteriores desse estabelecimento nesta categoria`,
  };
}

export function decideByRule(description: string, candidates: CategoryCandidate[]): CategoryDecision | null {
  const target = (description ?? "").toLowerCase();
  for (const r of RULES) {
    if (r.pattern.test(target)) {
      const id = matchByName(candidates, r.category);
      if (id) return { category_id: id, category_source: "rule", category_confidence: 0.75, category_reason: `regra: ${r.category}` };
    }
  }
  return null;
}

const REFUND_MARKERS = /\b(estorno|estornado|reembolso|reembolsado|devolucao|devolução|refund|cancelamento|chargeback)\b/i;

/** Verdadeiro quando a descrição indica estorno/reembolso de um gasto anterior. */
export function looksLikeRefund(description: string): boolean {
  return REFUND_MARKERS.test((description ?? "").normalize("NFC"));
}

/**
 * Estorno herda a categoria do gasto original: removemos o marcador de estorno
 * e decidimos pelo estabelecimento remanescente. Sem isso, todo reembolso caía
 * em "sem categoria" e sujava o histórico do usuário.
 */
export function decideByRefundOrigin(input: {
  description: string;
  candidates: CategoryCandidate[];
  aliases: AliasRow[];
  history: HistoryRow[];
}): CategoryDecision | null {
  if (!looksLikeRefund(input.description)) return null;
  const stripped = (input.description ?? "").replace(new RegExp(REFUND_MARKERS.source, "gi"), " ").replace(/\s+/g, " ").trim();
  if (stripped.length < 3) return null;
  const pattern = normalizedPattern(stripped);
  const inherited = decideByAlias(pattern, input.aliases)
    ?? decideByFuzzyAlias(pattern, input.aliases)
    ?? decideByHistory(pattern, input.history)
    ?? decideByRule(stripped, input.candidates);
  if (!inherited) return null;
  return {
    ...inherited,
    category_reason: `estorno herda a categoria do gasto original — ${inherited.category_reason}`,
  };
}

/** Combina os estágios determinísticos (1–4). LLM fica fora, para ser
 *  chamado em lote pelo caller apenas quando este devolve null. */
export function decideCategoryDeterministic(input: {
  explicit?: string | null;
  description: string;
  candidates: CategoryCandidate[];
  aliases: AliasRow[];
  history: HistoryRow[];
}): CategoryDecision | null {
  const pattern = normalizedPattern(input.description);

  return decideExplicit(input.explicit, input.candidates)
      ?? decideByAlias(pattern, input.aliases)
      ?? decideByFuzzyAlias(pattern, input.aliases)
      ?? decideByHistory(pattern, input.history)
      ?? decideByRefundOrigin(input)
      ?? decideByRule(input.description, input.candidates);
}


export function shouldAutoApply(decision: CategoryDecision | null, thresholds?: EffectiveThresholds): boolean {
  if (!decision) return false;
  const T = thresholds ?? DEFAULT_THRESHOLDS;
  const perSource = decision.category_source === "rule" ? T.per_source.rule
    : decision.category_source === "history" ? T.per_source.history
    : decision.category_source === "alias" ? T.per_source.alias
    : decision.category_source === "llm" ? T.per_source.llm
    : T.AUTO;
  return decision.category_confidence >= Math.max(T.AUTO, perSource);
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
