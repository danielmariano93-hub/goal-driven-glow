// deno-lint-ignore-file no-explicit-any
// nino_behavioral_timing.v1 — runtime: eventos reais -> janelas -> situações.
// ===========================================================================
// Este módulo NÃO calcula dinheiro e NÃO chama IA. Ele:
//  1. lê os eventos comportamentais já gravados pelos gatilhos de banco;
//  2. monta o contexto de timing a partir do snapshot canônico + NextBestAction;
//  3. aplica `assessTiming` (determinístico) e transforma o que está elegível em
//     situação para o MESMO governador proativo (nada de dispatcher novo);
//  4. registra o aprendizado de timing (trigger x janela x resultado).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  assessTiming,
  classifyMoneyIn,
  DEFAULT_TIMING_WINDOWS,
  effectiveScore,
  timingFingerprint,
  BEHAVIORAL_TIMING_VERSION,
  type BehavioralEventInput,
  type BehavioralTrigger,
  type TimingAssessment,
  type TimingContext,
  type TimingWindowConfig,
} from "./behavioralTiming.ts";
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { resolveBehavioralIntervention } from "../agent/behavioralPrinciples.ts";
import { composeChangeMessage } from "../agent/changeMessage.ts";
import type { NextBestAction } from "../agent/behaviorWealth.ts";

export type StoredBehavioralEvent = {
  id: string;
  event_type: string;
  economic_event_id: string | null;
  occurred_at: string;
  materiality: number;
  payload: Record<string, unknown>;
};

const TIMING_TRIGGERS = new Set<string>(Object.keys(DEFAULT_TIMING_WINDOWS));

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Math.abs(Math.round(value * 100) / 100));
}

/** Política de janelas configurável (tabela) com fallback determinístico. */
export async function loadTimingWindows(
  sb: SupabaseClient,
): Promise<Record<BehavioralTrigger, TimingWindowConfig>> {
  const out: Record<string, TimingWindowConfig> = { ...DEFAULT_TIMING_WINDOWS };
  const { data } = await sb.from("nino_behavioral_timing_windows")
    .select("event_type,open_after_hours,valid_for_hours,min_evidence_count,relative_floor_pct,enabled");
  for (const row of ((data as any[]) ?? [])) {
    const key = String(row.event_type);
    if (!TIMING_TRIGGERS.has(key)) continue;
    out[key] = {
      event_type: key as BehavioralTrigger,
      open_after_hours: Number(row.open_after_hours ?? 0),
      valid_for_hours: Number(row.valid_for_hours ?? 24),
      min_evidence_count: Number(row.min_evidence_count ?? 1),
      relative_floor_pct: Number(row.relative_floor_pct ?? 0),
      enabled: row.enabled !== false,
    };
  }
  return out as Record<BehavioralTrigger, TimingWindowConfig>;
}

