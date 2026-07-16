// Robust entity resolvers shared across agent tools.
// Normalizes user text (lowercase, trim, remove diacritics, strip generic
// prefixes like "cartão", "banco", "conta", punctuation) and matches by
// exact > prefix > substring > tokens. Never invents entities.

// deno-lint-ignore-file no-explicit-any

export type Candidate = {
  id: string;
  name: string;
  aliases?: string[]; // brand, nickname, last_four, creditor, etc.
};

export type ResolveOutcome<T extends Candidate> =
  | { kind: "single"; match: T }
  | { kind: "multiple"; matches: T[] }
  | { kind: "none"; available: T[] };

const GENERIC_PREFIXES = [
  "cartao de credito", "cartao credito", "cartao",
  "banco", "conta corrente", "conta poupanca", "conta",
  "meta", "objetivo", "divida", "investimento", "aporte",
];

export function normalize(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripGenericPrefix(normalized: string): string {
  for (const p of GENERIC_PREFIXES) {
    if (normalized === p) return "";
    if (normalized.startsWith(p + " ")) return normalized.slice(p.length + 1);
  }
  return normalized;
}

function tokenize(s: string): string[] {
  return s.split(" ").filter(t => t.length >= 2);
}

function isGenericTerm(normalized: string): boolean {
  if (!normalized) return true;
  return GENERIC_PREFIXES.includes(normalized);
}

/**
 * Resolve a user hint against a list of candidates.
 * Rules:
 *  - Empty/generic hint + exactly one candidate → return that one.
 *  - UUID match wins.
 *  - Exact normalized match on name or alias.
 *  - Prefix match, then substring match on name or alias.
 *  - Token overlap match (all significant tokens present).
 *  - Multiple ambiguous → "multiple".
 *  - No match → "none" with available list.
 */
export function resolveEntity<T extends Candidate>(
  hint: string | undefined | null,
  candidates: T[],
): ResolveOutcome<T> {
  const list = candidates ?? [];
  const raw = String(hint ?? "").trim();

  // UUID direct match
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    const found = list.find(c => c.id.toLowerCase() === raw.toLowerCase());
    if (found) return { kind: "single", match: found };
    return { kind: "none", available: list };
  }

  const normHint = normalize(raw);
  const stripped = stripGenericPrefix(normHint);
  const generic = !stripped || isGenericTerm(normHint);

  if (generic && list.length === 1) return { kind: "single", match: list[0] };
  if (generic) return { kind: "multiple", matches: list };

  const scored = list.map(c => {
    const names = [c.name, ...(c.aliases ?? [])].filter(Boolean).map(normalize);
    let score = 0;
    for (const n of names) {
      if (!n) continue;
      if (n === stripped || n === normHint) { score = Math.max(score, 100); continue; }
      if (n.startsWith(stripped)) { score = Math.max(score, 80); continue; }
      if (n.includes(stripped)) { score = Math.max(score, 60); continue; }
      if (stripped.includes(n) && n.length >= 3) { score = Math.max(score, 55); continue; }
      const hintTokens = tokenize(stripped);
      const nameTokens = tokenize(n);
      const overlap = hintTokens.filter(t => nameTokens.some(nt => nt.includes(t) || t.includes(nt))).length;
      if (overlap > 0 && overlap === hintTokens.length) score = Math.max(score, 40);
      else if (overlap > 0) score = Math.max(score, 20 + overlap * 5);
    }
    return { c, score };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none", available: list };

  const top = scored[0];
  const ties = scored.filter(s => s.score === top.score);
  if (ties.length === 1) return { kind: "single", match: top.c };
  // If top score is a strong exact/prefix match, prefer it even with ties on lower ones
  if (top.score >= 80 && scored[1] && scored[1].score < top.score) {
    return { kind: "single", match: top.c };
  }
  return { kind: "multiple", matches: ties.map(t => t.c) };
}
