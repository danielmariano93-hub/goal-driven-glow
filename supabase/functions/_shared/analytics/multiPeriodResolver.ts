// MultiPeriodResolver (`period_truth.v2`)
//
// Deterministic resolution of one or many period expressions. When the
// conversation authority already emitted an explicit period slot, that slot is
// resolved directly and is never discarded in favour of reparsing the raw user
// sentence. This closes the class of bugs where V3 understood 21–27 but V2
// later fell back to "este mês".
import { resolvePeriodPt, type ResolvedPeriod } from "./periodResolver.ts";
import { resolveExplicitPeriodPt } from "./explicitPeriodResolver.ts";

export type MultiPeriodResolution = {
  version: "period_truth.v2";
  periods: ResolvedPeriod[];
  comparison_intent: boolean;
  matched: string[];
  source: "enumeration" | "single" | "text" | "none" | "unresolved_authoritative";
};

const MONTHS = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const MONTH_COUNTS = "um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|\\d{1,2}";

const TOKEN_RX = new RegExp(
  [
    "mesmo periodo do mes passado",
    "mes passado",
    "mes anterior",
    "mes retrasado",
    "(?:este|esse|neste|nesse) mes",
    "mes atual",
    "semana passada",
    "ultima semana",
    "esta semana",
    "essa semana",
    `\\b(?:${MONTHS})(?:\\s+de\\s+20\\d{2})?\\b`,
    `ultimos?\\s+(?:${MONTH_COUNTS})\\s+meses?`,
    "ultimos?\\s+\\d{1,3}\\s+dias",
    "hoje",
    "ontem",
  ].map((part) => `(?:${part})`).join("|"),
  "g",
);

const COMPARISON_RX =
  /\b(vs|versus|comparad\w*|comparando|em relacao a|contra|aument\w*|cres\w*|subi\w*|cai\w*|reduz\w*|diminu\w*|pior\w*|melhor\w*|mud\w*|vari\w*|diferen\w*)\b/;

const CONNECTOR_RX =
  /^[\s,;:.]*(?:e|ou|x|vs|versus|com|de|do|da|no|na|em|ao|para|contra|comparado|comparada|comparados|comparando|relacao|a|o|mes|meses|tambem)?(?:[\s,;:.]+(?:e|ou|com|de|do|da|no|na|em|ao|a|o|mes|meses|relacao)?)*[\s,;:.]*$/;

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function key(period: ResolvedPeriod): string {
  return `${period.from}..${period.to}`;
}

function resolveExpression(expression: string, now: Date): ResolvedPeriod | null {
  return resolveExplicitPeriodPt(expression, now) ?? resolvePeriodPt(expression, now);
}

/** Raw-text discovery is compatibility for turns with no authoritative slot. */
export function resolveMultiPeriodsPt(text: string, now: Date = new Date()): MultiPeriodResolution {
  const t = norm(text);
  const empty: MultiPeriodResolution = {
    version: "period_truth.v2", periods: [], comparison_intent: false, matched: [], source: "none",
  };
  if (!t) return empty;

  const explicit = resolveExplicitPeriodPt(text, now);
  if (explicit) {
    return {
      version: "period_truth.v2",
      periods: [explicit],
      comparison_intent: COMPARISON_RX.test(t),
      matched: [explicit.matched],
      source: "text",
    };
  }

  const hits: Array<{ matched: string; start: number; end: number; period: ResolvedPeriod }> = [];
  for (const match of t.matchAll(TOKEN_RX)) {
    const matched = match[0];
    if (matched.startsWith("mesmo periodo")) continue;
    const period = resolvePeriodPt(matched, now);
    if (!period) continue;
    hits.push({ matched, start: match.index ?? 0, end: (match.index ?? 0) + matched.length, period });
  }

  if (!hits.length) return empty;
  const comparison = COMPARISON_RX.test(t);

  if (hits.length === 1) {
    return {
      version: "period_truth.v2",
      periods: [hits[0].period],
      comparison_intent: false,
      matched: [hits[0].matched],
      source: "text",
    };
  }

  const chain: typeof hits = [hits[0]];
  for (let i = 1; i < hits.length; i += 1) {
    const between = t.slice(hits[i - 1].end, hits[i].start);
    if (!CONNECTOR_RX.test(between)) break;
    chain.push(hits[i]);
  }

  const uniqueHits: typeof hits = [];
  const seen = new Set<string>();
  for (const hit of chain) {
    const k = key(hit.period);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueHits.push(hit);
  }

  if (uniqueHits.length < 2) {
    return {
      version: "period_truth.v2",
      periods: [uniqueHits[0]?.period ?? hits[0].period],
      comparison_intent: false,
      matched: [uniqueHits[0]?.matched ?? hits[0].matched],
      source: "text",
    };
  }

  return {
    version: "period_truth.v2",
    periods: uniqueHits.map((h) => h.period),
    comparison_intent: comparison,
    matched: uniqueHits.map((h) => h.matched),
    source: "enumeration",
  };
}

/**
 * Resolve slots emitted by the semantic authority. A single authoritative
 * expression remains authoritative; an unresolved authoritative expression
 * fails closed instead of falling back to raw-text/default interpretation.
 */
export function resolvePeriodExpressions(
  expressions: string[] | null | undefined,
  text: string,
  now: Date = new Date(),
): MultiPeriodResolution {
  const list = (expressions ?? []).map((e) => String(e ?? "").trim()).filter(Boolean);
  if (!list.length) return resolveMultiPeriodsPt(text, now);

  const periods: ResolvedPeriod[] = [];
  const matched: string[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];
  for (const expression of list) {
    const period = resolveExpression(expression, now);
    if (!period) {
      unresolved.push(expression);
      continue;
    }
    if (seen.has(key(period))) continue;
    seen.add(key(period));
    periods.push(period);
    matched.push(expression);
  }

  if (unresolved.length) {
    return {
      version: "period_truth.v2",
      periods: [],
      comparison_intent: COMPARISON_RX.test(norm(text)),
      matched: unresolved,
      source: "unresolved_authoritative",
    };
  }

  return {
    version: "period_truth.v2",
    periods,
    comparison_intent: COMPARISON_RX.test(norm(text)),
    matched,
    source: periods.length > 1 ? "enumeration" : "single",
  };
}
