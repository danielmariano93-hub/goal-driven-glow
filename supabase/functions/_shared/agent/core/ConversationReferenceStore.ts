// ConversationReferenceStore (`nino_reference_store.v2`)
//
// Structured working-memory references. "delas", "essa categoria" and similar
// expressions are grounded against objects captured from executed tool results,
// never against regex guesses over user text.
//
// References expire by time, not by arbitrary message count. A reference is also
// bound to the durable topic that produced it when that topic is known, so an old
// discussion cannot silently hijack a current follow-up.

import type { TurnReference } from "./ConversationTurnContract.ts";

export const REFERENCE_TTL_MS = 30 * 60 * 1000;
// Kept for backwards-compatible state shape. v2 no longer decrements this on
// every message; TTL + topic binding are the authority for freshness.
export const REFERENCE_MAX_TURNS = 24;

export type ReferenceObjectType = "entity_set" | "entity";

export type ComparisonEvidenceRow = {
  name: string;
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
};

export type ComparisonEvidence = {
  kind: "comparison";
  formula_version: string | null;
  requested_direction: "increase" | "decrease" | "both" | "any";
  requested_limit: number | null;
  baseline_statistic: string | null;
  target_statistic: string | null;
  comparison_alignment: string | null;
  baseline_window_months: number | null;
  target_window_months: number | null;
  total_a: number | null;
  total_b: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  rows: ComparisonEvidenceRow[];
};

export type ReferenceObject = {
  id: string;
  type: ReferenceObjectType;
  target: "category" | "merchant" | "card" | "account" | "goal" | "generic";
  entity_labels: string[];
  topic_id?: string | null;
  created_at: string;
  expires_at: string;
  turns_remaining: number;
  status: "active" | "invalidated" | "expired";
  source: {
    tool_name: string | null;
    query_id: string | null;
    run_id?: string | null;
    tool_call_ids?: string[];
    context?: {
      months?: number;
      target_period?: { from: string; to: string; label?: string | null };
      period_a?: { from: string; to: string; label?: string | null };
      period_b?: { from: string; to: string; label?: string | null };
      evidence?: ComparisonEvidence | null;
    } | null;
  };
};

export type GroundedReference = {
  status: "resolved" | "missing" | "ambiguous";
  reference_id: string | null;
  target: ReferenceObject["target"] | null;
  entity_labels: string[];
  reason: string;
};

function nowIso(now: Date): string {
  return now.toISOString();
}

