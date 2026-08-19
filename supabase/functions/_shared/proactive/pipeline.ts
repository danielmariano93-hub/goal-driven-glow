// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — orquestração: contexto → sinais → situações →
// ranking → orçamento de atenção → fila de comunicação.
// A entrega final continua a cargo do dispatcher e das regras de convivência.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildMultiFinanceProactiveContext } from "./context.ts";
import { collectFinancialSignals } from "./signals.ts";
import { composeFinancialSituations } from "./situations.ts";
import { allocateAttention } from "./ranking.ts";
import {
  DEFAULT_ATTENTION_BUDGET,
  PROACTIVE_MULTIFINANCE_VERSION,
  type AttentionBudget,
  type FinancialSituation,
  type ProactiveDecision,
} from "./contracts.ts";

export type MultiFinanceRunResult = {
  version: string;
  user_id: string;
  as_of: string;
  signals: number;
  situations: number;
  delivered_candidates: number;
  suppressed: number;
  suppression_reasons: Record<string, number>;
  top: Array<{ fingerprint: string; type: string; score: number; impact: number; domains: string[] }>;
};

function candidateFor(userId: string, situation: FinancialSituation) {
  return {
    user_id: userId,
    kind: situation.communication_kind,
    severity: situation.severity,
    title: situation.title,
    body: situation.body,
    action: situation.route ? { type: "open_route", route: situation.route } : {},
    evidence: {
      ...situation.evidence,
      situation_type: situation.type,
      situation_fingerprint: situation.fingerprint,
      domains: situation.domains,
      impact_amount: situation.impact_amount,
      confidence: situation.confidence,
      priority_score: situation.priority_score,
      score_reasons: situation.score_reasons,
      logical_topic_key: situation.fingerprint,
    },
    channel_ready: "both" as const,
    dedup_key: situation.fingerprint,
    expires_at: null as string | null,
  };
}

/** Fingerprints já comunicados nos últimos dias (sem mudança material). */
async function loadAlreadyDelivered(sb: SupabaseClient, userId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from("proactive_situations")
    .select("fingerprint,last_delivered_at,impact_amount")
    .eq("user_id", userId)
    .gte("last_delivered_at", since)
    .limit(200);
  return new Set(((data as any[]) ?? []).map((row) => String(row.fingerprint)));
}

export async function runMultiFinanceProactive(
  sb: SupabaseClient,
  userId: string,
  opts: {
    persist?: boolean;
    channels?: Array<"app" | "whatsapp">;
    budget?: AttentionBudget;
    repeatWindowDays?: number;
  } = {},
): Promise<MultiFinanceRunResult> {
  const persist = opts.persist !== false;
  const channels = opts.channels ?? ["app"];
  const ctx = await buildMultiFinanceProactiveContext(sb, userId);
  const signals = collectFinancialSignals(ctx);
  const situations = composeFinancialSituations(signals, ctx);
  const alreadyDelivered = persist
    ? await loadAlreadyDelivered(sb, userId, opts.repeatWindowDays ?? 5)
    : new Set<string>();

  const { decisions, selected } = allocateAttention({
    situations,
    ctx,
    channels,
    budget: opts.budget ?? DEFAULT_ATTENTION_BUDGET,
    alreadyDelivered,
  });

  const suppressionReasons: Record<string, number> = {};
  for (const decision of decisions) {
    if (decision.decision !== "suppress") continue;
    suppressionReasons[decision.reason] = (suppressionReasons[decision.reason] ?? 0) + 1;
  }

  if (persist) {
    await persistRun(sb, userId, ctx.as_of, signals, situations, decisions, selected);
    if (selected.length > 0) {
      const { error } = await sb.from("pending_proactive_suggestions")
        .upsert(selected.map((situation) => candidateFor(userId, situation)), {
          onConflict: "user_id,dedup_key", ignoreDuplicates: false,
        });
      if (error) throw new Error(`pending_proactive_suggestions_upsert:${error.message}`);
    }
  }

  return {
    version: PROACTIVE_MULTIFINANCE_VERSION,
    user_id: userId,
    as_of: ctx.as_of,
    signals: signals.length,
    situations: situations.length,
    delivered_candidates: selected.length,
    suppressed: decisions.filter((decision) => decision.decision === "suppress").length,
    suppression_reasons: suppressionReasons,
    top: situations.slice(0, 5).map((situation) => ({
      fingerprint: situation.fingerprint,
      type: situation.type,
      score: situation.priority_score,
      impact: situation.impact_amount,
      domains: situation.domains,
    })),
  };
}

async function persistRun(
  sb: SupabaseClient,
  userId: string,
  asOf: string,
  signals: ReturnType<typeof collectFinancialSignals>,
  situations: FinancialSituation[],
  decisions: ProactiveDecision[],
  selected: FinancialSituation[],
) {
  const nowIso = new Date().toISOString();
  const selectedKeys = new Set(selected.map((situation) => situation.fingerprint));

  if (signals.length > 0) {
    await sb.from("proactive_signals").upsert(signals.map((signal) => ({
      user_id: userId,
      as_of: asOf,
      signal_key: signal.key,
      domain: signal.domain,
      label: signal.label,
      amount: signal.amount,
      direction: signal.direction,
      event_date: signal.date,
      days_until: signal.days_until,
      confidence: signal.confidence,
      actionable: signal.actionable,
      evidence: signal.evidence,
      formula_version: PROACTIVE_MULTIFINANCE_VERSION,
    })), { onConflict: "user_id,as_of,signal_key", ignoreDuplicates: false });
  }

  if (situations.length > 0) {
    await sb.from("proactive_situations").upsert(situations.map((situation) => ({
      user_id: userId,
      fingerprint: situation.fingerprint,
      as_of: asOf,
      situation_type: situation.type,
      communication_kind: situation.communication_kind,
      severity: situation.severity,
      title: situation.title,
      body: situation.body,
      primary_domain: situation.primary_domain,
      domains: situation.domains,
      impact_amount: situation.impact_amount,
      days_until: situation.days_until,
      confidence: situation.confidence,
      actionable: situation.actionable,
      priority_score: situation.priority_score,
      score_reasons: situation.score_reasons,
      evidence: situation.evidence,
      last_seen_at: nowIso,
      ...(selectedKeys.has(situation.fingerprint) ? { last_delivered_at: nowIso } : {}),
      formula_version: PROACTIVE_MULTIFINANCE_VERSION,
    })), { onConflict: "user_id,fingerprint", ignoreDuplicates: false });
  }

  if (decisions.length > 0) {
    await sb.from("proactive_decisions").insert(decisions.map((decision) => ({
      user_id: userId,
      as_of: asOf,
      fingerprint: decision.fingerprint,
      channel: decision.channel,
      decision: decision.decision,
      reason: decision.reason,
      priority_score: decision.priority_score,
      formula_version: PROACTIVE_MULTIFINANCE_VERSION,
    })));
  }
}
