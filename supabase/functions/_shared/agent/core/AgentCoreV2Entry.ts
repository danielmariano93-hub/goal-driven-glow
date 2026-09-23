// AgentCoreV2Entry (`nino_v2_evidence_bridge.v1`)
//
// Thin production entry around AgentCoreV2. The V2 core historically persisted
// agent_runs only after the financial engine had executed, so the canonical
// tool call had no run_id at execution time and agent_tool_calls stayed empty.
// This bridge runs after the turn, binds the structured evidence already saved
// in ConversationMemory to that run, persists an auditable tool-call record and
// stamps the durable topic/reference with the same identifiers.
// deno-lint-ignore-file no-explicit-any

import { handleTurnV2 as handleTurnV2Core } from "./AgentCoreV2.ts";
import { handleTurn as handleLegacyTurn, type HandleTurnInput, type HandleTurnResult } from "./AgentCore.ts";
import { service } from "./service.ts";
import { getState, patchState } from "./StateManager.ts";
import { persistV2ToolCalls, type V2ToolCall } from "./V2EvidencePersistence.ts";
import type { ComparisonEvidence, ReferenceObject } from "./ConversationReferenceStore.ts";
import { resolveV2DeterministicHumanCapability } from "./V2DeterministicHumanGate.ts";

function evidenceResult(evidence: ComparisonEvidence, ref: ReferenceObject) {
  return {
    requested_comparison_direction: evidence.requested_direction,
    requested_limit: evidence.requested_limit,
    baseline_statistic: evidence.baseline_statistic,
    target_statistic: evidence.target_statistic,
    comparison_alignment: evidence.comparison_alignment,
    baseline_window_months: evidence.baseline_window_months,
    target_window_months: evidence.target_window_months,
    total_a: evidence.total_a,
    total_b: evidence.total_b,
    delta_abs: evidence.delta_abs,
    delta_pct: evidence.delta_pct,
    by_group: evidence.rows,
    applied_reference_scope: ref.target === "generic" || !ref.entity_labels.length
      ? null
      : { target: ref.target, entity_labels: ref.entity_labels },
    provenance: { formula_version: evidence.formula_version },
  };
}

function callFromReference(ref: ReferenceObject, fallbackTool: string): V2ToolCall | null {
  const evidence = ref.source?.context?.evidence ?? null;
  const toolName = String(ref.source?.tool_name ?? fallbackTool).split("+")[0] || fallbackTool;
  if (!evidence || evidence.kind !== "comparison") return null;
  const context = ref.source?.context ?? {};
  const categoryScope = ref.target === "category" && ref.entity_labels.length
    ? { category_scope: [...ref.entity_labels] }
    : {};
  const args = toolName === "compare_to_monthly_average"
    ? {
      months: context.months ?? evidence.baseline_window_months,
      target_period: context.target_period ?? null,
      group_by: "category",
      comparison_direction: evidence.requested_direction,
      limit: evidence.requested_limit,
      ...categoryScope,
    }
    : toolName === "compare_periods"
      ? {
        period_a: context.period_a ?? null,
        period_b: context.period_b ?? null,
        group_by: "category",
        comparison_direction: evidence.requested_direction,
        limit: evidence.requested_limit,
        ...categoryScope,
      }
      : { evidence_reconstructed: true };
  return {
    tool_name: toolName,
    args,
    result: evidenceResult(evidence, ref),
    ok: true,
    duration_ms: null,
    error: null,
  };
}

