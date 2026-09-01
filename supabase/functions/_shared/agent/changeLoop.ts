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
import { principlesForStage, resolveBehavioralIntervention } from "./behavioralPrinciples.ts";
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
  strategy?: string;
  strategy_reason?: string;
  behavioral_intervention?: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Revalidação material: o compromisso não pode nascer de um cenário que mudou.
// Pura, determinística e testável. Nunca invalida por centavo irrelevante.
// ---------------------------------------------------------------------------
export type RecommendationSnapshot = {
  stage?: string | null;
  stage_reason?: string | null;
  goal_id?: string | null;
  route?: string | null;
  amount?: number | null;
  amount_role?: string | null;
  truth_blocked?: boolean | null;
  sustainable_monthly_saving?: number | null;
  projected_month_end_available?: number | null;
  monthly_debt_installments?: number | null;
};

export const MATERIAL_AMOUNT_FLOOR_BRL = 20;
export const MATERIAL_AMOUNT_RATIO = 0.1;

function materiallyDifferent(before: number | null | undefined, after: number | null | undefined): boolean {
  const a = before == null ? null : n(before);
  const b = after == null ? null : n(after);
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  const threshold = Math.max(MATERIAL_AMOUNT_FLOOR_BRL, Math.abs(a) * MATERIAL_AMOUNT_RATIO);
  return Math.abs(b - a) > threshold;
}

export function hasMaterialRecommendationChange(
  previous: RecommendationSnapshot,
  current: RecommendationSnapshot,
): { changed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (current.truth_blocked === true && previous.truth_blocked !== true) reasons.push("truth_gate_blocked");
  if (String(previous.stage ?? "") !== String(current.stage ?? "")) reasons.push("stage_changed");
  if (String(previous.goal_id ?? "") !== String(current.goal_id ?? "")) reasons.push("goal_changed");
  if (String(previous.route ?? "") !== String(current.route ?? "")) reasons.push("action_changed");
  if (String(previous.amount_role ?? "") !== String(current.amount_role ?? "")) reasons.push("amount_role_changed");
  if (materiallyDifferent(previous.amount, current.amount)) reasons.push("amount_changed_materially");
  if (materiallyDifferent(previous.sustainable_monthly_saving, current.sustainable_monthly_saving)) {
    reasons.push("sustainable_capacity_changed");
  }
  if (materiallyDifferent(previous.projected_month_end_available, current.projected_month_end_available)) {
    reasons.push("projected_cash_changed");
  }
  // Parcela de dívida só invalida quando ela é o que define a prioridade.
  const debtDrivesPriority = previous.stage === "reduce_debt_pressure"
    || current.stage === "reduce_debt_pressure";
  if (debtDrivesPriority && materiallyDifferent(previous.monthly_debt_installments, current.monthly_debt_installments)) {
    reasons.push("debt_pressure_changed");
  }
  // stage_reason só conta quando a razão da segurança da orientação muda junto
  // com o estágio já sinalizado acima; sozinho, é texto e não invalida.
  if (
    reasons.length > 0
    && String(previous.stage_reason ?? "") !== String(current.stage_reason ?? "")
  ) {
    reasons.push("stage_reason_changed");
  }

  return { changed: reasons.length > 0, reasons: [...new Set(reasons)] };
}

function snapshotFromRow(row: Record<string, unknown>): RecommendationSnapshot {
  const state = (row.financial_state ?? {}) as Record<string, unknown>;
  const gate = (row.truth_gate ?? {}) as Record<string, unknown>;
  return {
    stage: row.stage == null ? null : String(row.stage),
    stage_reason: row.stage_reason == null ? null : String(row.stage_reason),
    goal_id: row.goal_id == null ? null : String(row.goal_id),
    route: row.route == null ? null : String(row.route),
    amount: row.amount == null ? null : Number(row.amount),
    amount_role: row.amount_role == null ? null : String(row.amount_role),
    truth_blocked: Boolean(gate.blocked),
    sustainable_monthly_saving: state.sustainable_monthly_saving == null ? null : Number(state.sustainable_monthly_saving),
    projected_month_end_available: state.projected_month_end_available == null
      ? null : Number(state.projected_month_end_available),
    monthly_debt_installments: state.monthly_debt_installments == null
      ? null : Number(state.monthly_debt_installments),
  };
}

