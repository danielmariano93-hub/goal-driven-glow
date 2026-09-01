// nino_change_agent.v1
// ============================================================================
// Fecha o loop:
// recomendação -> compromisso -> acompanhamento -> reforço/reframe -> aprendizado.
//
// Segurança:
// - nenhuma função movimenta dinheiro;
// - compromisso só pode nascer de recomendação canônica recente;
// - a recomendação é recalculada antes da aceitação;
// - mudança material de estágio/truth gate invalida recomendação antiga;
// - progresso é medido por fatos, nunca por "parece que";
// - follow-ups entram no MESMO governador de atenção do proactive_multifinance.
// deno-lint-ignore-file no-explicit-any

import {
  computeNextBestAction,
  type NextBestAction,
} from "./behaviorWealth.ts";
import { principlesForStage } from "./behavioralPrinciples.ts";
import type { FinancialSituation } from "../proactive/contracts.ts";

type SupabaseClient = any;

export const NINO_CHANGE_AGENT_VERSION = "nino_change_agent.v1";

export type ChangeOutcome =
  | "completed"
  | "progress"
  | "stalled"
  | "regressed"
  | "no_evidence";

export type ChangeCommitmentStatus = {
  version: string;
  commitment_id: string;
  stage: string;
  status: string;
  title: string;
  accepted_at: string;
  next_check_at: string;
  progress_score: number;
  outcome: ChangeOutcome;
  evidence: Record<string, unknown>;
  message: string;
  route: string | null;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function r2(v: number): number { return Math.round(v * 100) / 100; }
function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

export async function recordLearningEvent(
  sb: SupabaseClient,
  args: {
    user_id: string;
    event_type: string;
    source: string;
    signal: string;
    subject_key?: string | null;
    confidence?: number;
    weight?: number;
    before_value?: unknown;
    after_value?: unknown;
    metadata?: Record<string, unknown>;
    applied?: boolean;
    dedup_key?: string | null;
  },
): Promise<void> {
  const row = {
    user_id: args.user_id,
    event_type: args.event_type,
    source: args.source,
    signal: args.signal,
    subject_key: args.subject_key ?? null,
    confidence: clamp01(Number(args.confidence ?? 0.8)),
    weight: Number(args.weight ?? 1),
    before_value: args.before_value ?? null,
    after_value: args.after_value ?? null,
    metadata: args.metadata ?? {},
    applied: args.applied ?? true,
    applied_at: args.applied === false ? null : new Date().toISOString(),
    dedup_key: args.dedup_key ?? null,
  };
  const query = args.dedup_key
    ? sb.from("nino_learning_events").upsert(row, { onConflict: "user_id,dedup_key", ignoreDuplicates: true })
    : sb.from("nino_learning_events").insert(row);
  const { error } = await query;
  if (error) throw new Error(`nino_learning_event:${error.message}`);
}

export async function persistNextActionRecommendation(
  sb: SupabaseClient,
  userId: string,
  action: NextBestAction,
  source: "chat" | "app" | "proactive",
): Promise<string | null> {
  const dedup = [
    action.version, action.as_of, action.stage,
    action.action.goal_id ?? "none",
    action.action.amount ?? "none",
  ].join(":");

  const { data, error } = await sb.from("nino_change_recommendations").upsert({
    user_id: userId,
    dedup_key: dedup,
    source,
    behavior_wealth_version: action.version,
    stage: action.stage,
    stage_reason: action.stage_reason,
    confidence: action.confidence,
    title: action.action.title,
    detail: action.action.detail,
    route: action.action.route,
    amount: action.action.amount,
    amount_role: action.action.amount_role,
    goal_id: action.action.goal_id,
    goal_name: action.action.goal_name,
    financial_state: action.financial_state,
    truth_gate: action.truth_gate,
    behavior_context: action.behavior_context,
    principles: principlesForStage(action.stage),
    status: "proposed",
    expires_at: isoPlusDays(2),
  }, { onConflict: "user_id,dedup_key", ignoreDuplicates: false })
    .select("id").maybeSingle();

  if (error) throw new Error(`nino_change_recommendation:${error.message}`);
  return data?.id ? String(data.id) : null;
}

export async function commitLatestRecommendation(
  sb: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data: latest, error } = await sb.from("nino_change_recommendations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "proposed")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest_change_recommendation:${error.message}`);
  if (!latest) {
    return {
      status: "no_current_recommendation",
      message: "Não há um próximo passo recente para assumir. Peça primeiro: “qual é meu próximo passo financeiro?”",
    };
  }

  // Nunca transformar uma recomendação velha em compromisso sem revalidar.
  const current = await computeNextBestAction(sb, userId, { months: 12 });
  const changed = current.truth_gate.blocked
    || String(current.stage) !== String(latest.stage)
    || String(current.action.goal_id ?? "") !== String(latest.goal_id ?? "");

  if (changed) {
    await sb.from("nino_change_recommendations")
      .update({ status: "superseded", superseded_at: now })
      .eq("id", latest.id).eq("user_id", userId);
    const currentId = await persistNextActionRecommendation(sb, userId, current, "chat");
    await recordLearningEvent(sb, {
      user_id: userId,
      event_type: "recommendation_revalidated",
      source: "change_loop",
      signal: "context_changed_before_commitment",
      subject_key: String(latest.id),
      confidence: current.confidence,
      metadata: { old_stage: latest.stage, new_stage: current.stage, current_recommendation_id: currentId },
    });
    return {
      status: "recommendation_changed",
      recommendation_id: currentId,
      next_action: current.action,
      message: "Sua situação mudou desde a última orientação. Recalculei o próximo passo antes de assumir qualquer compromisso.",
    };
  }

  const cadenceDays = 7;
  // Um compromisso financeiro principal por vez. O anterior é preservado.
  await sb.from("nino_change_commitments")
    .update({ status: "superseded", ended_at: now, end_reason: "replaced_by_new_commitment" })
    .eq("user_id", userId).eq("status", "active");

  const { data: commitment, error: commitmentError } = await sb.from("nino_change_commitments")
    .insert({
      user_id: userId,
      recommendation_id: latest.id,
      stage: latest.stage,
      title: latest.title,
      detail: latest.detail,
      route: latest.route,
      target_amount: latest.amount,
      target_amount_role: latest.amount_role,
      goal_id: latest.goal_id,
      goal_name: latest.goal_name,
      baseline_state: current.financial_state,
      baseline_truth_gate: current.truth_gate,
      principles: principlesForStage(current.stage),
      accepted_at: now,
      next_check_at: isoPlusDays(cadenceDays),
      cadence_days: cadenceDays,
      status: "active",
      strategy: "reinforce",
    }).select("id").single();
  if (commitmentError) throw new Error(`nino_change_commitment:${commitmentError.message}`);

  await sb.from("nino_change_recommendations")
    .update({ status: "accepted", accepted_at: now })
    .eq("id", latest.id).eq("user_id", userId);

  await recordLearningEvent(sb, {
    user_id: userId,
    event_type: "change_commitment",
    source: "user_action",
    signal: "accepted",
    subject_key: String(commitment.id),
    confidence: 1,
    metadata: {
      stage: latest.stage,
      recommendation_id: latest.id,
      principles: principlesForStage(current.stage),
    },
  });

  return {
    version: NINO_CHANGE_AGENT_VERSION,
    status: "active",
    commitment_id: commitment.id,
    title: latest.title,
    next_check_at: isoPlusDays(cadenceDays),
    message: `Combinado. Vou acompanhar “${latest.title}” e comparar o avanço com a sua situação de hoje, sem movimentar dinheiro por você.`,
  };
}

async function contributionSince(
  sb: SupabaseClient, userId: string, goalId: string | null, since: string,
): Promise<number> {
  if (!goalId) return 0;
  const { data } = await sb.from("goal_contributions")
    .select("amount")
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .gte("occurred_at", since);
  return r2(((data as any[]) ?? []).reduce((s, row) => s + Math.abs(n(row.amount)), 0));
}

async function investmentApplicationsSince(
  sb: SupabaseClient, userId: string, since: string,
): Promise<number> {
  const { data } = await sb.from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .eq("movement_kind", "investment_application")
    .gte("occurred_at", since.slice(0, 10));
  return r2(((data as any[]) ?? []).reduce((s, row) => s + Math.abs(n(row.amount)), 0));
}

export function evaluateProgressPure(args: {
  stage: string;
  baseline: Record<string, unknown>;
  current: Record<string, unknown>;
  target_amount?: number | null;
  goal_contributions?: number;
  investment_applications?: number;
  truth_blocked?: boolean;
}): { score: number; outcome: ChangeOutcome; metric: string; delta: number } {
  if (args.truth_blocked) {
    return { score: 0, outcome: "no_evidence", metric: "truth_blocked", delta: 0 };
  }
  const b = args.baseline ?? {};
  const c = args.current ?? {};
  let delta = 0;
  let score = 0;
  let metric = "state";

  if (args.stage === "repair_truth") {
    return { score: 1, outcome: "completed", metric: "truth_repaired", delta: 1 };
  }

  if (args.stage === "stabilize_cash") {
    const before = n(b.projected_month_end_available);
    const now = n(c.projected_month_end_available);
    delta = r2(now - before);
    metric = "projected_month_end_available";
    if (now >= 0) return { score: 1, outcome: "completed", metric, delta };
    const originalGap = Math.max(1, Math.abs(Math.min(0, before)));
    score = clamp01(delta / originalGap);
  } else if (args.stage === "reduce_debt_pressure") {
    const before = n(b.monthly_debt_installments);
    const now = n(c.monthly_debt_installments);
    delta = r2(before - now);
    metric = "monthly_debt_installments";
    if (before > 0) score = clamp01(delta / before);
  } else if (args.stage === "fund_goal") {
    const contrib = n(args.goal_contributions);
    const target = Math.max(1, n(args.target_amount));
    delta = contrib;
    metric = "goal_contributions";
    score = clamp01(contrib / target);
    if (contrib >= target) return { score: 1, outcome: "completed", metric, delta };
  } else if (args.stage === "build_wealth") {
    const applied = n(args.investment_applications);
    const target = Math.max(1, n(args.target_amount));
    delta = applied;
    metric = "investment_applications";
    score = clamp01(applied / target);
    if (applied >= target) return { score: 1, outcome: "completed", metric, delta };
  } else {
    const before = n(b.net_worth);
    const now = n(c.net_worth);
    delta = r2(now - before);
    metric = "net_worth";
    score = before === 0 ? (delta > 0 ? 0.5 : 0) : clamp01(Math.max(0, delta) / Math.max(1, Math.abs(before)) * 4);
  }

  const outcome: ChangeOutcome =
    score >= 0.8 ? "progress" :
    delta > 0 ? "progress" :
    delta < 0 ? "regressed" :
    "stalled";
  return { score: r2(score), outcome, metric, delta };
}

export async function getActiveCommitmentStatus(
  sb: SupabaseClient,
  userId: string,
): Promise<ChangeCommitmentStatus | null> {
  const { data: row, error } = await sb.from("nino_change_commitments")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`nino_change_commitment_read:${error.message}`);
  if (!row) return null;

  const current = await computeNextBestAction(sb, userId, { months: 12 });
  const [goalContributions, applications] = await Promise.all([
    contributionSince(sb, userId, row.goal_id ? String(row.goal_id) : null, String(row.accepted_at)),
    investmentApplicationsSince(sb, userId, String(row.accepted_at)),
  ]);

  const evalResult = evaluateProgressPure({
    stage: String(row.stage),
    baseline: (row.baseline_state ?? {}) as Record<string, unknown>,
    current: current.financial_state as unknown as Record<string, unknown>,
    target_amount: row.target_amount == null ? null : Number(row.target_amount),
    goal_contributions: goalContributions,
    investment_applications: applications,
    truth_blocked: current.truth_gate.blocked,
  });

  let message: string;
  if (evalResult.outcome === "completed") {
    message = `Você concluiu o passo “${row.title}”. O avanço está registrado; agora o próximo passo deve ser recalculado.`;
  } else if (evalResult.outcome === "progress") {
    message = `Você avançou em “${row.title}”. O Nino vai manter o plano enquanto os dados continuarem sustentando essa direção.`;
  } else if (evalResult.outcome === "regressed") {
    message = `O indicador ligado a “${row.title}” piorou desde o combinado. Em vez de insistir igual, vale revisar o que tornou o plano difícil de executar.`;
  } else if (evalResult.outcome === "no_evidence") {
    message = "A verdade financeira não está segura o bastante para avaliar seu progresso agora. Primeiro vou proteger a qualidade da decisão.";
  } else {
    message = `Ainda não há avanço observável em “${row.title}”. Isso não vira cobrança: o próximo passo é reduzir a fricção ou ajustar a estratégia.`;
  }

  return {
    version: NINO_CHANGE_AGENT_VERSION,
    commitment_id: String(row.id),
    stage: String(row.stage),
    status: String(row.status),
    title: String(row.title),
    accepted_at: String(row.accepted_at),
    next_check_at: String(row.next_check_at),
    progress_score: evalResult.score,
    outcome: evalResult.outcome,
    evidence: {
      metric: evalResult.metric,
      delta: evalResult.delta,
      goal_contributions: goalContributions,
      investment_applications: applications,
      current_financial_state: current.financial_state,
      truth_gate: current.truth_gate,
      formula_version: NINO_CHANGE_AGENT_VERSION,
    },
    message,
    route: row.route ? String(row.route) : null,
  };
}