function formulaVersionsFromCalls(calls: V2ToolCall[]): Record<string, string> | null {
  const entries: Array<[string, string]> = [];
  for (const call of calls) {
    const version = String((call.result as any)?.provenance?.formula_version ?? "").trim();
    if (!version) continue;
    entries.push([call.tool_name, version]);
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

async function bindEvidence(input: HandleTurnInput, turn: HandleTurnResult): Promise<void> {
  if (!turn.run_id || !turn.session_id) return;
  const sb = service();

  // Idempotent across adapter retries/wrappers.
  const { data: existing } = await sb.from("agent_tool_calls")
    .select("id").eq("run_id", turn.run_id).limit(1);
  if ((existing ?? []).length) return;

  const { data: run } = await sb.from("agent_runs")
    .select("started_at,ended_at,tools_used,error_sanitized")
    .eq("id", turn.run_id).maybeSingle();
  const tools = Array.isArray((run as any)?.tools_used)
    ? (run as any).tools_used.map(String).filter(Boolean)
    : [];
  if (!tools.length) return;

  const state = await getState(sb as any, turn.session_id);
  const conversation = ((state as any)?.conversation ?? {}) as Record<string, any>;
  const references = Array.isArray(conversation.references)
    ? conversation.references as ReferenceObject[]
    : [];
  const started = Date.parse(String((run as any)?.started_at ?? ""));
  const ended = Date.parse(String((run as any)?.ended_at ?? ""));

  // Only bind references born in THIS run. Old production references without a
  // run_id remain usable for continuity but are never relabelled as new evidence.
  const candidates = references.filter((ref) => {
    if (ref.status !== "active" || ref.source?.run_id) return false;
    if (!ref.source?.context?.evidence) return false;
    const at = Date.parse(ref.created_at);
    if (!Number.isFinite(at) || !Number.isFinite(started)) return false;
    const withinStart = at >= started - 2_000;
    const withinEnd = !Number.isFinite(ended) || at <= ended + 2_000;
    const refTools = String(ref.source?.tool_name ?? "").split("+").filter(Boolean);
    return withinStart && withinEnd && refTools.some((tool) => tools.includes(tool));
  });

  const calls: V2ToolCall[] = [];
  const callRefs: ReferenceObject[] = [];
  for (const ref of candidates) {
    const call = callFromReference(ref, tools[0]);
    if (!call) continue;
    if (calls.some((existingCall) => existingCall.tool_name === call.tool_name)) continue;
    calls.push(call);
    callRefs.push(ref);
  }

  // For non-comparison V2 tools we still record that the engine ran, rather
  // than leaving the audit table empty. We deliberately do NOT fabricate a
  // result; richer evidence can be added by each capability over time.
  if (!calls.length) {
    for (const tool of tools) {
      calls.push({
        tool_name: tool,
        args: { evidence_unavailable_in_v2_bridge: true },
        result: null,
        ok: !(run as any)?.error_sanitized,
        duration_ms: null,
        error: (run as any)?.error_sanitized ?? null,
      });
    }
  }

  const toolCallIds = await persistV2ToolCalls(sb, turn.run_id, calls);
  if (!toolCallIds.length) return;

  const activeTopicId = String(conversation.active_topic_id ?? "").trim() || null;
  const formulaVersions = formulaVersionsFromCalls(calls);

  // Keep agent_runs self-contained for observability: the run now points to
  // the durable topic and to the exact analytical formula that generated its
  // evidence, instead of requiring a join through session state/tool calls.
  await sb.from("agent_runs").update({
    topic_id: activeTopicId,
    formula_versions: formulaVersions,
  }).eq("id", turn.run_id);

  const boundIds = new Set(callRefs.map((ref) => ref.id));
  const nextReferences = references.map((ref) => {
    if (!boundIds.has(ref.id)) return ref;
    return {
      ...ref,
      topic_id: activeTopicId,
      source: {
        ...ref.source,
        run_id: turn.run_id ?? null,
        tool_call_ids: toolCallIds,
      },
    };
  });

  if (boundIds.size) {
    await patchState(sb as any, turn.session_id, {
      conversation: { ...conversation, references: nextReferences },
    });
  }

  if (activeTopicId) {
    await sb.from("nino_topic_threads").update({
      evidence_reference: { run_id: turn.run_id, tool_call_ids: toolCallIds },
      execution_summary: { engines: tools, complete: !(run as any)?.error_sanitized },
    }).eq("id", activeTopicId).eq("user_id", input.user_id);
  }
}

export async function handleTurnV2(input: HandleTurnInput): Promise<HandleTurnResult> {
  // Explicit human-domain events with a dedicated deterministic tool should
  // never depend on the Conversation Brain contract. This is intentionally
  // narrow: the allowlist lives in V2DeterministicHumanGate and currently
  // restores only emotional check-ins already handled safely by the legacy core.
  if (resolveV2DeterministicHumanCapability(input.text)) {
    return await handleLegacyTurn(input);
  }

  const turn = await handleTurnV2Core(input);
  await bindEvidence(input, turn).catch((error) => {
    console.error("[AgentCoreV2Entry] evidence binding failed", String((error as Error)?.message ?? error).slice(0, 240));
  });
  return turn;
}
