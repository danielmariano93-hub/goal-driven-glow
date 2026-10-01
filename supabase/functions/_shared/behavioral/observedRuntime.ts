// Runtime servidor da leitura "Nino observa" (`behavior_observed.v2`).
//
// Usa EXATAMENTE o mesmo RPC da tela (`behavioral_dashboard_snapshot`, via o
// helper service_role `behavioral_dashboard_snapshot_for_user`) e o MESMO motor
// espelhado em `_shared/finance-core`. Nenhuma fórmula vive aqui.
// deno-lint-ignore-file no-explicit-any
import {
  behaviorHabitsReading,
  buildObservedProfileV2,
  observedInputFromDashboardPayload,
  OBSERVED_SNAPSHOT_MIN_COVERAGE,
  snapshotFromProfile,
  weekStartOf,
  type BehaviorHabitsReading,
  type ObservedBehaviorProfile,
  type ObservedSnapshot,
} from "../finance-core/index.ts";

export const OBSERVED_RUNTIME_VERSION = "behavior_observed_runtime.v1";

export function todaySaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export async function loadObservedProfile(sb: any, userId: string): Promise<ObservedBehaviorProfile> {
  const { data, error } = await sb.rpc("behavioral_dashboard_snapshot_for_user", { p_uid: userId });
  if (error) throw new Error(`behavioral_dashboard_snapshot_for_user:${error.message}`);
  return buildObservedProfileV2(observedInputFromDashboardPayload(data ?? {}));
}

export async function loadObservedSnapshots(sb: any, userId: string): Promise<ObservedSnapshot[]> {
  // Mesma consulta da tela (`useObservedSnapshots`): 40 semanas mais recentes.
  const { data, error } = await sb.from("behavior_observed_snapshots")
    .select("week_start,overall_score,coverage,confidence,methodology_version,dimensions")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(40);
  if (error) throw new Error(`behavior_observed_snapshots:${error.message}`);
  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    overall_score: row.overall_score == null ? null : Number(row.overall_score),
  })) as ObservedSnapshot[];
}

/** Veredito idêntico ao da página Emocional. */
export async function loadBehaviorHabitsReading(sb: any, userId: string, now: Date = new Date()): Promise<{
  profile: ObservedBehaviorProfile;
  reading: BehaviorHabitsReading;
}> {
  const [profile, snapshots] = await Promise.all([loadObservedProfile(sb, userId), loadObservedSnapshots(sb, userId)]);
  const reading = behaviorHabitsReading({
    profile, snapshots, today: todaySaoPaulo(now), thisWeek: weekStartOf(now),
  });
  return { profile, reading };
}

export type WeeklySnapshotOutcome =
  | { user_id: string; status: "saved"; week_start: string; coverage: number }
  | { user_id: string; status: "skipped_low_coverage"; coverage: number }
  | { user_id: string; status: "error"; error: string };

/** Calcula e grava (upsert por user_id + week_start) a leitura da semana. */
export async function saveWeeklyObservedSnapshot(sb: any, userId: string, now: Date = new Date()): Promise<WeeklySnapshotOutcome> {
  try {
    const profile = await loadObservedProfile(sb, userId);
    if (profile.coverage < OBSERVED_SNAPSHOT_MIN_COVERAGE) {
      return { user_id: userId, status: "skipped_low_coverage", coverage: profile.coverage };
    }
    const week_start = weekStartOf(now);
    const { error } = await sb.from("behavior_observed_snapshots").upsert(
      { user_id: userId, week_start, ...snapshotFromProfile(profile as any), updated_at: now.toISOString() },
      { onConflict: "user_id,week_start" },
    );
    if (error) throw new Error(error.message);
    return { user_id: userId, status: "saved", week_start, coverage: profile.coverage };
  } catch (error) {
    return { user_id: userId, status: "error", error: String((error as Error)?.message ?? error).slice(0, 240) };
  }
}
