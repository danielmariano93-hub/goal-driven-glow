// diagnosis_to_communication.v1 — o diagnóstico canônico passa a ser a única
// fonte de conteúdo financeiro da comunicação proativa. Nada de números novos:
// título, texto, impacto, confiança e ação vêm do item de inteligência.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isAppTaskKind } from "./insightValue.ts";
import { computeAgentSnapshot } from "../engine/metrics.ts";
import { communicationTopicKey } from "./logicalDedup.ts";

export type DiagnosisCandidate = {
  user_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  action: Record<string, unknown>;
  evidence: Record<string, unknown>;
  channel_ready: "app" | "whatsapp" | "both";
  dedup_key: string;
  expires_at: string | null;
};

type ItemRow = {
  id: string;
  kind: string;
  severity: string | null;
  title: string;
  summary: string | null;
  explanation: string | null;
  facts: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  primary_action: Record<string, unknown> | null;
  confidence: number | null;
  impact_amount: number | null;
  logical_topic_key: string | null;
  dedup_key: string;
  valid_until: string | null;
  source_period_start: string | null;
  source_period_end: string | null;
};

/** `situation:cash_flow:2026-08` -> `cash_flow`; `situation:future:debt:x` -> `future:debt`. */
export function situationTypeFromTopic(topicKey: string | null | undefined): string {
  const parts = String(topicKey ?? "").split(":");
  if (parts[0] !== "situation") return parts[0] ?? "";
  if (parts[1] === "future") return `future:${parts[2] ?? ""}`;
  return parts[1] ?? "";
}

/** Tipo de situação -> tipo de comunicação do catálogo. */
export function communicationKindFor(situationType: string, itemKind: string): string {
  const map: Record<string, string> = {
    debt_overdue: "debt_overdue",
    debt_due_soon: "debt_due_soon",
    debt_progress: "debt_progress",
    "future:debt": "debt_due_soon",
    "future:bill": "card_bill_pressure",
    "future:installment": "card_bill_pressure",
    "future:recurring": "recurring_commitment_pressure",
    "future:goal": "goal_feasibility",
    card_pressure: "card_bill_pressure",
    cash_flow: "cash_flow_imbalance",
    investment_drawdown: "investment_drawdown",
    goal_feasibility: "goal_feasibility",
    category_shift: "growing_category",
    spending_pace: "spending_pace_change",
    commitment_pressure: "recurring_commitment_pressure",
    behavioral_pattern: "recurring_pattern",
    uncategorized: "categorize_transaction",
    duplicate_review: "duplicate_expense",
    anticipation: "upcoming_cash_pressure",
    split_pending: "split_payment_pending",
  };
  if (map[situationType]) return map[situationType];
  if (itemKind === "achievement") return "goal_progress";
  if (itemKind === "data_quality") return "categorize_transaction";
  return "cash_flow_imbalance";
}

function firstDate(sources: Array<Record<string, unknown> | null | undefined>): string | null {
  const keys = ["opportunity_date", "event_date", "due_date", "next_due_date", "reference_date"];
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    }
  }
  return null;
}

