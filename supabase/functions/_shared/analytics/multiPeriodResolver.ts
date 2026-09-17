// MultiPeriodResolver (`period_truth.v2`)
//
// Resolução DETERMINÍSTICA de MÚLTIPLOS períodos em pt-BR.
//
// Causa-raiz que este módulo fecha: `resolvePeriodPt` sempre devolveu UM
// período. Então "quanto gastei em alimentação no mês de julho e agosto?"
// perdia um dos recortes antes de chegar ao IR, o plano ficava incoerente com o
// pedido e o turno terminava em falha honesta genérica pedindo… o período que o
// usuário já tinha dado.
//
// Regras:
// - a LLM nunca inventa datas: quem transforma expressão em intervalo é aqui;
// - a ORDEM das expressões é preservada (julho antes de agosto);
// - só existe multi-período quando as expressões estão realmente enumeradas
//   (conector curto entre elas: "e", ",", "ou", "vs", "comparado a");
// - intenção de COMPARAÇÃO é sinal separado da lista de períodos.
import { resolvePeriodPt, type ResolvedPeriod } from "./periodResolver.ts";

export type MultiPeriodResolution = {
  version: "period_truth.v2";
  /** Períodos resolvidos, na ordem em que aparecem na frase. */
  periods: ResolvedPeriod[];
  /** O usuário pediu explicitamente uma comparação entre os períodos? */
  comparison_intent: boolean;
  /** Trechos reconhecidos, na mesma ordem de `periods`. */
  matched: string[];
  source: "enumeration" | "single" | "none";
};

const MONTHS = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";

/** Expressões temporais reconhecidas, mais longas primeiro. */
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
    `(?:${MONTHS})(?:\\s+de\\s+20\\d{2})?`,
    "ultimos?\\s+\\d{1,3}\\s+dias",
    "hoje",
    "ontem",
  ].map((part) => `(?:${part})`).join("|"),
  "g",
);

// Comparação pode ser explícita ("comparando") ou estar implícita numa
// pergunta de variação entre dois períodos ("qual piorou/aumentou mais?").
const COMPARISON_RX =
  /\b(vs|versus|comparad\w*|comparando|em relacao a|contra|aument\w*|cres\w*|subi\w*|cai\w*|reduz\w*|diminu\w*|pior\w*|melhor\w*|mud\w*|vari\w*|diferen\w*)\b/;

/** Palavras que podem ficar entre duas expressões sem quebrar a enumeração. */
const CONNECTOR_RX =
  /^[\s,;:.]*(?:e|ou|x|vs|versus|com|de|do|da|no|na|em|ao|para|contra|comparado|comparada|comparados|comparando|relacao|a|o|mes|meses|tambem)?(?:[\s,;:.]+(?:e|ou|com|de|do|da|no|na|em|ao|a|o|mes|meses|relacao)?)*[\s,;:.]*$/;

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function key(period: ResolvedPeriod): string {
  return `${period.from}..${period.to}`;
}

/**
 * Lê a frase e devolve TODAS as expressões temporais enumeradas.
 * `periods.length <= 1` significa: nada mudou em relação ao comportamento antigo.
 */
export function resolveMultiPeriodsPt(text: string, now: Date = new Date()): MultiPeriodResolution {
  const t = norm(text);
  const empty: MultiPeriodResolution = {
    version: "period_truth.v2", periods: [], comparison_intent: false, matched: [], source: "none",
  };
  if (!t) return empty;

  const hits: Array<{ matched: string; start: number; end: number; period: ResolvedPeriod }> = [];
  for (const match of t.matchAll(TOKEN_RX)) {
    const matched = match[0];
    // "mesmo período do mês passado" é base de comparação, não item de lista.
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
      source: "single",
    };
  }

  // Enumeração só vale com conector curto entre expressões consecutivas.
  const chain: typeof hits = [hits[0]];
  for (let i = 1; i < hits.length; i += 1) {
    const between = t.slice(hits[i - 1].end, hits[i].start);
    if (!CONNECTOR_RX.test(between)) break;
    chain.push(hits[i]);
  }

  const unique: typeof hits = [];
  const seen = new Set<string>();
  for (const hit of chain) {
    const k = key(hit.period);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(hit);
  }

  if (unique.length < 2) {
    return {
      version: "period_truth.v2",
      periods: [unique[0]?.period ?? hits[0].period],
      comparison_intent: false,
      matched: [unique[0]?.matched ?? hits[0].matched],
      source: "single",
    };
  }

  return {
    version: "period_truth.v2",
    periods: unique.map((h) => h.period),
    comparison_intent: comparison,
    matched: unique.map((h) => h.matched),
    source: "enumeration",
  };
}

/**
 * Mesmo contrato, mas a partir das expressões que a autoridade conversacional
 * preservou ("julho", "agosto"). Sem expressão utilizável, cai para o texto.
 */
export function resolvePeriodExpressions(
  expressions: string[] | null | undefined,
  text: string,
  now: Date = new Date(),
): MultiPeriodResolution {
  const list = (expressions ?? []).map((e) => String(e ?? "").trim()).filter(Boolean);
  if (list.length < 2) return resolveMultiPeriodsPt(text, now);

  const periods: ResolvedPeriod[] = [];
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const expression of list) {
    const period = resolvePeriodPt(expression, now);
    if (!period || seen.has(key(period))) continue;
    seen.add(key(period));
    periods.push(period);
    matched.push(expression);
  }
  if (periods.length < 2) return resolveMultiPeriodsPt(text, now);
  return {
    version: "period_truth.v2",
    periods,
    comparison_intent: COMPARISON_RX.test(norm(text)),
    matched,
    source: "enumeration",
  };
}
