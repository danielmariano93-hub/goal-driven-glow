// anticipation_contract.v1 — runner de I/O do Motor de Antecipação.
// Toda a matemática vive nos módulos puros; aqui só entra leitura, escrita e
// decisão de envio. Nada aqui recalcula contabilidade.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ANTICIPATION_FORMULA_VERSION,
  type AnticipationOpportunity,
  type BehavioralPattern,
  type DetectorConfig,
  type DetectorKey,
  type StalePolicy,
} from "./contracts.ts";
import {
  aggregateCycleFacts,
  aggregateDailyFacts,
  buildTransactionFacts,
  normalizeMerchant,
  type AnticipationTxRow,
} from "./facts.ts";
import { assessDataQuality, detectorEligible } from "./qualityGates.ts";
import { discoverPatterns, reconcilePattern } from "./patterns.ts";
import { buildOpportunity, stillValid } from "./opportunities.ts";
import { orchestrateAttention } from "./orchestrator.ts";
import { decideStale } from "./staleness.ts";

const TX_FIELDS = "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,posted_at,competence_date,occurred_at_time,occurred_at_timezone,occurred_at_precision,category_source,category_confidence";
const WINDOW_DAYS = 210;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function chunkUpsert(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 400), { onConflict });
    if (error) throw new Error(`${table}:${error.message}`);
  }
}

export async function loadDetectorConfigs(
  sb: SupabaseClient,
  opts: { includeInactive?: boolean } = {},
): Promise<Map<DetectorKey, DetectorConfig>> {
  const { data, error } = await sb.from("anticipation_detector_config").select("*");
  if (error) throw new Error(`anticipation_detector_config:${error.message}`);
  const map = new Map<DetectorKey, DetectorConfig>();
  for (const row of ((data as any[] | null) ?? [])) {
    if (!row.active && !opts.includeInactive) continue;
    map.set(row.detector as DetectorKey, {
      detector: row.detector,
      version: String(row.version ?? "v1"),
      active: Boolean(row.active),
      kind: String(row.kind ?? row.detector),
      min_sample: Number(row.min_sample ?? 8),
      min_window_days: Number(row.min_window_days ?? 56),
      min_uplift_pct: Number(row.min_uplift_pct ?? 25),
      min_absolute_delta: Number(row.min_absolute_delta ?? 50),
      min_hit_rate: Number(row.min_hit_rate ?? 0.6),
      min_confidence: Number(row.min_confidence ?? 0.6),
      min_coverage: Number(row.min_coverage ?? 0.85),
      min_utility_score: Number(row.min_utility_score ?? 0.55),
      lead_time_hours: Number(row.lead_time_hours ?? 12),
      window_hours: Number(row.window_hours ?? 24),
    });
  }
  return map;
}

type UserContext = {
  timezone: string | null;
  quietStart: string | null;
  quietEnd: string | null;
  anticipationEnabled: boolean;
  anticipationWhatsapp: boolean;
  mutedKinds: string[];
  mutedPatternIds: string[];
};

async function loadUserContext(sb: SupabaseClient, userId: string): Promise<UserContext> {
  const [prefsResp, profileResp] = await Promise.all([
    sb.from("notification_preferences")
      .select("quiet_start,quiet_end,timezone,anticipation_enabled,anticipation_whatsapp,anticipation_kinds,muted_pattern_ids,muted_proactive_kinds")
      .eq("user_id", userId).maybeSingle(),
    sb.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
  ]);
  const prefs = (prefsResp.data as any) ?? {};
  return {
    timezone: prefs.timezone ?? (profileResp.data as any)?.timezone ?? null,
    quietStart: prefs.quiet_start ?? "21:00",
    quietEnd: prefs.quiet_end ?? "08:00",
    anticipationEnabled: prefs.anticipation_enabled ?? true,
    anticipationWhatsapp: prefs.anticipation_whatsapp ?? false,
    mutedKinds: Array.isArray(prefs.muted_proactive_kinds) ? prefs.muted_proactive_kinds.map(String) : [],
    mutedPatternIds: Array.isArray(prefs.muted_pattern_ids) ? prefs.muted_pattern_ids.map(String) : [],
  };
}

