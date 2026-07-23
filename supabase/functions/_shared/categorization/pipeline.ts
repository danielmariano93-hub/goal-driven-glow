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

const RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(uber|99|cabify|indriver)\b/, category: "transporte" },
  { pattern: /\b(ifood|rappi|zé\s*delivery|ze\s*delivery|james)\b/, category: "alimentacao" },
  { pattern: /\b(drogaria|farmacia|drogasil|pacheco|raia|panvel)\b/, category: "saude" },
  { pattern: /\b(supermerc|mercado|carrefour|extra|assai|atacadao|paodeacucar|pao\s*de\s*acucar|hortifruti)\b/, category: "mercado" },
  { pattern: /\b(bar|boteco|pub|balada|cervejaria|choperia)\b/, category: "lazer" },
  { pattern: /\b(cinema|teatro|show|ingresso|netflix|spotify|disney|hbo)\b/, category: "lazer" },
  { pattern: /\b(posto|gasolina|combustivel|shell|petrobras|ipiranga)\b/, category: "transporte" },
  { pattern: /\b(escola|faculdade|curso|udemy|alura)\b/, category: "educacao" },
];

function matchByName(candidates: CategoryCandidate[], name: string): string | null {
  const target = name.toLowerCase();
  const exact = candidates.find(c => c.name.toLowerCase() === target);
  if (exact) return exact.id;
  const partial = candidates.find(c => c.name.toLowerCase().includes(target) || target.includes(c.name.toLowerCase()));
  return partial ? partial.id : null;
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
      ?? decideByHistory(pattern, input.history)
      ?? decideByRule(input.description, input.candidates);
}

export function shouldAutoApply(decision: CategoryDecision | null): boolean {
  return !!decision && decision.category_confidence >= THRESHOLDS.AUTO;
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
