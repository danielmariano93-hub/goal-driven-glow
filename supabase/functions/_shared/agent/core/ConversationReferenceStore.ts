// ConversationReferenceStore (`nino_reference_store.v1`)
//
// Structured working-memory references. "delas", "essa categoria" and similar
// expressions are grounded against objects captured from executed tool results,
// never against regex guesses over user text.
//
// References are short lived by design: max 5 turns and 30 minutes. When a
// required reference expires, the runtime asks the user instead of widening
// scope silently.

import type { TurnReference } from "./ConversationTurnContract.ts";

export const REFERENCE_TTL_MS = 30 * 60 * 1000;
export const REFERENCE_MAX_TURNS = 5;

export type ReferenceObjectType = "entity_set" | "entity";

export type ReferenceObject = {
  id: string;
  type: ReferenceObjectType;
  target: "category" | "merchant" | "card" | "account" | "goal" | "generic";
  entity_labels: string[];
  created_at: string;
  expires_at: string;
  turns_remaining: number;
  status: "active" | "invalidated" | "expired";
  source: {
    tool_name: string | null;
    query_id: string | null;
    /** Minimal execution contract required to continue the same comparison. */
    context?: {
      months?: number;
      target_period?: { from: string; to: string; label?: string | null };
      period_a?: { from: string; to: string; label?: string | null };
      period_b?: { from: string; to: string; label?: string | null };
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

function uniqueLabels(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
function displayedComparisonRows(result: Record<string, unknown>): unknown[] {
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

  // analyze_spending renders only `top`; `categories` is the full internal
  // breakdown and must not leak into a later "delas" reference.
  if (tool === "analyze_spending") {
    if (r.view === "total") return [];
    return labelsFromRows(Array.isArray(r.top) ? r.top : []);
  }

  // Other deterministic formatters render one primary collection. Use the
  // first available collection instead of unioning hidden supporting rows.
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
  if (tool === "compare_to_monthly_average") {
    const months = Number(value.months);
    const target = period(value.target_period);
    if (!Number.isInteger(months) || months < 2 || months > 24 || !target) return null;
    return { months, target_period: target };
  }
  if (tool === "compare_periods") {
    const periodA = period(value.period_a);
    const periodB = period(value.period_b);
    if (!periodA || !periodB) return null;
    return { period_a: periodA, period_b: periodB };
  }
  return null;
}

export function captureReferenceObjects(
  toolCalls: Array<{ tool_name?: string; args?: any; result?: any; ok?: boolean }> | null | undefined,
  now: Date = new Date(),
): ReferenceObject[] {
  // One assistant answer can be backed by multiple executions (e.g. July and
  // August). An anaphora in the next turn refers to the DISPLAYED SET of that
  // answer, so merge labels by target instead of storing one set per tool call.
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
    if (labels.length < 2) continue;
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
    if (group.labels.length < 2) continue;
    const created = nowIso(now);
    refs.push({
      id: crypto.randomUUID(),
      type: "entity_set",
      target,
      entity_labels: group.labels,
      created_at: created,
      expires_at: new Date(now.getTime() + REFERENCE_TTL_MS).toISOString(),
      turns_remaining: REFERENCE_MAX_TURNS,
      status: "active",
      source: {
        tool_name: [...new Set(group.tools)].join("+") || null,
        query_id: [...new Set(group.queryIds)].join("+") || null,
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
    const nextTurns = Math.max(0, Number(ref.turns_remaining ?? 0) - 1);
    const status: ReferenceObject["status"] =
      expiredByTime || nextTurns <= 0 ? "expired" : "active";
    return {
      ...ref,
      turns_remaining: nextTurns,
      status,
    };
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
      && ref.turns_remaining > 0
      && (requested.target === "generic" || ref.target === requested.target)
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  if (!active.length) {
    return { status: "missing", reference_id: null, target: requested.target, entity_labels: [], reason: "reference_expired_or_missing" };
  }

  const chosen = active[0];
  return {
    status: "resolved",
    reference_id: chosen.id,
    target: chosen.target,
    entity_labels: requested.kind === "previous_entity" ? chosen.entity_labels.slice(0, 1) : chosen.entity_labels,
    reason: "reference_store",
  };
}
