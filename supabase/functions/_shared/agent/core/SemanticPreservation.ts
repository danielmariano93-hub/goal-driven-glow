// SemanticPreservation (`nino_preservation.v1`)
//
// UMA única função de compatibilidade requested-vs-executed, reutilizada pelo
// planner (antes de executar), pelo grounding (depois de executar) e pela
// resposta. Antes existiam três checagens parecidas e nenhuma comparava o que
// foi PEDIDO com o que a engine REALMENTE rodou — foi assim que um filtro de
// categoria desapareceu e o Nino respondeu o agregado global.
import type { FinancialFilter } from "./FinancialQueryIR.ts";
import type { FinancialQueryV3, IRTime, Reduction, TimeGrain } from "./FinancialIRv3.ts";

/** O que uma engine declara ter executado de fato. */
export type ExecutedIR = {
  metric: string;
  filters: FinancialFilter[];
  time: Pick<IRTime, "aspect" | "from" | "to" | "n" | "exclude_partial">;
  grain: TimeGrain;
  reduce: Reduction;
  group_by: string[];
  /** Resultado incompleto (cobertura parcial de dados). */
  partial: boolean;
};

export type PreservationMismatch = {
  slot: "metric" | "filters" | "aspect" | "window" | "grain" | "reduce" | "group_by";
  reason: string;
  requested: string;
  executed: string;
};

export type PreservationResult = {
  version: "nino_preservation.v1";
  compatible: boolean;
  mismatches: PreservationMismatch[];
};

const filterKey = (f: FinancialFilter) => `${f.field}=${String(f.value).trim().toLowerCase()}`;

/** Reduções que a engine pode entregar quando a pergunta pediu a outra. */
const REDUCE_EQUIVALENT: Record<string, string[]> = {
  typical: ["typical", "median"],
  median: ["median", "typical"],
  mean: ["mean"],
  sum: ["sum"],
  none: ["none"],
  rate: ["rate"],
};

/**
 * `true` quando o que rodou responde EXATAMENTE o que foi pedido.
 * Filtro perdido → incompatível. Filtro extra → incompatível (a engine
 * respondeu uma pergunta mais estreita). Janela diferente → incompatível.
 */
export function requestedSubsumesExecuted(
  requested: FinancialQueryV3,
  executed: ExecutedIR | null | undefined,
): PreservationResult {
  const mismatches: PreservationMismatch[] = [];
  if (!executed) {
    return {
      version: "nino_preservation.v1",
      compatible: false,
      mismatches: [{ slot: "metric", reason: "executed_ir_missing", requested: requested.metric, executed: "none" }],
    };
  }

  if (String(executed.metric) !== String(requested.metric)) {
    mismatches.push({ slot: "metric", reason: "metric_changed", requested: requested.metric, executed: String(executed.metric) });
  }

  const want = new Set((requested.filters ?? []).map(filterKey));
  const got = new Set((executed.filters ?? []).map(filterKey));
  for (const key of want) {
    if (!got.has(key)) {
      mismatches.push({ slot: "filters", reason: "filter_lost", requested: key, executed: [...got].join(",") || "none" });
    }
  }
  for (const key of got) {
    if (!want.has(key)) {
      mismatches.push({ slot: "filters", reason: "filter_added", requested: [...want].join(",") || "none", executed: key });
    }
  }

  if (String(executed.time?.aspect) !== String(requested.time.aspect)) {
    mismatches.push({
      slot: "aspect", reason: "aspect_changed",
      requested: requested.time.aspect, executed: String(executed.time?.aspect ?? "none"),
    });
  }

  const sameWindow = (executed.time?.from ?? null) === (requested.time.from ?? null)
    && (executed.time?.to ?? null) === (requested.time.to ?? null);
  if (!sameWindow) {
    mismatches.push({
      slot: "window", reason: "window_changed",
      requested: `${requested.time.from ?? "?"}..${requested.time.to ?? "?"}`,
      executed: `${executed.time?.from ?? "?"}..${executed.time?.to ?? "?"}`,
    });
  }
  if (requested.time.exclude_partial && !executed.time?.exclude_partial) {
    mismatches.push({
      slot: "window", reason: "partial_month_included",
      requested: "exclude_partial", executed: "included_current_month",
    });
  }
  if (requested.time.n != null && executed.time?.n != null && requested.time.n !== executed.time.n) {
    mismatches.push({
      slot: "window", reason: "window_size_changed",
      requested: String(requested.time.n), executed: String(executed.time.n),
    });
  }

  if (String(executed.grain) !== String(requested.grain)) {
    mismatches.push({ slot: "grain", reason: "grain_changed", requested: requested.grain, executed: String(executed.grain) });
  }

  const allowed = REDUCE_EQUIVALENT[requested.reduce] ?? [requested.reduce];
  if (!allowed.includes(String(executed.reduce))) {
    mismatches.push({ slot: "reduce", reason: "statistic_changed", requested: requested.reduce, executed: String(executed.reduce) });
  }

  const wantDims = [...(requested.group_by ?? [])].sort().join("+");
  const gotDims = [...(executed.group_by ?? [])].map(String).sort().join("+");
  if (wantDims !== gotDims) {
    mismatches.push({ slot: "group_by", reason: "dimension_changed", requested: wantDims || "none", executed: gotDims || "none" });
  }

  return { version: "nino_preservation.v1", compatible: mismatches.length === 0, mismatches };
}

/** Compatibilidade do PLANO inteiro: toda query obrigatória precisa bater. */
export function planPreservation(
  pairs: Array<{ requested: FinancialQueryV3; executed: ExecutedIR | null | undefined }>,
): PreservationResult {
  const mismatches: PreservationMismatch[] = [];
  for (const pair of pairs) {
    const r = requestedSubsumesExecuted(pair.requested, pair.executed);
    for (const m of r.mismatches) mismatches.push({ ...m, reason: `${pair.requested.id}:${m.reason}` });
  }
  return { version: "nino_preservation.v1", compatible: mismatches.length === 0, mismatches };
}

/** Domínios que a resposta pode citar: só o que foi pedido e executado. */
export function allowedClaimDomains(queries: FinancialQueryV3[]): string[] {
  return [...new Set(queries.map((q) => String(q.metric)))];
}

export const PRESERVATION_FAILURE_REPLY =
  "O cálculo que eu consegui rodar não responde exatamente o que você perguntou, "
  + "e eu não vou te entregar um número de outro recorte como se fosse o seu. "
  + "Me confirma o período e a categoria que você quer que eu refaço na sua base.";