export async function pauseActiveCommitment(
  sb: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from("nino_change_commitments")
    .update({
      status: "paused",
      ended_at: new Date().toISOString(),
      end_reason: "paused_by_user",
    })
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id,title")
    .maybeSingle();
  if (error) throw new Error(`pause_change_commitment:${error.message}`);
  if (!data) return { status: "no_active_commitment", message: "Não há acompanhamento ativo para pausar." };
  await recordLearningEvent(sb, {
    user_id: userId,
    event_type: "change_commitment",
    source: "user_action",
    signal: "paused",
    subject_key: String(data.id),
    confidence: 1,
  });
  return { status: "paused", commitment_id: data.id, message: `Parei de acompanhar “${data.title}”.` };
}

export async function buildDueChangeFollowups(
  sb: SupabaseClient,
  userId: string,
): Promise<FinancialSituation[]> {
  const now = new Date().toISOString();
  const { data, error } = await sb.from("nino_change_commitments")
    .select("id,title,stage,route,next_check_at,cadence_days,dismissals")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("next_check_at", now)
    .order("next_check_at", { ascending: true })
    .limit(3);
  if (error) throw new Error(`due_change_commitments:${error.message}`);

  const out: FinancialSituation[] = [];
  for (const row of ((data as any[]) ?? [])) {
    const status = await getActiveCommitmentStatus(sb, userId);
    if (!status || status.commitment_id !== String(row.id)) continue;
    const kind =
      status.outcome === "completed" ? "change_progress" :
      status.outcome === "progress" ? "change_progress" :
      "change_reframe";
    out.push({
      fingerprint: `${NINO_CHANGE_AGENT_VERSION}:${row.id}:${String(row.next_check_at).slice(0, 10)}`,
      type: `change_${status.outcome}`,
      communication_kind: kind,
      severity: status.outcome === "regressed" ? "attention" : "info",
      title: status.outcome === "completed"
        ? "Você fez o que combinou"
        : status.outcome === "progress"
          ? "Seu plano está andando"
          : "Vamos ajustar o caminho, não cobrar você",
      body: status.message,
      primary_domain: row.stage === "fund_goal" ? "goals" : row.stage === "build_wealth" ? "investments" : "cash",
      domains: [row.stage === "fund_goal" ? "goals" : row.stage === "build_wealth" ? "investments" : "cash"],
      signals: [],
      impact_amount: 0,
      days_until: 0,
      confidence: status.outcome === "no_evidence" ? 0.6 : 0.9,
      actionable: true,
      route: row.route ? String(row.route) : "/app/nino",
      priority_score: 0,
      score_reasons: [],
      evidence: {
        change_commitment_id: row.id,
        outcome: status.outcome,
        progress_score: status.progress_score,
        status_evidence: status.evidence,
        formula_version: NINO_CHANGE_AGENT_VERSION,
      },
    } as FinancialSituation);
  }
  return out;
}