async function loadFatigue(sb: SupabaseClient, userId: string) {
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [deliveries7, deliveries60, feedback] = await Promise.all([
    sb.from("communication_deliveries").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "delivered").gte("created_at", since7),
    sb.from("communication_deliveries").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "delivered").gte("created_at", since60),
    sb.from("communication_feedback").select("feedback,created_at")
      .eq("user_id", userId).gte("created_at", since60),
  ]);
  const rows = ((feedback.data as any[] | null) ?? []);
  const countBetween = (value: string, since: string) =>
    rows.filter((r) => String(r.feedback) === value && String(r.created_at) >= since).length;
  return {
    fatigue: {
      deliveries_last_7d: Number(deliveries7.count ?? 0),
      not_useful_last_30d: countBetween("not_useful", since30),
      dismissed_last_30d: countBetween("dismissed", since30),
    },
    receptivity: {
      useful_last_60d: rows.filter((r) => String(r.feedback) === "useful").length,
      deliveries_last_60d: Number(deliveries60.count ?? 0),
    },
  };
}

export type AnticipationRunResult = {
  user_id: string;
  transaction_facts: number;
  daily_facts: number;
  cycle_facts: number;
  quality: ReturnType<typeof assessDataQuality>;
  detectors_eligible: string[];
  patterns_validated: number;
  patterns_weakened: number;
  opportunities_scheduled: number;
  skipped?: string;
  errors: string[];
};

/**
 * Etapa 1+2+3: fatos → padrões → oportunidades agendadas.
 * `dryRun` mantém tudo persistido com `dry_run = true` para auditoria sem envio.
 */