function snapshotFromAction(action: NextBestAction): RecommendationSnapshot {
  return {
    stage: action.stage,
    stage_reason: action.stage_reason,
    goal_id: action.action.goal_id,
    route: action.action.route,
    amount: action.action.amount,
    amount_role: action.action.amount_role,
    truth_blocked: action.truth_gate.blocked,
    sustainable_monthly_saving: action.financial_state.sustainable_monthly_saving,
    projected_month_end_available: action.financial_state.projected_month_end_available,
    monthly_debt_installments: action.financial_state.monthly_debt_installments,
  };
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
  const material = hasMaterialRecommendationChange(
    snapshotFromRow(latest as Record<string, unknown>),
    snapshotFromAction(current),
  );

  if (material.changed) {
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
      before_value: { stage: latest.stage, amount: latest.amount, amount_role: latest.amount_role },
      after_value: { stage: current.stage, amount: current.action.amount, amount_role: current.action.amount_role },
      metadata: {
        reasons: material.reasons,
        old_stage: latest.stage,
        new_stage: current.stage,
        current_recommendation_id: currentId,
      },
    });
    return {
      status: "recommendation_changed",
      recommendation_id: currentId,
      change_reasons: material.reasons,
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
      strategy_reason: "commitment_accepted",
      last_strategy_change_at: now,
      intervention_attempts: 0,
    }).select("id").single();

  // O banco é a última proteção: unique parcial em status='active'. Se duas
  // aceitações competirem, a segunda relê o vigente em vez de duplicar.
  if (commitmentError) {
    if (String(commitmentError.code ?? "") === "23505" || /duplicate key/i.test(String(commitmentError.message))) {
      const { data: existing } = await sb.from("nino_change_commitments")
        .select("id,title,next_check_at")
        .eq("user_id", userId).eq("status", "active")
        .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        return {
          version: NINO_CHANGE_AGENT_VERSION,
          status: "active",
          commitment_id: existing.id,
          idempotent: true,
          title: existing.title,
          next_check_at: existing.next_check_at,
          message: `Esse acompanhamento já está ativo: “${existing.title}”. Não criei um segundo.`,
        };
      }
    }
    throw new Error(`nino_change_commitment:${commitmentError.message}`);
  }

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

  const stalls = await consecutiveStalls(sb, userId, String(row.id)).catch(() => 0);
  const profile = await buildChangeLearningProfile(sb, userId).catch(() => null);
  const decided = resolveChangeStrategy({
    outcome: evalResult.outcome,
    stage: String(row.stage),
    consecutive_stalls: stalls,
    dismissals: Number(row.dismissals ?? 0),
    intervention_attempts: Number(row.intervention_attempts ?? 0),
    learning_profile: profile,
  });
  const intervention = resolveBehavioralIntervention({
    stage: String(row.stage),
    outcome: evalResult.outcome,
    strategy: decided.strategy,
    principles: Array.isArray(row.principles) ? row.principles.map(String) as any : undefined,
    learningProfile: profile,
    financialFacts: current.financial_state as unknown as Record<string, unknown>,
  });

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
    strategy: decided.strategy,
    strategy_reason: decided.reason,
    behavioral_intervention: intervention,
    evidence: {
      metric: evalResult.metric,
      delta: evalResult.delta,
      goal_contributions: goalContributions,
      investment_applications: applications,
      current_financial_state: current.financial_state,
      truth_gate: current.truth_gate,
      consecutive_stalls: stalls,
      strategy: decided.strategy,
      strategy_reason: decided.reason,
      behavioral_intervention: intervention,
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
    .select("id,title,stage,route,next_check_at,cadence_days,dismissals,intervention_attempts,principles,target_amount")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("next_check_at", now)
    .order("next_check_at", { ascending: true })
    .limit(3);
  if (error) throw new Error(`due_change_commitments:${error.message}`);

  const rows = ((data as any[]) ?? []);
  if (rows.length === 0) return [];
  const profile = await buildChangeLearningProfile(sb, userId).catch(() => null);

  const out: FinancialSituation[] = [];
  for (const row of rows) {
    const status = await getActiveCommitmentStatus(sb, userId);
    if (!status || status.commitment_id !== String(row.id)) continue;

    const stalls = await consecutiveStalls(sb, userId, String(row.id));
    const decided = resolveChangeStrategy({
      outcome: status.outcome,
      stage: String(row.stage),
      consecutive_stalls: stalls,
      dismissals: Number(row.dismissals ?? 0),
      intervention_attempts: Number(row.intervention_attempts ?? 0),
      learning_profile: profile,
    });
    if (decided.strategy === "pause") continue; // respeitar o usuário: sem follow-up.

    const intervention = resolveBehavioralIntervention({
      stage: String(row.stage),
      outcome: status.outcome,
      strategy: decided.strategy,
      principles: Array.isArray(row.principles) ? row.principles.map(String) as any : undefined,
      learningProfile: profile,
      financialFacts: status.evidence as Record<string, unknown>,
    });

    const kind = decided.strategy === "reframe" ? "change_reframe" : "change_progress";
    const title = decided.strategy === "reinforce"
      ? (status.outcome === "completed" ? "Você fez o que combinou" : "Seu plano está andando")
      : decided.strategy === "reframe"
        ? "Vamos ajustar o caminho, não cobrar você"
        : "Retomando o que combinamos";

    out.push({
      fingerprint: `${NINO_CHANGE_AGENT_VERSION}:${row.id}:${String(row.next_check_at).slice(0, 10)}`,
      type: `change_${status.outcome}`,
      communication_kind: kind,
      severity: status.outcome === "regressed" ? "attention" : "info",
      title,
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
        strategy: decided.strategy,
        strategy_reason: decided.reason,
        consecutive_stalls: stalls,
        behavioral_intervention: intervention,
        formula_version: NINO_CHANGE_AGENT_VERSION,
      },
    } as FinancialSituation);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Perfil de aprendizado: evidências observadas no produto viram sinal de
// estratégia. Nunca perfil psicológico, personalidade ou diagnóstico emocional.
// ---------------------------------------------------------------------------
export type ChangeLearningProfile = {
  version: string;
  events: number;
  dismissals: number;
  corrections: number;
  commitments_accepted: number;
  commitments_completed: number;
  commitments_abandoned: number;
  accepted_kinds: string[];
  ignored_kinds: string[];
  outcome_counts: Record<string, number>;
  stage_success: Record<string, { total: number; success: number }>;
  principle_success: Record<string, { total: number; success: number }>;
  avg_days_to_act: number | null;
  prefers_smaller_steps: boolean;
};

const EMPTY_LEARNING_PROFILE: ChangeLearningProfile = {
  version: NINO_CHANGE_AGENT_VERSION,
  events: 0,
  dismissals: 0,
  corrections: 0,
  commitments_accepted: 0,
  commitments_completed: 0,
  commitments_abandoned: 0,
  accepted_kinds: [],
  ignored_kinds: [],
  outcome_counts: {},
  stage_success: {},
  principle_success: {},
  avg_days_to_act: null,
  prefers_smaller_steps: false,
};

export function buildChangeLearningProfilePure(args: {
  events: Array<{ event_type: string; signal: string; subject_key?: string | null; metadata?: any }>;
  commitments: Array<{
    id: string; stage: string; status: string; strategy?: string | null;
    principles?: any; dismissals?: number | null; accepted_at?: string | null;
    last_check_at?: string | null; target_amount?: number | null;
  }>;
  checkins: Array<{ commitment_id: string; outcome: string; created_at?: string | null }>;
}): ChangeLearningProfile {
  const profile: ChangeLearningProfile = {
    ...EMPTY_LEARNING_PROFILE,
    accepted_kinds: [],
    ignored_kinds: [],
    outcome_counts: {},
    stage_success: {},
    principle_success: {},
  };

  profile.events = args.events.length;
  profile.corrections = args.events.filter((e) => e.event_type === "correction").length;
  profile.dismissals = args.events.filter((e) => e.signal === "dismissed").length
    + args.commitments.reduce((s, c) => s + Math.max(0, Number(c.dismissals ?? 0)), 0);

  const acceptedKinds = new Map<string, number>();
  const ignoredKinds = new Map<string, number>();
  for (const event of args.events) {
    const kind = String(event.metadata?.communication_kind ?? event.metadata?.stage ?? "");
    if (!kind) continue;
    if (event.signal === "accepted" || event.signal === "completed" || event.signal === "progress") {
      acceptedKinds.set(kind, (acceptedKinds.get(kind) ?? 0) + 1);
    } else if (event.signal === "dismissed" || event.signal === "stalled" || event.signal === "no_evidence") {
      ignoredKinds.set(kind, (ignoredKinds.get(kind) ?? 0) + 1);
    }
  }
  profile.accepted_kinds = [...acceptedKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  profile.ignored_kinds = [...ignoredKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  profile.commitments_accepted = args.commitments.length;
  profile.commitments_completed = args.commitments.filter((c) => c.status === "completed").length;
  profile.commitments_abandoned = args.commitments.filter((c) => c.status === "abandoned").length;

  const byCommitment = new Map<string, { stage: string; principles: string[]; outcomes: string[]; target: number | null }>();
  for (const c of args.commitments) {
    byCommitment.set(String(c.id), {
      stage: String(c.stage),
      principles: Array.isArray(c.principles) ? c.principles.map(String) : [],
      outcomes: [],
      target: c.target_amount == null ? null : Number(c.target_amount),
    });
  }
  for (const checkin of args.checkins) {
    profile.outcome_counts[checkin.outcome] = (profile.outcome_counts[checkin.outcome] ?? 0) + 1;
    byCommitment.get(String(checkin.commitment_id))?.outcomes.push(String(checkin.outcome));
  }

  const success = (outcome: string) => outcome === "completed" || outcome === "progress";
  for (const entry of byCommitment.values()) {
    for (const outcome of entry.outcomes) {
      const stage = profile.stage_success[entry.stage] ?? { total: 0, success: 0 };
      stage.total += 1;
      if (success(outcome)) stage.success += 1;
      profile.stage_success[entry.stage] = stage;
      for (const principle of entry.principles) {
        const p = profile.principle_success[principle] ?? { total: 0, success: 0 };
        p.total += 1;
        if (success(outcome)) p.success += 1;
        profile.principle_success[principle] = p;
      }
    }
  }

  const durations: number[] = [];
  for (const c of args.commitments) {
    if (c.status !== "completed" || !c.accepted_at || !c.last_check_at) continue;
    const days = (Date.parse(c.last_check_at) - Date.parse(c.accepted_at)) / 86_400_000;
    if (Number.isFinite(days) && days >= 0) durations.push(days);
  }
  profile.avg_days_to_act = durations.length
    ? r2(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  // Sinal, não fórmula: alvos menores concluídos e alvos maiores parados.
  const completedTargets = args.commitments
    .filter((c) => c.status === "completed" && c.target_amount != null)
    .map((c) => Number(c.target_amount));
  const stalledTargets = args.commitments
    .filter((c) => c.status !== "completed" && c.target_amount != null
      && (byCommitment.get(String(c.id))?.outcomes ?? []).some((o) => o === "stalled" || o === "regressed"))
    .map((c) => Number(c.target_amount));
  if (completedTargets.length > 0 && stalledTargets.length > 0) {
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    profile.prefers_smaller_steps = avg(completedTargets) < avg(stalledTargets);
  }

  return profile;
}

export async function buildChangeLearningProfile(
  sb: SupabaseClient,
  userId: string,
  opts: { days?: number } = {},
): Promise<ChangeLearningProfile> {
  const days = Math.max(7, Math.min(365, opts.days ?? 120));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [events, commitments, checkins] = await Promise.all([
    sb.from("nino_learning_events")
      .select("event_type,signal,subject_key,metadata")
      .eq("user_id", userId).gte("occurred_at", since).limit(500),
    sb.from("nino_change_commitments")
      .select("id,stage,status,strategy,principles,dismissals,accepted_at,last_check_at,target_amount")
      .eq("user_id", userId).gte("accepted_at", since).limit(200),
    sb.from("nino_change_checkins")
      .select("commitment_id,outcome,created_at")
      .eq("user_id", userId).gte("created_at", since).limit(500),
  ]);
  return buildChangeLearningProfilePure({
    events: ((events?.data as any[]) ?? []),
    commitments: ((commitments?.data as any[]) ?? []),
    checkins: ((checkins?.data as any[]) ?? []),
  });
}

// ---------------------------------------------------------------------------
// Estratégia de intervenção: determinística, baseada em evidência, sem punição.
// ---------------------------------------------------------------------------
export type ChangeStrategy = "reinforce" | "remind" | "reframe" | "pause";

export function resolveChangeStrategy(args: {
  outcome: ChangeOutcome;
  stage?: string;
  consecutive_stalls?: number;
  dismissals?: number;
  intervention_attempts?: number;
  user_requested_stop?: boolean;
  learning_profile?: ChangeLearningProfile | null;
}): { strategy: ChangeStrategy; reason: string } {
  if (args.user_requested_stop) return { strategy: "pause", reason: "user_requested_stop" };

  const dismissals = Math.max(0, Number(args.dismissals ?? 0));
  if (dismissals >= 4) return { strategy: "pause", reason: "repeated_dismissals_respect_user" };
  if (dismissals >= 2) return { strategy: "reframe", reason: "dismissed_twice_change_approach" };

  if (args.outcome === "completed") return { strategy: "reinforce", reason: "evidence_completed" };
  if (args.outcome === "progress") return { strategy: "reinforce", reason: "evidence_progress" };
  if (args.outcome === "regressed") return { strategy: "reframe", reason: "evidence_regressed" };
  if (args.outcome === "no_evidence") return { strategy: "remind", reason: "truth_not_safe_to_measure" };

  const stalls = Math.max(0, Number(args.consecutive_stalls ?? 0));
  const attempts = Math.max(0, Number(args.intervention_attempts ?? 0));
  // Insistir indefinidamente é cobrança: depois de muitas tentativas medidas
  // sem avanço, o Nino pausa e devolve a decisão para a pessoa.
  if (stalls >= 4 || attempts >= 6) return { strategy: "pause", reason: "no_evidence_after_repeated_attempts" };
  if (stalls >= 2 || attempts >= 3) return { strategy: "reframe", reason: "stalled_repeatedly_reduce_friction" };

  const profile = args.learning_profile ?? null;
  if (profile && args.stage) {
    const stageStats = profile.stage_success[args.stage];
    if (stageStats && stageStats.total >= 3 && stageStats.success === 0) {
      return { strategy: "reframe", reason: "learning_profile_stage_never_worked" };
    }
  }
  if (profile?.prefers_smaller_steps && stalls >= 1) {
    return { strategy: "reframe", reason: "learning_profile_prefers_smaller_steps" };
  }

  return { strategy: "remind", reason: "first_stall_reduce_friction" };
}

// ---------------------------------------------------------------------------
// Lifecycle do check-in: só depois de entrega confirmada.
// ---------------------------------------------------------------------------
function checkinDedupKey(commitmentId: string, suggestionId: string, deliveredAt: string): string {
  return `checkin:${commitmentId}:${suggestionId}:${deliveredAt.slice(0, 10)}`;
}

async function consecutiveStalls(sb: SupabaseClient, userId: string, commitmentId: string): Promise<number> {
  const { data } = await sb.from("nino_change_checkins")
    .select("outcome,created_at")
    .eq("user_id", userId).eq("commitment_id", commitmentId)
    .order("created_at", { ascending: false }).limit(10);
  let count = 0;
  for (const row of ((data as any[]) ?? [])) {
    if (row.outcome === "stalled" || row.outcome === "regressed") count += 1;
    else break;
  }
  return count;
}

/**
 * Registra o check-in de um follow-up de mudança APENAS quando a mensagem foi
 * de fato entregue. Idempotente por (commitment, suggestion, dia da entrega).
 */
export async function confirmChangeFollowupDelivery(
  sb: SupabaseClient,
  userId: string,
  args: {
    suggestion_id: string;
    evidence: Record<string, unknown>;
    delivered_at?: string;
    channel?: string;
    communication_kind?: string | null;
  },
): Promise<{ status: "recorded" | "duplicate" | "not_change_followup" | "no_commitment"; commitment_id?: string }> {
  const commitmentId = String((args.evidence as any)?.change_commitment_id ?? "");
  if (!commitmentId) return { status: "not_change_followup" };

  const deliveredAt = args.delivered_at ?? new Date().toISOString();
  const dedupKey = checkinDedupKey(commitmentId, String(args.suggestion_id), deliveredAt);

  const { data: existing } = await sb.from("nino_change_checkins")
    .select("id").eq("user_id", userId).eq("dedup_key", dedupKey).maybeSingle();
  if (existing) return { status: "duplicate", commitment_id: commitmentId };

  const { data: commitment } = await sb.from("nino_change_commitments")
    .select("id,cadence_days,dismissals,intervention_attempts,status,stage")
    .eq("id", commitmentId).eq("user_id", userId).maybeSingle();
  if (!commitment) return { status: "no_commitment" };

  const outcome = String((args.evidence as any)?.outcome ?? "stalled") as ChangeOutcome;
  const score = clamp01(n((args.evidence as any)?.progress_score));
  const cadence = Math.max(1, Number(commitment.cadence_days ?? 7));

  const { error: insertError } = await sb.from("nino_change_checkins").insert({
    user_id: userId,
    commitment_id: commitmentId,
    outcome,
    progress_score: score,
    evidence: {
      ...((args.evidence as any)?.status_evidence ?? {}),
      delivery: { suggestion_id: args.suggestion_id, channel: args.channel ?? null, delivered_at: deliveredAt },
    },
    source: "delivery_confirmed",
    communicated: true,
    dedup_key: dedupKey,
  });
  if (insertError) {
    if (String(insertError.code ?? "") === "23505") return { status: "duplicate", commitment_id: commitmentId };
    throw new Error(`nino_change_checkin:${insertError.message}`);
  }

  const stalls = await consecutiveStalls(sb, userId, commitmentId);
  const profile = await buildChangeLearningProfile(sb, userId).catch(() => null);
  const attempts = Math.max(0, Number(commitment.intervention_attempts ?? 0)) + 1;
  const decided = resolveChangeStrategy({
    outcome,
    stage: String(commitment.stage ?? ""),
    consecutive_stalls: stalls,
    dismissals: Number(commitment.dismissals ?? 0),
    intervention_attempts: attempts,
    learning_profile: profile,
  });

  await sb.from("nino_change_commitments").update({
    last_check_at: deliveredAt,
    last_progress_score: score,
    last_outcome: outcome,
    next_check_at: isoPlusDays(cadence),
    intervention_attempts: attempts,
    strategy: decided.strategy,
    strategy_reason: decided.reason,
    last_strategy_change_at: new Date().toISOString(),
    ...(outcome === "completed"
      ? { status: "completed", ended_at: deliveredAt, end_reason: "evidence_completed" }
      : decided.strategy === "pause"
        ? { status: "paused", ended_at: deliveredAt, end_reason: "strategy_paused_after_dismissals" }
        : {}),
  }).eq("id", commitmentId).eq("user_id", userId);

  await recordLearningEvent(sb, {
    user_id: userId,
    event_type: "change_checkin",
    source: "delivery_confirmed",
    signal: outcome,
    subject_key: commitmentId,
    confidence: 0.9,
    after_value: { progress_score: score, strategy: decided.strategy },
    metadata: {
      communication_kind: args.communication_kind ?? null,
      strategy: decided.strategy,
      strategy_reason: decided.reason,
      consecutive_stalls: stalls,
      stage: commitment.stage,
    },
    dedup_key: dedupKey,
  }).catch(() => undefined);

  return { status: "recorded", commitment_id: commitmentId };
}

/**
 * Reconcilia entregas já confirmadas (inclui ack assíncrono do WhatsApp) que
 * ainda não geraram check-in. Sem fila paralela: lê `communication_deliveries`.
 */
export async function reconcileChangeFollowupDeliveries(
  sb: SupabaseClient,
  userId: string,
  opts: { hours?: number } = {},
): Promise<{ recorded: number; duplicates: number }> {
  const since = new Date(Date.now() - Math.max(1, opts.hours ?? 72) * 3_600_000).toISOString();
  const { data } = await sb.from("communication_deliveries")
    .select("suggestion_id,channel,kind,status,delivered_at,evidence")
    .eq("user_id", userId)
    .eq("status", "delivered")
    .gte("created_at", since)
    .limit(200);

  let recorded = 0;
  let duplicates = 0;
  for (const row of ((data as any[]) ?? [])) {
    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    if (!evidence.change_commitment_id) continue;
    const result = await confirmChangeFollowupDelivery(sb, userId, {
      suggestion_id: String(row.suggestion_id),
      evidence,
      delivered_at: row.delivered_at ? String(row.delivered_at) : undefined,
      channel: row.channel ? String(row.channel) : undefined,
      communication_kind: row.kind ? String(row.kind) : null,
    }).catch(() => ({ status: "no_commitment" as const }));
    if (result.status === "recorded") recorded += 1;
    else if (result.status === "duplicate") duplicates += 1;
  }
  return { recorded, duplicates };
}

/** Registra dispensa explícita do usuário — insumo de estratégia, não punição. */
export async function registerChangeDismissal(
  sb: SupabaseClient,
  userId: string,
  commitmentId: string,
): Promise<{ dismissals: number; strategy: ChangeStrategy } | null> {
  const { data: row } = await sb.from("nino_change_commitments")
    .select("id,stage,dismissals,intervention_attempts")
    .eq("id", commitmentId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!row) return null;
  const dismissals = Math.max(0, Number(row.dismissals ?? 0)) + 1;
  const profile = await buildChangeLearningProfile(sb, userId).catch(() => null);
  const decided = resolveChangeStrategy({
    outcome: "stalled",
    stage: String(row.stage ?? ""),
    dismissals,
    intervention_attempts: Number(row.intervention_attempts ?? 0),
    learning_profile: profile,
  });
  await sb.from("nino_change_commitments").update({
    dismissals,
    strategy: decided.strategy,
    strategy_reason: decided.reason,
    last_strategy_change_at: new Date().toISOString(),
    ...(decided.strategy === "pause"
      ? { status: "paused", ended_at: new Date().toISOString(), end_reason: "paused_after_dismissals" }
      : {}),
  }).eq("id", commitmentId).eq("user_id", userId);
  await recordLearningEvent(sb, {
    user_id: userId,
    event_type: "change_dismissal",
    source: "user_action",
    signal: "dismissed",
    subject_key: commitmentId,
    confidence: 1,
    metadata: { dismissals, strategy: decided.strategy, strategy_reason: decided.reason, stage: row.stage },
  }).catch(() => undefined);
  return { dismissals, strategy: decided.strategy };
}