function normalized(value: string): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function uniqueLabels(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = normalized(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(0, 20);
}

function labelsFromRows(rows: unknown[]): string[] {
  const candidates: unknown[] = [];
  for (const row of rows) {
    if (typeof row === "string") candidates.push(row);
    else if (row && typeof row === "object") {
      const obj = row as Record<string, unknown>;
      candidates.push(obj.name ?? obj.label ?? obj.category ?? obj.merchant ?? obj.title);
    }
  }
  return uniqueLabels(candidates);
}

function positiveLimit(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Mirrors the deterministic comparison formatter so the stored referent is
 * the set the user actually saw, not every row the engine computed. */
function displayedComparisonRows(result: Record<string, unknown>): any[] {
  const rows = Array.isArray(result.by_group) ? [...result.by_group] as any[] : [];
  const direction = ["increase", "decrease", "both", "any"].includes(
    String(result.requested_comparison_direction ?? "any"),
  )
    ? String(result.requested_comparison_direction ?? "any")
    : "any";
  const limit = positiveLimit(result.requested_limit);
  const take = (items: any[]) => limit ? items.slice(0, limit) : items;
  const increases = rows
    .filter((row) => Number(row?.delta_abs ?? 0) > 0.005)
    .sort((a, b) => Number(b?.delta_abs ?? 0) - Number(a?.delta_abs ?? 0));
  const decreases = rows
    .filter((row) => Number(row?.delta_abs ?? 0) < -0.005)
    .sort((a, b) => Number(a?.delta_abs ?? 0) - Number(b?.delta_abs ?? 0));

  if (direction === "increase") return take(increases);
  if (direction === "decrease") return take(decreases);
  if (direction === "both") return [...take(increases), ...take(decreases)];
  return take(rows
    .filter((row) => Math.abs(Number(row?.delta_abs ?? 0)) > 0.005)
    .sort((a, b) => Math.abs(Number(b?.delta_abs ?? 0)) - Math.abs(Number(a?.delta_abs ?? 0))));
}

function labelsFromResult(toolName: string, result: unknown): string[] {
  const r = (result ?? {}) as Record<string, unknown>;
  const tool = String(toolName ?? "").toLowerCase();

  if (tool === "compare_periods" || tool === "compare_to_monthly_average") {
    return labelsFromRows(displayedComparisonRows(r));
  }
  if (tool === "analyze_spending") {
    if (r.view === "total") return [];
    return labelsFromRows(Array.isArray(r.top) ? r.top : []);
  }
  for (const key of ["top", "by_group", "items", "rows", "merchants", "categories"]) {
    const rows = Array.isArray(r[key]) ? r[key] as unknown[] : [];
    if (rows.length) return labelsFromRows(rows);
  }
  return [];
}

function targetFromCall(call: any): ReferenceObject["target"] | null {
  const group = String(
    call?.args?.group_by
      ?? call?.result?.requested_group_by
      ?? call?.result?.group_by
      ?? "",
  ).toLowerCase();
  if (group === "category") return "category";
  if (group === "merchant") return "merchant";
  if (group === "card") return "card";
  if (group === "account") return "account";

  const tool = String(call?.tool_name ?? "").toLowerCase();
  if (tool.includes("merchant")) return "merchant";
  if (tool.includes("categor")) return "category";
  return null;
}

function comparisonEvidenceFromCall(call: unknown): ComparisonEvidence | null {
  const record = (call ?? {}) as Record<string, unknown>;
  const tool = String(record.tool_name ?? "").toLowerCase();
  if (tool !== "compare_to_monthly_average" && tool !== "compare_periods") return null;
  const result = (record.result ?? {}) as Record<string, unknown>;
  const rows = displayedComparisonRows(result).map((raw) => ({
    name: String(raw?.name ?? "").trim(),
    total_a: Number(raw?.total_a ?? 0),
    total_b: Number(raw?.total_b ?? 0),
    delta_abs: Number(raw?.delta_abs ?? 0),
    delta_pct: raw?.delta_pct == null ? null : Number(raw.delta_pct),
  })).filter((row) => row.name);
  const directionRaw = String(result.requested_comparison_direction ?? "any");
  const requested_direction = ["increase", "decrease", "both", "any"].includes(directionRaw)
    ? directionRaw as ComparisonEvidence["requested_direction"]
    : "any";
  const provenance = (result.provenance ?? {}) as Record<string, unknown>;
  const finiteOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    kind: "comparison",
    formula_version: String(provenance.formula_version ?? result.formula_version ?? "").trim() || null,
    requested_direction,
    requested_limit: positiveLimit(result.requested_limit),
    baseline_statistic: String(result.baseline_statistic ?? "").trim() || null,
    target_statistic: String(result.target_statistic ?? "").trim() || null,
    comparison_alignment: String(result.comparison_alignment ?? "").trim() || null,
    baseline_window_months: finiteOrNull(result.baseline_window_months),
    target_window_months: finiteOrNull(result.target_window_months),
    total_a: finiteOrNull(result.total_a),
    total_b: finiteOrNull(result.total_b),
    delta_abs: finiteOrNull(result.delta_abs),
    delta_pct: finiteOrNull(result.delta_pct),
    rows,
  };
}

function comparisonContextFromCall(call: unknown): NonNullable<ReferenceObject["source"]["context"]> | null {
  const record = (call ?? {}) as Record<string, unknown>;
  const tool = String(record.tool_name ?? "").toLowerCase();
  const value = (record.args ?? {}) as Record<string, unknown>;
  const period = (raw: unknown) => {
    const candidate = (raw ?? {}) as Record<string, unknown>;
    return candidate.from && candidate.to
      ? {
        from: String(candidate.from),
        to: String(candidate.to),
        ...(candidate.label ? { label: String(candidate.label) } : {}),
      }
      : undefined;
  };
  const evidence = comparisonEvidenceFromCall(call);
  if (tool === "compare_to_monthly_average") {
    const months = Number(value.months);
    const target = period(value.target_period);
    if (!Number.isInteger(months) || months < 2 || months > 24 || !target) return null;
    return { months, target_period: target, evidence };
  }
  if (tool === "compare_periods") {
    const periodA = period(value.period_a);
    const periodB = period(value.period_b);
    if (!periodA || !periodB) return null;
    return { period_a: periodA, period_b: periodB, evidence };
  }
  return null;
}

export type CaptureReferenceOptions = {
  topic_id?: string | null;
  run_id?: string | null;
  tool_call_ids?: string[];
};

export function captureReferenceObjects(
  toolCalls: Array<{ tool_name?: string; args?: any; result?: any; ok?: boolean }> | null | undefined,
  now: Date = new Date(),
  options: CaptureReferenceOptions = {},
): ReferenceObject[] {
  const grouped = new Map<ReferenceObject["target"], {
    labels: string[];
    tools: string[];
    queryIds: string[];
    contexts: NonNullable<ReferenceObject["source"]["context"]>[];
  }>();

  for (const call of toolCalls ?? []) {
    if (call?.ok === false) continue;
    const target = targetFromCall(call);
    if (!target) continue;
    const labels = labelsFromResult(String(call.tool_name ?? ""), call.result);
    if (!labels.length) continue;
    const current = grouped.get(target) ?? { labels: [], tools: [], queryIds: [], contexts: [] };
    current.labels = uniqueLabels([...current.labels, ...labels]);
    if (call.tool_name) current.tools.push(String(call.tool_name));
    if (call?.args?.query_id) current.queryIds.push(String(call.args.query_id));
    const context = comparisonContextFromCall(call);
    if (context) current.contexts.push(context);
    grouped.set(target, current);
  }

  const refs: ReferenceObject[] = [];
  for (const [target, group] of grouped.entries()) {
    if (!group.labels.length) continue;
    const created = nowIso(now);
    refs.push({
      id: crypto.randomUUID(),
      type: group.labels.length === 1 ? "entity" : "entity_set",
      target,
      entity_labels: group.labels,
      topic_id: options.topic_id ?? null,
      created_at: created,
      expires_at: new Date(now.getTime() + REFERENCE_TTL_MS).toISOString(),
      turns_remaining: REFERENCE_MAX_TURNS,
      status: "active",
      source: {
        tool_name: [...new Set(group.tools)].join("+") || null,
        query_id: [...new Set(group.queryIds)].join("+") || null,
        run_id: options.run_id ?? null,
        tool_call_ids: [...new Set(options.tool_call_ids ?? [])],
        context: group.contexts[group.contexts.length - 1] ?? null,
      },
    });
  }
  return refs.slice(-4);
}

export function advanceReferences(
  refs: ReferenceObject[] | null | undefined,
  now: Date = new Date(),
): ReferenceObject[] {
  const ts = now.getTime();
  return (refs ?? []).map((ref) => {
    if (ref.status !== "active") return ref;
    const expiredByTime = Date.parse(ref.expires_at) <= ts;
    return expiredByTime
      ? { ...ref, status: "expired" as const, turns_remaining: 0 }
      : { ...ref, turns_remaining: Math.max(1, Number(ref.turns_remaining ?? REFERENCE_MAX_TURNS)) };
  }).slice(-8);
}

export function invalidateReferences(
  refs: ReferenceObject[] | null | undefined,
  target?: ReferenceObject["target"] | null,
): ReferenceObject[] {
  return (refs ?? []).map((ref) =>
    ref.status === "active" && (!target || ref.target === target)
      ? { ...ref, status: "invalidated" as const }
      : ref
  );
}

export function resolveStructuredReference(
  requested: TurnReference | null | undefined,
  refs: ReferenceObject[] | null | undefined,
  now: Date = new Date(),
  options: { topic_id?: string | null; preferred_entity?: string | null } = {},
): GroundedReference {
  if (!requested || requested.kind === "none") {
    return { status: "resolved", reference_id: null, target: null, entity_labels: [], reason: "no_reference" };
  }

  if (requested.kind !== "previous_result_set" && requested.kind !== "previous_entity") {
    return { status: "missing", reference_id: null, target: requested.target, entity_labels: [], reason: "reference_kind_not_store_backed" };
  }

  const active = (refs ?? [])
    .filter((ref) =>
      ref.status === "active"
      && Date.parse(ref.expires_at) > now.getTime()
      && (requested.target === "generic" || ref.target === requested.target)
      && (!options.topic_id || !ref.topic_id || ref.topic_id === options.topic_id)
    )
    .sort((a, b) => {
      if (requested.kind === "previous_entity" && a.type !== b.type) return a.type === "entity" ? -1 : 1;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

  if (!active.length) {
    return { status: "missing", reference_id: null, target: requested.target, entity_labels: [], reason: "reference_expired_or_missing" };
  }

  const chosen = active[0];
  if (requested.kind === "previous_entity") {
    const preferred = normalized(options.preferred_entity ?? "");
    const selected = preferred
      ? chosen.entity_labels.find((label) => normalized(label) === preferred) ?? null
      : null;
    return {
      status: "resolved",
      reference_id: chosen.id,
      target: chosen.target,
      entity_labels: selected ? [selected] : chosen.entity_labels.slice(0, 1),
      reason: selected ? "reference_store_preferred_entity" : "reference_store",
    };
  }

  return {
    status: "resolved",
    reference_id: chosen.id,
    target: chosen.target,
    entity_labels: chosen.entity_labels,
    reason: "reference_store",
  };
}