export async function runAnticipationForUser(
  sb: SupabaseClient,
  userId: string,
  opts: { dryRun?: boolean; now?: Date; includeInactiveDetectors?: boolean } = {},
): Promise<AnticipationRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun !== false;
  const errors: string[] = [];
  const result: AnticipationRunResult = {
    user_id: userId,
    transaction_facts: 0,
    daily_facts: 0,
    cycle_facts: 0,
    quality: { ok: false, reasons: [], coverage: 0, days_with_data: 0, window_days: 0, amount_uncategorized: 0 },
    detectors_eligible: [],
    patterns_validated: 0,
    patterns_weakened: 0,
    opportunities_scheduled: 0,
    errors,
  };

  const configs = await loadDetectorConfigs(sb, { includeInactive: opts.includeInactiveDetectors });
  if (configs.size === 0) {
    result.skipped = "no_active_detectors";
    return result;
  }

  const context = await loadUserContext(sb, userId);
  if (!context.anticipationEnabled) {
    result.skipped = "anticipation_disabled_by_user";
    return result;
  }

  const [txResp, categoriesResp, cardsResp, statementsResp] = await Promise.all([
    sb.from("transactions").select(TX_FIELDS)
      .eq("user_id", userId).gte("occurred_at", isoDaysAgo(WINDOW_DAYS))
      .order("occurred_at", { ascending: true }).limit(8000),
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),
    sb.from("credit_cards").select("id,closing_day").eq("user_id", userId),
    sb.from("credit_card_statements").select("credit_card_id,competence_month,reconciled_total,stated_total,status,period_start,period_end")
      .eq("user_id", userId).order("competence_month", { ascending: true }).limit(60),
  ]);
  if (txResp.error) throw new Error(`transactions:${txResp.error.message}`);

  const txs = ((txResp.data as any[] | null) ?? []).map((t) => ({
    ...t,
    amount: Number(t.amount ?? 0),
  })) as AnticipationTxRow[];
  const categories = ((categoriesResp.data as any[] | null) ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }));
  const closingDays = new Map<string, number>(
    ((cardsResp.data as any[] | null) ?? []).map((c) => [String(c.id), Number(c.closing_day ?? 1)]),
  );

  const facts = buildTransactionFacts({
    userId,
    txs,
    categories,
    cardCycleOf: (row) => {
      const cardId = row.credit_card_id ? String(row.credit_card_id) : null;
      if (!cardId) return null;
      const closing = closingDays.get(cardId) ?? 1;
      const date = String(row.occurred_at).slice(0, 10);
      const day = Number(date.slice(8, 10));
      const cycleMonth = day > closing ? date.slice(0, 7) : date.slice(0, 7);
      return { cycleId: cardId, cycleDay: Math.max(1, ((day - closing + 30) % 30) + 1) };
    },
  });
  const days = aggregateDailyFacts(facts);
  const cycles = aggregateCycleFacts(days);
  result.transaction_facts = facts.length;
  result.daily_facts = days.length;
  result.cycle_facts = cycles.length;

  try {
    await chunkUpsert(sb, "behavioral_transaction_facts", facts as unknown as Record<string, unknown>[], "user_id,transaction_id,formula_version");
    await chunkUpsert(sb, "behavioral_daily_facts", days as unknown as Record<string, unknown>[], "user_id,local_date,formula_version");
    await chunkUpsert(sb, "behavioral_cycle_facts", cycles as unknown as Record<string, unknown>[], "user_id,cycle_kind,cycle_key,formula_version");
  } catch (error) {
    errors.push(`facts:${error instanceof Error ? error.message : String(error)}`);
  }

  const quality = assessDataQuality(days);
  result.quality = quality;
  const eligible = new Map<DetectorKey, DetectorConfig>();
  for (const [detector, config] of configs) {
    if (detectorEligible(quality, config)) eligible.set(detector, config);
  }
  result.detectors_eligible = [...eligible.keys()];
  if (eligible.size === 0) {
    result.skipped = `quality_gate:${quality.reasons.join("|") || "detectors_not_eligible"}`;
    return result;
  }

  // Ciclos de fatura fechados/abertos para o detector de aceleração.
  const cardCycles = ((statementsResp.data as any[] | null) ?? []).map((s) => {
    const start = String(s.period_start ?? "").slice(0, 10);
    const end = String(s.period_end ?? "").slice(0, 10);
    const closed = String(s.status ?? "") !== "open";
    const elapsedTo = closed && end ? Date.parse(end) : now.getTime();
    const daysElapsed = start ? Math.max(1, Math.round((elapsedTo - Date.parse(start)) / 86_400_000)) : 1;
    return {
      card_id: String(s.credit_card_id),
      cycle_key: String(s.competence_month ?? start).slice(0, 10),
      total: Math.abs(Number(s.reconciled_total ?? s.stated_total ?? 0)),
      days_elapsed: daysElapsed,
      closed,
    };
  });

  // Histórico recorrente por comerciante (mensal, sem transferências).
  const recurringHistory: Array<{ merchant: string; day_of_month: number; amount: number; month: string }> = [];
  for (const fact of facts) {
    if (!fact.is_consumption || fact.is_refund) continue;
    const merchant = fact.merchant_canonical ?? fact.merchant_normalized ?? normalizeMerchant(null);
    if (!merchant) continue;
    recurringHistory.push({
      merchant,
      day_of_month: Number(fact.local_date.slice(8, 10)),
      amount: fact.amount_net,
      month: fact.local_date.slice(0, 7),
    });
  }

  const fresh = discoverPatterns({
    userId,
    days,
    coverage: quality.coverage,
    configs: eligible,
    cardCycles,
    recurringHistory,
  });

  const { data: storedRows, error: storedError } = await sb.from("behavioral_patterns")
    .select("*").eq("user_id", userId).eq("formula_version", ANTICIPATION_FORMULA_VERSION);
  if (storedError) errors.push(`behavioral_patterns_read:${storedError.message}`);
  const stored = ((storedRows as any[] | null) ?? []) as Array<BehavioralPattern & { id: string }>;
  const freshByKey = new Map(fresh.map((p) => [`${p.detector}:${p.pattern_key}`, p]));

  const toPersist: Array<BehavioralPattern & { id?: string }> = [];
  for (const pattern of fresh) toPersist.push(pattern);
  for (const row of stored) {
    const key = `${row.detector}:${row.pattern_key}`;
    if (freshByKey.has(key)) continue;
    toPersist.push(reconcilePattern(row, null));
  }

  const nowIso = now.toISOString();
  const patternRows = toPersist.map((p) => ({
    user_id: p.user_id,
    detector: p.detector,
    pattern_key: p.pattern_key,
    label: p.label,
    status: p.status,
    sample_size: p.sample_size,
    window_start: p.window_start,
    window_end: p.window_end,
    baseline_value: p.baseline_value,
    pattern_value: p.pattern_value,
    uplift_pct: p.uplift_pct,
    absolute_delta: p.absolute_delta,
    hit_rate: p.hit_rate,
    consistency: p.consistency,
    confidence: p.confidence,
    data_coverage: p.data_coverage,
    evidence: p.evidence,
    exclusions: p.exclusions,
    formula_version: ANTICIPATION_FORMULA_VERSION,
    detector_version: p.detector_version,
    last_seen_at: nowIso,
    validated_at: p.status === "validated" || p.status === "active" ? nowIso : null,
  }));
  if (patternRows.length > 0) {
    try {
      await chunkUpsert(sb, "behavioral_patterns", patternRows, "user_id,detector,pattern_key,formula_version");
    } catch (error) {
      errors.push(`behavioral_patterns:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.patterns_validated = toPersist.filter((p) => p.status === "validated" || p.status === "active").length;
  result.patterns_weakened = toPersist.filter((p) => p.status === "weakened" || p.status === "expired").length;

  // IDs reais para vincular oportunidades ao padrão.
  const { data: persistedRows } = await sb.from("behavioral_patterns")
    .select("id,detector,pattern_key,status,confidence,baseline_value,pattern_value")
    .eq("user_id", userId).eq("formula_version", ANTICIPATION_FORMULA_VERSION);
  const idByKey = new Map<string, string>(
    ((persistedRows as any[] | null) ?? []).map((r) => [`${r.detector}:${r.pattern_key}`, String(r.id)]),
  );

  const monthlyReference = (() => {
    const byMonth = new Map<string, number>();
    for (const day of days) {
      const key = day.local_date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + day.total_consumption);
    }
    const values = [...byMonth.values()].filter((v) => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return 1000;
    return values[Math.floor(values.length / 2)];
  })();

  const { fatigue, receptivity } = await loadFatigue(sb, userId);
  const todayIso = now.toISOString().slice(0, 10);
  const candidates: AnticipationOpportunity[] = [];

  for (const pattern of fresh) {
    if (pattern.status !== "validated" && pattern.status !== "active") continue;
    const config = eligible.get(pattern.detector);
    if (!config) continue;
    const id = idByKey.get(`${pattern.detector}:${pattern.pattern_key}`);
    if (id && context.mutedPatternIds.includes(id)) continue;
    if (context.mutedKinds.includes(config.kind)) continue;

    const stalePolicy: StalePolicy = pattern.detector === "expected_recurring_payment"
      ? "recompute_before_send"
      : "convert_to_in_app";
    const opportunity = buildOpportunity({
      pattern: { ...pattern, id },
      config,
      todayIso,
      now,
      timezone: context.timezone,
      quietStart: context.quietStart,
      quietEnd: context.quietEnd,
      habitualHour: null,
      monthlyReference,
      fatigue,
      receptivity,
      stalePolicy,
      channelTarget: context.anticipationWhatsapp && !dryRun ? "both" : "app",
      dryRun,
    });
    if (!opportunity) continue;
    if (opportunity.utility_score < config.min_utility_score) continue;
    candidates.push(opportunity);
  }

  const orchestrated = orchestrateAttention(candidates, { maxAppOnly: 2 });
  const scheduled = [
    ...(orchestrated.primary ? [orchestrated.primary] : []),
    ...orchestrated.appOnly,
  ];
  const suppressed = orchestrated.deferred.map((o) => ({ ...o, status: "suppressed" as const }));

  const rows = [...scheduled, ...suppressed].map((o) => ({
    user_id: o.user_id,
    pattern_id: o.pattern_id,
    detector: o.detector,
    kind: o.kind,
    severity: o.severity,
    status: o.status,
    opportunity_date: o.opportunity_date,
    window_start: o.window_start,
    window_end: o.window_end,
    eligible_from: o.eligible_from,
    optimal_send_at: o.optimal_send_at,
    timezone: o.timezone,
    stale_policy: o.stale_policy,
    expected_value: o.expected_value,
    baseline_value: o.baseline_value,
    utility_score: o.utility_score,
    utility_breakdown: o.utility_breakdown,
    confidence: o.confidence,
    title: o.title,
    body: o.body,
    action: o.action,
    evidence: o.evidence,
    channel_target: o.channel_target,
    dry_run: o.dry_run,
    dedup_key: o.dedup_key,
    logical_dedup_key: o.logical_dedup_key,
    suppress_reason: o.status === "suppressed" ? "attention_budget" : null,
  }));

  for (const row of rows) {
    // Índice único é parcial (status vivo), então a checagem precede o insert.
    const { data: existing } = await sb.from("anticipation_opportunities")
      .select("id,status").eq("user_id", userId).eq("logical_dedup_key", row.logical_dedup_key)
      .in("status", ["scheduled", "revalidating", "ready", "dispatched"]).maybeSingle();
    if (existing) {
      if ((existing as any).status === "dispatched") continue;
      const { error } = await sb.from("anticipation_opportunities")
        .update({ ...row, updated_at: nowIso }).eq("id", (existing as any).id);
      if (error) errors.push(`opportunity_update:${error.message}`);
      continue;
    }
    const { error } = await sb.from("anticipation_opportunities").insert(row);
    if (error) errors.push(`opportunity_insert:${error.message}`);
  }
  result.opportunities_scheduled = scheduled.length;

  return result;
}

export type DispatchAnticipationResult = {
  evaluated: number;
  queued: number;
  expired: number;
  converted: number;
  simulated: number;
  errors: string[];
};

/**
 * Etapa 4: oportunidades maduras entram na fila proativa existente. Revalida o
 * padrão antes de falar e aplica a política de oportunidade vencida.
 */
export async function dispatchAnticipations(
  sb: SupabaseClient,
  opts: { userId?: string; now?: Date; limit?: number; dryRun?: boolean } = {},
): Promise<DispatchAnticipationResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const out: DispatchAnticipationResult = { evaluated: 0, queued: 0, expired: 0, converted: 0, simulated: 0, errors: [] };

  let query = sb.from("anticipation_opportunities")
    .select("*")
    .in("status", ["scheduled", "revalidating", "ready"])
    .lte("eligible_from", nowIso)
    .order("utility_score", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data, error } = await query;
  if (error) throw new Error(`anticipation_opportunities:${error.message}`);

  const configs = await loadDetectorConfigs(sb, { includeInactive: true });
  const rows = ((data as any[] | null) ?? []);
  out.evaluated = rows.length;

  for (const row of rows) {
    try {
      const config = configs.get(row.detector as DetectorKey);
      if (!config) continue;

      const { data: pattern } = await sb.from("behavioral_patterns")
        .select("status,confidence,baseline_value,pattern_value")
        .eq("id", row.pattern_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
      const valid = stillValid(row, (pattern as any) ?? null, config);

      const decision = decideStale({
        now,
        windowEnd: new Date(row.window_end),
        policy: row.stale_policy,
        channelTarget: row.channel_target,
        stillValid: valid,
      });

      if (decision.action === "expire") {
        await sb.from("anticipation_opportunities")
          .update({ status: "expired", suppress_reason: decision.reason, updated_at: nowIso }).eq("id", row.id);
        out.expired += 1;
        continue;
      }
      if (decision.action === "summary_later") {
        await sb.from("anticipation_opportunities")
          .update({ status: "revalidating", optimal_send_at: decision.summaryAt, updated_at: nowIso }).eq("id", row.id);
        continue;
      }
      if (decision.action === "recompute" && !valid) {
        await sb.from("anticipation_opportunities")
          .update({ status: "expired", suppress_reason: "pattern_no_longer_valid", updated_at: nowIso }).eq("id", row.id);
        out.expired += 1;
        continue;
      }
      if (row.optimal_send_at && new Date(row.optimal_send_at).getTime() > now.getTime()) continue;

      const channelTarget = decision.action === "convert_to_in_app" ? "app" : row.channel_target;
      if (decision.action === "convert_to_in_app") out.converted += 1;

      if (row.dry_run || opts.dryRun) {
        await sb.from("anticipation_opportunities")
          .update({ status: "suppressed", suppress_reason: "dry_run", updated_at: nowIso }).eq("id", row.id);
        out.simulated += 1;
        continue;
      }

      const { error: queueError } = await sb.from("pending_proactive_suggestions").upsert({
        user_id: row.user_id,
        kind: row.kind,
        severity: row.severity,
        title: row.title,
        body: row.body,
        action: row.action,
        evidence: { ...(row.evidence ?? {}), anticipation_opportunity_id: row.id, utility_score: row.utility_score },
        channel_ready: channelTarget === "both" ? "whatsapp" : "app",
        dedup_key: row.dedup_key,
        logical_dedup_key: row.logical_dedup_key,
        status: "pending",
        expires_at: row.window_end,
      }, { onConflict: "user_id,dedup_key" });
      if (queueError) throw new Error(`queue:${queueError.message}`);

      await sb.from("anticipation_opportunities")
        .update({ status: "dispatched", dispatched_at: nowIso, channel_target: channelTarget, updated_at: nowIso })
        .eq("id", row.id);
      out.queued += 1;
    } catch (error) {
      out.errors.push(`${row.id}:${error instanceof Error ? error.message : String(error)}`.slice(0, 180));
    }
  }

  return out;
}