/** Eventos ainda não avaliados (a própria tabela é a fila). */
export async function loadPendingBehavioralEvents(
  sb: SupabaseClient,
  userId: string,
  opts: { days?: number; limit?: number } = {},
): Promise<StoredBehavioralEvent[]> {
  const since = new Date(Date.now() - (opts.days ?? 10) * 86_400_000).toISOString();
  const { data } = await sb.from("nino_behavioral_events")
    .select("id,event_type,economic_event_id,occurred_at,materiality,payload")
    .eq("user_id", userId)
    .is("processed_at", null)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(opts.limit ?? 40);
  return ((data as any[]) ?? []).map((row) => ({
    id: String(row.id),
    event_type: String(row.event_type),
    economic_event_id: row.economic_event_id ? String(row.economic_event_id) : null,
    occurred_at: String(row.occurred_at),
    materiality: Number(row.materiality ?? 0),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

/** Taxa histórica de ação por `trigger:window` (0..1) — aprendizado de timing. */
export async function loadTimingLearning(
  sb: SupabaseClient,
  userId: string,
  days = 120,
): Promise<{ learned: Record<string, number>; dismissals: Record<string, number> }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from("nino_learning_events")
    .select("signal,metadata,occurred_at")
    .eq("user_id", userId)
    .eq("event_type", "timing_outcome")
    .gte("occurred_at", since)
    .limit(500);
  const tally: Record<string, { total: number; acted: number }> = {};
  const dismissals: Record<string, number> = {};
  for (const row of ((data as any[]) ?? [])) {
    const meta = (row.metadata ?? {}) as any;
    const trigger = String(meta.trigger ?? "");
    const window = String(meta.window ?? "");
    if (!trigger) continue;
    const key = `${trigger}:${window}`;
    const entry = tally[key] ??= { total: 0, acted: 0 };
    if (row.signal === "acted") { entry.total += 1; entry.acted += 1; }
    if (row.signal === "dismissed") {
      entry.total += 1;
      dismissals[trigger] = (dismissals[trigger] ?? 0) + 1;
    }
  }
  const learned: Record<string, number> = {};
  for (const [key, entry] of Object.entries(tally)) {
    // Amostra pequena não vira convicção: mantém a neutralidade de 0.5.
    learned[key] = entry.total >= 3 ? entry.acted / entry.total : 0.5;
  }
  return { learned, dismissals };
}

export type TimingContextExtras = {
  has_active_goal: boolean;
  commitment_pending: boolean;
  learned: Record<string, number>;
  dismissals: Record<string, number>;
};

/** Contexto de timing derivado do canônico — nenhum número nasce aqui. */
export function buildTimingContext(
  ctx: MultiFinanceProactiveContext,
  nextBest: NextBestAction | null,
  extras: TimingContextExtras,
  nowIso = new Date().toISOString(),
): TimingContext {
  const state = nextBest?.financial_state;
  const debtPressureDominant = nextBest?.stage === "reduce_debt_pressure";
  return {
    now: nowIso,
    monthly_income: Number(ctx.monthly_income ?? 0),
    materiality_floor: Number(ctx.materiality_floor ?? 0),
    truth_gate_safe: !(nextBest?.truth_gate?.blocked ?? false),
    projected_month_end_available: Number(
      state?.projected_month_end_available ?? ctx.projected_month_end_available ?? 0,
    ),
    available_today: Number(state?.available_today ?? ctx.available_today ?? 0),
    sustainable_capacity: Number(state?.sustainable_monthly_saving ?? 0),
    has_active_goal: extras.has_active_goal,
    debt_pressure_dominant: debtPressureDominant,
    commitment_pending: extras.commitment_pending,
    learned: extras.learned,
    recent_dismissals: 0,
    repetitions: 0,
  };
}

function toEventInput(
  event: StoredBehavioralEvent,
  evidenceCount: number,
): BehavioralEventInput | null {
  const payload = event.payload ?? {};
  const raw = event.event_type;
  if (raw === "MONEY_IN") {
    return {
      trigger: "MONEY_IN",
      occurred_at: event.occurred_at,
      economic_event_id: event.economic_event_id,
      materiality: event.materiality,
      evidence_count: evidenceCount,
      money_in_kind: classifyMoneyIn(payload as any),
      payload,
    };
  }
  if (raw === "LARGE_SPEND") {
    return {
      trigger: "LARGE_SPEND",
      occurred_at: event.occurred_at,
      economic_event_id: event.economic_event_id,
      materiality: event.materiality,
      evidence_count: evidenceCount,
      payload,
    };
  }
  if (raw === "GOAL_CONTRIBUTION" || raw === "DEBT_PAYMENT") {
    return {
      trigger: "BEHAVIOR_BREAKTHROUGH",
      occurred_at: event.occurred_at,
      economic_event_id: event.economic_event_id,
      materiality: event.materiality,
      evidence_count: evidenceCount,
      payload,
    };
  }
  if (raw === "CREDIT_CARD_CLOSE") {
    return {
      trigger: "CREDIT_CARD_CLOSE",
      occurred_at: event.occurred_at,
      economic_event_id: event.economic_event_id,
      materiality: event.materiality,
      evidence_count: evidenceCount,
      payload,
    };
  }
  if (TIMING_TRIGGERS.has(raw)) {
    return {
      trigger: raw as BehavioralTrigger,
      occurred_at: event.occurred_at,
      economic_event_id: event.economic_event_id,
      materiality: event.materiality,
      evidence_count: evidenceCount,
      payload,
    };
  }
  return null;
}

export type TimingSituationResult = {
  situations: FinancialSituation[];
  assessments: Array<{ event_id: string; assessment: TimingAssessment; fingerprint: string | null }>;
};

/**
 * Texto determinístico por gatilho. O valor SEMPRE vem do motor canônico
 * (`NextBestAction` / snapshot). Nada de "guarde 10%".
 */
function bodyFor(
  input: BehavioralEventInput,
  assessment: TimingAssessment,
  ctx: TimingContext,
  nextBest: NextBestAction | null,
): { title: string; body: string; route: string; amount: number } | null {
  const principle = assessment.principle_candidates[0];
  if (!principle) return null;

  if (input.trigger === "MONEY_IN") {
    if (principle === "margin_of_safety") {
      const gap = Math.abs(ctx.projected_month_end_available);
      return {
        title: "Entrou dinheiro, mas o mês ainda fecha apertado",
        body: ctx.projected_month_end_available < 0
          ? `Entrou dinheiro agora, e a projeção do mês ainda fecha ${brl(gap)} negativa. Antes de separar qualquer valor para meta, o passo que protege você é fechar essa diferença.`
          : "Entrou dinheiro agora, mas a base financeira ainda não está confirmada. Antes de crescer, vale acertar a verdade do caixa.",
        route: "/app/lancamentos",
        amount: gap,
      };
    }
    const amount = Number(nextBest?.action?.amount ?? ctx.sustainable_capacity ?? 0);
    if (amount <= 0) return null;
    if (principle === "friction_and_nudge") {
      return {
        title: "O dinheiro do combinado entrou",
        body: `Entrou dinheiro hoje e o aporte que você combinou ainda não aconteceu. Enquanto o valor não se mistura ao restante do mês, dá para executar os ${brl(amount)} que seu plano já comporta.`,
        route: nextBest?.action?.route ?? "/app/metas",
        amount,
      };
    }
    return {
      title: "Momento de separar antes de gastar",
      body: `Entrou dinheiro hoje. Antes que ele se misture ao restante do mês, este é um bom momento para separar os ${brl(amount)} que seu plano já comporta.`,
      route: nextBest?.action?.route ?? "/app/metas",
      amount,
    };
  }

  if (input.trigger === "LARGE_SPEND") {
    const spend = Number(input.materiality ?? 0);
    if (spend <= 0) return null;
    const commitment = Number(nextBest?.action?.amount ?? 0);
    const months = commitment > 0 ? Math.round((spend / commitment) * 10) / 10 : null;
    const parts = [
      `Registrei ${brl(spend)} em um gasto relevante.`,
      `Com esse valor, a projeção de fechamento do mês fica em ${brl(ctx.projected_month_end_available)}.`,
    ];
    if (months && months >= 0.5) {
      parts.push(`Em termos de plano, equivale a ${months.toString().replace(".", ",")} mês(es) do aporte que você já se comprometeu a fazer.`);
    }
    return {
      title: "O que essa compra move no seu plano",
      body: parts.join(" "),
      route: "/app/relatorios",
      amount: spend,
    };
  }

  if (input.trigger === "BEHAVIOR_BREAKTHROUGH") {
    const count = Number(input.evidence_count ?? 0);
    return {
      title: "Você repetiu o que funciona",
      body: `Você repetiu esse movimento em ${count} ciclos seguidos. Não é sorte: é um padrão que os seus próprios dados comprovam.`,
      route: "/app/metas",
      amount: Number(input.materiality ?? 0),
    };
  }

  return null;
}

/**
 * Converte eventos elegíveis em situações para o governador existente.
 * Gatilhos sem texto próprio (cartão, dívida, caixa) continuam sendo cobertos
 * pelos detectores atuais — aqui eles só alimentam o score de momento.
 */
export function buildTimingSituations(args: {
  events: StoredBehavioralEvent[];
  timingCtx: TimingContext;
  windows: Partial<Record<BehavioralTrigger, TimingWindowConfig>>;
  nextBest: NextBestAction | null;
  learningProfile?: Parameters<typeof resolveBehavioralIntervention>[0]["learningProfile"];
  dismissals?: Record<string, number>;
  alreadyFingerprinted?: Set<string>;
}): TimingSituationResult {
  const situations: FinancialSituation[] = [];
  const assessments: TimingSituationResult["assessments"] = [];
  const seen = new Set<string>(args.alreadyFingerprinted ?? []);
  // Repetição de comportamento: quantos eventos do mesmo tipo sustentam a leitura.
  const countByType: Record<string, number> = {};
  for (const event of args.events) {
    countByType[event.event_type] = (countByType[event.event_type] ?? 0) + 1;
  }

  for (const event of args.events) {
    const evidenceCount = countByType[event.event_type] ?? 1;
    const input = toEventInput(event, evidenceCount);
    if (!input) continue;
    const ctx: TimingContext = {
      ...args.timingCtx,
      recent_dismissals: Number(args.dismissals?.[input.trigger] ?? 0),
    };
    const assessment = assessTiming(input, ctx, args.windows);
    const principle = assessment.principle_candidates[0] ?? null;
    const fingerprint = principle
      ? timingFingerprint({
        trigger: input.trigger,
        economic_event_id: input.economic_event_id,
        occurred_at: input.occurred_at,
        principle,
        window: assessment.window,
      })
      : null;
    assessments.push({ event_id: event.id, assessment, fingerprint });

    if (!assessment.eligible_now || !principle || !fingerprint) continue;
    if (seen.has(fingerprint)) continue; // dedup: um evento, uma intervenção
    const content = bodyFor(input, assessment, ctx, args.nextBest);
    if (!content) continue;
    seen.add(fingerprint);

    const intervention = resolveBehavioralIntervention({
      stage: args.nextBest?.stage ?? "protect_progress",
      principles: assessment.principle_candidates,
      strategy: principle === "identity_reinforcement"
        ? "reinforce"
        : principle === "friction_and_nudge"
          ? "remind"
          : undefined,
      learningProfile: args.learningProfile ?? null,
      financialFacts: (args.nextBest?.financial_state as unknown as Record<string, unknown>) ?? null,
      trigger: input.trigger,
      timing: { window: assessment.window, timing_score: assessment.timing_score },
    });

    situations.push({
      fingerprint,
      type: `timing:${input.trigger.toLowerCase()}`,
      communication_kind: principle === "identity_reinforcement"
        ? "behavior_reinforcement"
        : principle === "margin_of_safety"
          ? "cash_protection_action"
          : "wealth_building_action",
      severity: principle === "margin_of_safety" ? "attention" : "info",
      title: content.title,
      body: composeChangeMessage({ baseMessage: content.body, instruction: intervention }),
      primary_domain: input.trigger === "LARGE_SPEND" ? "patterns" : "goals",
      domains: input.trigger === "MONEY_IN" ? ["cash", "goals"] : ["patterns"],
      signals: [],
      impact_amount: Number(content.amount ?? 0),
      days_until: null,
      confidence: Math.max(0.6, Number(args.nextBest?.confidence ?? 0.8)),
      actionable: true,
      route: content.route,
      priority_score: 0,
      score_reasons: [],
      evidence: {
        source: BEHAVIORAL_TIMING_VERSION,
        behavioral_timing: assessment,
        behavioral_timing_owned: true,
        timing_score: assessment.timing_score,
        timing_trigger: input.trigger,
        timing_window: assessment.window,
        behavioral_event_id: event.id,
        economic_event_id: input.economic_event_id,
        behavioral_intervention: intervention,
        communication_instruction: intervention,
        deterministic_body: content.body,
        logical_topic_key: `timing:${input.trigger.toLowerCase()}:${principle}`,
        formula_version: BEHAVIORAL_TIMING_VERSION,
        canonical_amount_source: args.nextBest?.version ?? "snapshot",
      },
    });
  }

  return { situations, assessments };
}

/**
 * Timing como sinal de ranking para as situações que JÁ existem: nunca bloqueia
 * detector antigo, apenas ordena e deixa a evidência auditável.
 */
export function attachTimingSignal(
  situations: FinancialSituation[],
  timingCtx: TimingContext,
  windows: Partial<Record<BehavioralTrigger, TimingWindowConfig>> = {},
): FinancialSituation[] {
  return situations.map((situation) => {
    const owned = (situation.evidence as any)?.behavioral_timing_owned === true;
    if (owned) return situation;
    const trigger = triggerForSituation(situation);
    if (!trigger) return situation;
    const occurredAt = situation.days_until != null && situation.days_until < 0
      ? new Date(Date.parse(timingCtx.now) + situation.days_until * 86_400_000).toISOString()
      : timingCtx.now;
    const assessment = assessTiming({
      trigger,
      occurred_at: occurredAt,
      materiality: situation.impact_amount,
      evidence_count: Math.max(1, situation.signals.length),
      actionable: situation.actionable,
    }, timingCtx, windows);
    return {
      ...situation,
      evidence: {
        ...situation.evidence,
        behavioral_timing: assessment,
        behavioral_timing_owned: false,
        timing_score: assessment.timing_score,
        timing_trigger: trigger,
        timing_window: assessment.window,
      },
    };
  });
}

function triggerForSituation(situation: FinancialSituation): BehavioralTrigger | null {
  const days = situation.days_until ?? 99;
  switch (situation.primary_domain) {
    case "cards": return days <= 5 ? "CREDIT_CARD_DUE_SOON" : "CREDIT_CARD_CLOSE";
    case "debts": return "DEBT_INSTALLMENT_DUE";
    case "cash": return situation.severity === "info" ? "CASH_RECOVERY" : "CASH_RISK";
    case "goals": return "GOAL_OPPORTUNITY";
    case "patterns": return "FLEXIBLE_SPEND_CLUSTER";
    case "commitments": return "COMMITMENT_WINDOW";
    default: return null;
  }
}

export { effectiveScore };

/** Marca o evento como avaliado — tick repetido é idempotente. */
export async function markBehavioralEventsProcessed(
  sb: SupabaseClient,
  entries: Array<{ event_id: string; assessment: TimingAssessment; fingerprint: string | null }>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const entry of entries) {
    await sb.from("nino_behavioral_events").update({
      processed_at: nowIso,
      processing_result: {
        trigger: entry.assessment.trigger,
        window: entry.assessment.window,
        timing_score: entry.assessment.timing_score,
        eligible_now: entry.assessment.eligible_now,
        reason: entry.assessment.reason,
        principle: entry.assessment.principle_candidates[0] ?? null,
        fingerprint: entry.fingerprint,
        growth_blocked: entry.assessment.growth_blocked,
      },
    }).eq("id", entry.event_id);
  }
}

/** Aprendizado de timing: registra a entrega com trigger, janela e princípio. */
export async function recordTimingDeliveries(
  sb: SupabaseClient,
  userId: string,
  situations: FinancialSituation[],
): Promise<number> {
  const rows = situations
    .filter((situation) => (situation.evidence as any)?.behavioral_timing_owned === true)
    .map((situation) => {
      const assessment = (situation.evidence as any).behavioral_timing as TimingAssessment;
      const intervention = (situation.evidence as any).behavioral_intervention ?? {};
      return {
        user_id: userId,
        event_type: "timing_outcome",
        source: "behavioral_timing",
        signal: "delivered",
        subject_key: situation.fingerprint,
        confidence: situation.confidence,
        weight: 1,
        dedup_key: `timing_delivered:${situation.fingerprint}`,
        metadata: {
          trigger: assessment?.trigger ?? null,
          window: assessment?.window ?? null,
          timing_score: assessment?.timing_score ?? null,
          priority_score: situation.priority_score,
          principle: intervention?.principle ?? null,
          strategy: intervention?.strategy ?? null,
          delivered_at: new Date().toISOString(),
        },
      };
    });
  if (rows.length === 0) return 0;
  await sb.from("nino_learning_events").upsert(rows, {
    onConflict: "user_id,dedup_key", ignoreDuplicates: true,
  });
  return rows.length;
}

/**
 * Fecha o ciclo: entrega -> resultado. Lê o que o usuário fez com as
 * comunicações de timing e grava `acted`/`dismissed` com o tempo até a ação.
 */
export async function reconcileTimingOutcomes(
  sb: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const { data } = await sb.from("communication_deliveries")
    .select("dedup_key,evidence,delivered_at,acted_at,interacted_at,user_feedback,created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .limit(200);
  const rows: any[] = [];
  for (const row of ((data as any[]) ?? [])) {
    const timing = (row.evidence ?? {})?.behavioral_timing;
    if (!timing?.trigger) continue;
    const acted = row.acted_at ?? row.interacted_at ?? null;
    const dismissed = row.user_feedback === "dismissed" || row.user_feedback === "not_useful";
    if (!acted && !dismissed) continue;
    const deliveredAt = row.delivered_at ?? row.created_at;
    const hours = acted && deliveredAt
      ? Math.max(0, (Date.parse(acted) - Date.parse(deliveredAt)) / 3_600_000)
      : 0;
    rows.push({
      user_id: userId,
      event_type: "timing_outcome",
      source: "behavioral_timing",
      signal: acted ? "acted" : "dismissed",
      subject_key: String(row.dedup_key ?? timing.trigger),
      confidence: 1,
      weight: 1,
      dedup_key: `timing_${acted ? "acted" : "dismissed"}:${row.dedup_key}`,
      metadata: {
        trigger: timing.trigger,
        window: timing.window,
        timing_score: timing.timing_score ?? null,
        principle: (row.evidence ?? {})?.behavioral_intervention?.principle ?? null,
        strategy: (row.evidence ?? {})?.behavioral_intervention?.strategy ?? null,
        hours_to_action: Math.round(hours * 100) / 100,
      },
    });
  }
  if (rows.length === 0) return 0;
  await sb.from("nino_learning_events").upsert(rows, {
    onConflict: "user_id,dedup_key", ignoreDuplicates: true,
  });
  return rows.length;
}