export async function markSelectedChangeFollowups(
  sb: SupabaseClient,
  userId: string,
  selected: FinancialSituation[],
): Promise<void> {
  for (const situation of selected) {
    const commitmentId = String((situation.evidence as any)?.change_commitment_id ?? "");
    if (!commitmentId) continue;
    const outcome = String((situation.evidence as any)?.outcome ?? "stalled") as ChangeOutcome;
    const score = n((situation.evidence as any)?.progress_score);
    const { data: c } = await sb.from("nino_change_commitments")
      .select("cadence_days,dismissals")
      .eq("id", commitmentId).eq("user_id", userId).maybeSingle();
    const cadence = Math.max(1, Number(c?.cadence_days ?? 7));
    await sb.from("nino_change_checkins").insert({
      user_id: userId,
      commitment_id: commitmentId,
      outcome,
      progress_score: score,
      evidence: (situation.evidence as any)?.status_evidence ?? {},
      source: "proactive_governor",
    });
    await sb.from("nino_change_commitments").update({
      last_check_at: new Date().toISOString(),
      last_progress_score: score,
      next_check_at: isoPlusDays(cadence),
      ...(outcome === "completed"
        ? { status: "completed", ended_at: new Date().toISOString(), end_reason: "evidence_completed" }
        : {}),
    }).eq("id", commitmentId).eq("user_id", userId);

    await recordLearningEvent(sb, {
      user_id: userId,
      event_type: "change_checkin",
      source: "proactive_governor",
      signal: outcome,
      subject_key: commitmentId,
      confidence: 0.9,
      after_value: { progress_score: score },
      metadata: { communication_kind: situation.communication_kind },
      dedup_key: `checkin:${situation.fingerprint}`,
    });
  }
}
