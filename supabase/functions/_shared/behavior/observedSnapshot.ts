// Grava a leitura semanal "Nino observa" no servidor, para o histórico crescer
// mesmo quando o usuário não abre a página Emocional. Usa a mesma leitura de
// dados (RPC behavioral_dashboard_snapshot_for_user) e o mesmo motor espelhado
// (finance-core/behaviorObserved) que a tela.
// deno-lint-ignore-file no-explicit-any
import { buildObservedProfileV2 } from "../finance-core/behaviorObserved.ts";

const MIN_COVERAGE = 3;
const REFRESH_AFTER_MS = 12 * 3_600_000;

/** Segunda-feira (America/Sao_Paulo) da semana da data. */
export function weekStartSP(now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function saveWeeklyObservedSnapshot(sb: any, userId: string, now: Date = new Date()): Promise<"saved" | "fresh" | "thin"> {
  const week = weekStartSP(now);
  const { data: existing } = await sb.from("behavior_observed_snapshots")
    .select("updated_at,methodology_version").eq("user_id", userId).eq("week_start", week).maybeSingle();
  if (existing?.updated_at && now.getTime() - new Date(existing.updated_at).getTime() < REFRESH_AFTER_MS) return "fresh";

  const { data, error } = await sb.rpc("behavioral_dashboard_snapshot_for_user", { p_uid: userId });
  if (error) throw error;
  const payload = (data ?? {}) as any;
  const profile = buildObservedProfileV2({
    financialRow: payload.financial_snapshot ?? null,
    checkins: payload.checkins ?? [],
    txStats: payload.transaction_stats ?? null,
    appActivity: payload.app_activity ?? null,
    goalCycles: payload.goal_cycles ?? [],
    planningStats: payload.planning_stats ?? null,
    investmentStats: payload.investment_stats ?? null,
  }) as any;
  if (profile.coverage < MIN_COVERAGE) return "thin";

  const { error: upsertError } = await sb.from("behavior_observed_snapshots").upsert({
    user_id: userId,
    week_start: week,
    overall_score: profile.overallScore,
    coverage: profile.coverage,
    confidence: profile.overallConfidence ?? "low",
    methodology_version: profile.methodologyVersion ?? "behavior_observed.v2",
    dimensions: Object.fromEntries(Object.entries(profile.dimensions).map(([key, row]: [string, any]) => [key, { score: row.score, confidence: row.confidence, factors: row.factors }])),
    updated_at: now.toISOString(),
  }, { onConflict: "user_id,week_start" });
  if (upsertError) throw upsertError;
  return "saved";
}
