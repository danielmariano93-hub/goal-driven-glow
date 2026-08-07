import type { FinancialSituation, FinancialSituationAction, NinoDiagnosisContext } from "@/lib/nino/diagnosis";

export type NinoReadingSource = "primary" | "support" | "anticipation" | "pattern" | "operational";

export type NinoReading = {
  situation: FinancialSituation;
  action: FinancialSituationAction | null;
  source: NinoReadingSource;
};

const DEAD_STATUS = new Set(["resolved", "expired", "suppressed"]);
const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, attention: 3, positive: 2, info: 1 };

function isEligible(situation: FinancialSituation, now = Date.now()) {
  if (DEAD_STATUS.has(situation.status)) return false;
  if (situation.valid_until) {
    const until = Date.parse(situation.valid_until);
    if (Number.isFinite(until) && until < now) return false;
  }
  return true;
}

function identity(situation: FinancialSituation) {
  const evaluation = situation.evaluation ?? {};
  const dedup = typeof evaluation.dedup_key === "string" ? evaluation.dedup_key : null;
  return dedup || situation.situation_key || situation.id;
}

function semanticKey(situation: FinancialSituation) {
  return (situation.one_line_summary || situation.headline || "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9á-ú]+/gi, " ")
    .trim();
}

/**
 * Fila determinística de leituras do Nino para rotação na Home.
 * Ordem: principal → apoio/contraponto → antecipações → padrões confirmados → operacionais.
 * Deduplica por identidade canônica e evita mensagens equivalentes em sequência.
 * O diagnóstico continua preservando situações críticas, mas a fila da Home
 * respeita o feedback diário: uma leitura já respondida não fica presa na tela.
 */
export function buildNinoReadingQueue(
  context: NinoDiagnosisContext,
  options?: { suppressedIds?: Iterable<string>; now?: number },
): NinoReading[] {
  const now = options?.now ?? Date.now();
  const suppressed = new Set(options?.suppressedIds ?? []);
  const primary = context.primary_situation;

  const buckets: Array<{ source: NinoReadingSource; items: FinancialSituation[] }> = [
    { source: "primary", items: primary ? [primary] : [] },
    {
      source: "support",
      items: [...context.supporting_situations].sort((a, b) =>
        (a.narrative_role === "counterpoint" ? 0 : 1) - (b.narrative_role === "counterpoint" ? 0 : 1)
        || (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0)
        || b.relevance_score - a.relevance_score),
    },
    { source: "anticipation", items: [...context.anticipations].sort((a, b) => b.relevance_score - a.relevance_score) },
    {
      source: "pattern",
      items: context.patterns
        .filter((item) => item.status !== "observed")
        .sort((a, b) => b.relevance_score - a.relevance_score),
    },
    { source: "operational", items: [...context.operational_tasks].sort((a, b) => b.relevance_score - a.relevance_score) },
  ];

  const seen = new Set<string>();
  const queue: NinoReading[] = [];
  for (const bucket of buckets) {
    for (const situation of bucket.items) {
      if (!isEligible(situation, now)) continue;
      if (suppressed.has(situation.id)) continue;
      const key = identity(situation);
      if (seen.has(key)) continue;
      const semantic = semanticKey(situation);
      const previous = queue[queue.length - 1];
      if (previous && semantic && semanticKey(previous.situation) === semantic) continue;
      seen.add(key);
      const action = primary && situation.id === primary.id ? context.primary_action ?? null : null;
      queue.push({ situation, action, source: bucket.source });
    }
  }
  return queue;
}