export function daysUntil(dateIso: string | null, now = new Date()): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T12:00:00Z`).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.round((target - now.getTime()) / 86400000);
}

export function toCandidate(userId: string, item: ItemRow, now = new Date()): DiagnosisCandidate {
  const situationType = situationTypeFromTopic(item.logical_topic_key);
  const kind = communicationKindFor(situationType, item.kind);
  const eventDate = firstDate([item.facts, item.evidence]);
  const body = [item.summary, item.explanation].filter(Boolean).join(" ").trim() || item.title;
  const route = `/app/alertas/${encodeURIComponent(item.dedup_key)}`;
  return {
    user_id: userId,
    kind,
    severity: String(item.severity ?? "info"),
    title: item.title,
    body,
    action: { ...(item.primary_action ?? {}), route },
    evidence: {
      ...(item.evidence ?? {}),
      source: "financial_diagnosis",
      situation_type: situationType,
      item_id: item.id,
      impact_amount: Number(item.impact_amount ?? 0),
      confidence: Number(item.confidence ?? 0.7),
      event_date: eventDate,
      days_until_event: daysUntil(eventDate, now),
      period_start: item.source_period_start,
      period_end: item.source_period_end,
      logical_topic_key: item.logical_topic_key,
    },
    channel_ready: isAppTaskKind(kind) ? "app" : "both",
    dedup_key: item.dedup_key,
    expires_at: item.valid_until,
  };
}

/**
 * Coerência: um assunto lógico produz no máximo um candidato — o de maior
 * impacto financeiro. Evita duas leituras do mesmo tema disputando cota.
 */
export function consolidateByTopic(items: ItemRow[]): ItemRow[] {
  const best = new Map<string, ItemRow>();
  for (const item of items) {
    const key = item.logical_topic_key ?? item.dedup_key;
    const current = best.get(key);
    if (!current || Number(item.impact_amount ?? 0) > Number(current.impact_amount ?? 0)) best.set(key, item);
  }
  return [...best.values()];
}

const COLUMNS =
  "id,kind,severity,title,summary,explanation,facts,evidence,primary_action,confidence,impact_amount,logical_topic_key,dedup_key,valid_until,source_period_start,source_period_end";

/** Lê o diagnóstico ativo e devolve candidatos de comunicação já consolidados. */
export async function diagnosisCandidates(
  sb: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<DiagnosisCandidate[]> {
  const { data, error } = await sb.from("nino_intelligence_items")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("dismissed_at", null)
    .order("priority", { ascending: false })
    .limit(40);
  if (error) throw new Error(`nino_intelligence_items:${error.message}`);
  const rows = ((data as ItemRow[] | null) ?? []).filter((row) => {
    if (row.valid_until && new Date(row.valid_until) <= now) return false;
    // Metas por categoria são produzidas exclusivamente pelo snapshot abaixo.
    return String(row.evidence?.goal_kind ?? "") !== "category_spending";
  });
  const snapshot = await computeAgentSnapshot(sb, userId);
  const categoryGoals: DiagnosisCandidate[] = snapshot.active_category_goals
    .filter((goal) => ["exceeded", "at_risk", "attention", "limit_reached"].includes(goal.status))
    .map((goal) => {
      const exceeded = goal.current_overage > 0;
      const topic = `category_goal:${userId}:${goal.goal_id}:${goal.period_start}`;
      const impact = exceeded ? goal.current_overage : goal.projected_overage;
      const title = exceeded
        ? `Você passou o teto de ${goal.category_name ?? "categoria"} em R$ ${impact.toFixed(2).replace(".", ",")}`
        : `${goal.category_name ?? "A categoria"} pode passar do teto em R$ ${impact.toFixed(2).replace(".", ",")}`;
      return {
        user_id: userId,
        kind: "goal_feasibility",
        severity: exceeded ? "critical" : "attention",
        title,
        body: goal.message,
        action: { type: "review_goal", route: `/app/metas/categoria/${goal.goal_id}` },
        evidence: {
          source: "financial_snapshot_contract.v8",
          goal_kind: "category_spending",
          goal_id: goal.goal_id,
          category_id: goal.category_id,
          category_name: goal.category_name,
          period_start: goal.period_start,
          period_end: goal.period_end,
          limit: goal.target_amount,
          spent: goal.actual_spend,
          projected: goal.projected_final_spend,
          overage: goal.current_overage,
          projected_overage: goal.projected_overage,
          status: goal.status,
          as_of: goal.calculation_reference_date,
          included_transaction_count: goal.included_transaction_count,
          projection_method: goal.projection_method,
          reconciliation_id: snapshot.reconciliation_id,
          formula_version: snapshot.formula_version,
          logical_topic_key: topic,
          impact_amount: impact,
          confidence: goal.elapsed_days >= 14 ? 0.9 : goal.elapsed_days >= 7 ? 0.8 : 0.7,
        },
        channel_ready: "both" as const,
        dedup_key: topic,
        expires_at: `${goal.period_end}T23:59:59.999Z`,
      };
    });
  const candidates = [...consolidateByTopic(rows).map((row) => toCandidate(userId, row, now)), ...categoryGoals];
  const best = new Map<string, DiagnosisCandidate>();
  for (const candidate of candidates) {
    const key = communicationTopicKey({
      userId,
      kind: candidate.kind,
      dedupKey: candidate.dedup_key,
      evidence: candidate.evidence,
    });
    best.set(key, candidate);
  }
  return [...best.values()];
}

/** Materializa os candidatos do diagnóstico na fila de sugestões proativas. */
export async function syncDiagnosisSuggestions(
  sb: SupabaseClient,
  userId: string,
  opts: { persist?: boolean; now?: Date } = {},
): Promise<DiagnosisCandidate[]> {
  const now = opts.now ?? new Date();
  const candidates = await diagnosisCandidates(sb, userId, now);
  if (opts.persist === false || candidates.length === 0) return candidates;
  const { error } = await sb.from("pending_proactive_suggestions")
    .upsert(candidates, { onConflict: "user_id,dedup_key", ignoreDuplicates: false });
  if (error) throw new Error(`pending_proactive_suggestions_upsert:${error.message}`);
  return candidates;
}
