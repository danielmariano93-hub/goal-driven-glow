// Persistência dos highlights de acompanhamento (`advisor_core.v1`).
//
// A UI nunca calcula: ela lê o snapshot gravado em
// `financial_performance_snapshots` e só dispara o cálculo quando o snapshot
// está ausente, expirado ou invalidado por um evento financeiro.
import { supabase } from "@/integrations/supabase/client";
import { registerAdvisorSignal, type AdvisorSignal } from "@/lib/nino/advisorLearning";
import {
  computeFinancialPerformance,
  type FinancialPerformanceHighlight,
  type PerformanceInput,
} from "@/lib/engine/financialPerformance";
import {
  computeAdvisorDecision,
  type AdvisorDecision,
  type AdvisorRankedItem,
  ADVISOR_RELEVANCE_VERSION,
} from "@/lib/engine/advisorRelevance";
import type { ComparisonMode } from "@/lib/engine/financialComparison";

export type PerformanceSnapshot = {
  as_of: string;
  mode: string;
  headline: string;
  methodology: string | null;
  highlights: AdvisorRankedItem[];
  suppressed: AdvisorRankedItem[];
  next_action: string | null;
  formula_version: string;
  valid_until: string | null;
  /** Verdadeiro quando o payload veio do banco, sem recálculo. */
  from_cache: boolean;
};

const TABLE = "financial_performance_snapshots";

function snapshotVersion(mode: ComparisonMode): string {
  return `${ADVISOR_RELEVANCE_VERSION}|${mode}`;
}

export async function readPerformanceSnapshot(
  userId: string,
  asOf: string,
  mode: ComparisonMode,
): Promise<PerformanceSnapshot | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("as_of, mode, headline, methodology, highlights, suppressed, next_action, formula_version, valid_until")
    .eq("user_id", userId)
    .eq("mode", mode)
    .is("invalidated_at", null)
    .gte("valid_until", asOf)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  if (data.formula_version !== snapshotVersion(mode)) return null;
  return {
    as_of: data.as_of,
    mode: data.mode,
    headline: data.headline,
    methodology: data.methodology ?? null,
    highlights: (data.highlights as unknown as AdvisorRankedItem[]) ?? [],
    suppressed: (data.suppressed as unknown as AdvisorRankedItem[]) ?? [],
    next_action: data.next_action ?? null,
    formula_version: data.formula_version,
    valid_until: data.valid_until ?? null,
    from_cache: true,
  };
}

async function persistSnapshot(
  userId: string,
  snapshot: PerformanceSnapshot,
  highlights: FinancialPerformanceHighlight[],
): Promise<void> {
  // Um snapshot por (usuário, modo, dia): o anterior é invalidado antes.
  await supabase
    .from(TABLE)
    .update({ invalidated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("mode", snapshot.mode)
    .is("invalidated_at", null);
  const validUntil = snapshot.valid_until
    ?? highlights.map((h) => h.valid_until).sort()[0]
    ?? snapshot.as_of;
  await supabase.from(TABLE).insert({
    user_id: userId,
    as_of: snapshot.as_of,
    mode: snapshot.mode,
    headline: snapshot.headline,
    methodology: snapshot.methodology,
    highlights: snapshot.highlights as unknown as never,
    suppressed: snapshot.suppressed as unknown as never,
    next_action: snapshot.next_action,
    formula_version: snapshot.formula_version,
    valid_until: validUntil,
  });
}

export function buildPerformanceSnapshot(input: {
  performance: PerformanceInput;
  monthlyIncome?: number | null;
  maxItems?: number;
  affinity?: Parameters<typeof computeAdvisorDecision>[0]["affinity"];
}): {
  snapshot: PerformanceSnapshot;
  decision: AdvisorDecision;
  highlights: FinancialPerformanceHighlight[];
  comparisons: ReturnType<typeof computeFinancialPerformance>["comparisons"];
} {
  const mode: ComparisonMode = input.performance.mode ?? "MTD_EQUIVALENT";
  const perf = computeFinancialPerformance({ ...input.performance, mode });
  const decision = computeAdvisorDecision({
    highlights: perf.highlights,
    affinity: input.affinity,
    as_of: input.performance.as_of,
    monthlyIncome: input.monthlyIncome ?? null,
    maxItems: input.maxItems ?? 4,
    channel: "app",
  });
  return {
    snapshot: {
      as_of: input.performance.as_of,
      mode,
      headline: decision.headline || perf.headline,
      methodology: decision.methodology,
      highlights: decision.items,
      suppressed: decision.suppressed,
      next_action: decision.next_action,
      formula_version: snapshotVersion(mode),
      valid_until: null,
      from_cache: false,
    },
    decision,
    highlights: perf.highlights,
    comparisons: perf.comparisons,
  };
}

/** Lê o snapshot válido ou calcula, grava e devolve. Nunca recalcula em vão. */
export async function loadOrComputePerformanceSnapshot(params: {
  userId: string;
  performance: PerformanceInput;
  monthlyIncome?: number | null;
  affinity?: Parameters<typeof computeAdvisorDecision>[0]["affinity"];
  force?: boolean;
}): Promise<PerformanceSnapshot> {
  const mode: ComparisonMode = params.performance.mode ?? "MTD_EQUIVALENT";
  if (!params.force) {
    const cached = await readPerformanceSnapshot(params.userId, params.performance.as_of, mode);
    if (cached) return cached;
  }
  const { snapshot, highlights } = buildPerformanceSnapshot(params);
  await persistSnapshot(params.userId, snapshot, highlights).catch(() => undefined);
  return snapshot;
}

/** Invalidação por evento financeiro: o próximo acesso recalcula. */
export async function invalidatePerformanceSnapshots(userId: string): Promise<void> {
  await supabase
    .from(TABLE)
    .update({ invalidated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("invalidated_at", null);
}

export async function loadTopicAffinity(userId: string) {
  const { data } = await supabase
    .from("user_advisor_topic_affinity")
    .select("topic_key, score, signals, last_seen_at")
    .eq("user_id", userId);
  return (data ?? []).map((row) => ({
    topic_key: row.topic_key,
    score: Number(row.score ?? 0),
    signals: Number(row.signals ?? 0),
    last_seen: row.last_seen_at ?? null,
  }));
}

export async function registerTopicSignal(topicKey: string, signal: string): Promise<void> {
  await registerAdvisorSignal({ topicKey, signal: signal as AdvisorSignal, source: "app" });
}
