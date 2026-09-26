// AgentCoreV2Entry (`nino_v2_evidence_bridge.v2`)
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
import type { ComparisonEvidence, MonthlySeriesEvidence, ReferenceObject } from "./ConversationReferenceStore.ts";
import { resolveV2DeterministicHumanCapability } from "./V2DeterministicHumanGate.ts";
import { isEnabled } from "./FeatureFlags.ts";
import { resolveTimeAspectPt } from "../../analytics/periodResolver.ts";
import { ensureRequestedArtifact } from "../../intelligence/chartFallback.ts";
import { hasExplicitChartIntent } from "../../intelligence/chartIntent.ts";
import {
  captureRuntimeV3ShadowSnapshot,
  scheduleRuntimeV3ProductionShadow,
} from "../v3/RuntimeV3ProductionShadow.ts";

function comparisonEvidenceResult(evidence: ComparisonEvidence, ref: ReferenceObject) {
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

function monthlySeriesEvidenceResult(evidence: MonthlySeriesEvidence) {
  return {
    version: evidence.version,
    formula_version: evidence.formula_version,
    months: evidence.months,
    total: evidence.total,
    transaction_count: evidence.transaction_count,
    window: evidence.window,
    scope: evidence.scope,
    partial_first_month: evidence.partial_first_month,
    partial_last_month: evidence.partial_last_month,
  };
}

/**
 * Reconstructs only evidence that was already executed and stored in working
 * memory. No money is recalculated here. Exported so the Phase 2 contract suite
 * can prove that persisted V2 evidence is lossless.
 */
export function v2CallFromReference(ref: ReferenceObject, fallbackTool: string): V2ToolCall | null {
  const evidence = ref.source?.context?.evidence ?? null;
  const toolName = String(ref.source?.tool_name ?? fallbackTool).split("+")[0] || fallbackTool;
  if (!evidence) return null;

  if (evidence.kind === "monthly_series") {
    return {
      tool_name: "spending_timeseries_monthly",
      args: {
        query_id: ref.source?.query_id ?? null,
        evidence_reconstructed: true,
        from: evidence.window.from,
        to: evidence.window.to,
        category_name: evidence.scope.category,
        merchant: evidence.scope.merchant,
      },
      result: monthlySeriesEvidenceResult(evidence),
      ok: true,
      duration_ms: null,
      error: null,
    };
  }

  if (evidence.kind !== "comparison") return null;
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
    result: comparisonEvidenceResult(evidence, ref),
    ok: true,
    duration_ms: null,
    error: null,
  };
}

function formulaVersionsFromCalls(calls: V2ToolCall[]): Record<string, string> | null {
  const entries: Array<[string, string]> = [];
  for (const call of calls) {
    const result = (call.result ?? {}) as any;
    const version = String(result?.formula_version ?? result?.provenance?.formula_version ?? "").trim();
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
    const call = v2CallFromReference(ref, tools[0]);
    if (!call) continue;
    if (calls.some((existingCall) => existingCall.tool_name === call.tool_name)) continue;
    calls.push(call);
    callRefs.push(ref);
  }

  // Capabilities that still do not expose structured working-memory evidence
  // retain an explicit placeholder. Monthly series and comparisons no longer
  // use this path: their exact executed result is persisted above.
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

async function bindRequestedArtifact(input: HandleTurnInput, turn: HandleTurnResult): Promise<void> {
  if (!turn.run_id || !hasExplicitChartIntent(input.text)) return;
  const sb = service();
  const { data } = await sb.from("agent_tool_calls")
    .select("step_index,tool_name,args,result,ok,duration_ms,error")
    .eq("run_id", turn.run_id)
    .order("step_index", { ascending: true });
  const calls = ((data ?? []) as any[]).map((call) => ({
    step_index: Number(call.step_index ?? 0),
    tool_name: String(call.tool_name ?? ""),
    args: call.args ?? {},
    result: call.result ?? null,
    ok: call.ok === true,
    duration_ms: Number(call.duration_ms ?? 0),
    error: call.error ? String(call.error) : null,
  }));

  const artifact = await ensureRequestedArtifact({
    sb: sb as any,
    user_id: input.user_id,
    conversation_id: input.conversation_id,
    text: input.text,
    toolCalls: calls,
  });
  if (!artifact) return;

  await persistV2ToolCalls(sb, turn.run_id, [{
    ...artifact.toolCall,
    step_index: calls.length,
  }]).catch(() => []);

  if (artifact.artifact_id && input.channel !== "app" && input.inbound_message_id) {
    await sb.from("outbound_messages").update({
      artifact_id: artifact.artifact_id,
      media_status: "pending",
    }).eq("inbound_message_id", input.inbound_message_id);
  }
}

/**
 * The v3 temporal overlay can legitimately replace the preliminary rolling
 * period stored in IR v2 (for example 26/04..26/09 -> 01/04..26/09, or a
 * habitual read -> six complete calendar months). AgentCoreV2 historically
 * persisted the pre-overlay period after the answer, poisoning elliptical
 * follow-ups even though the displayed numbers were correct.
 *
 * Repair the durable conversation/topic period only after a successful monthly
 * engine. The deterministic pt-BR time resolver is the same authority used by
 * the execution overlay, so memory now mirrors what actually ran.
 */
async function bindExecutedMonthlyPeriod(input: HandleTurnInput, turn: HandleTurnResult): Promise<void> {
  if (!turn.run_id || !turn.session_id) return;
  const sb = service();
  const { data: run } = await sb.from("agent_runs")
    .select("tools_used,error_sanitized")
    .eq("id", turn.run_id).maybeSingle();
  if ((run as any)?.error_sanitized) return;
  const tools: string[] = Array.isArray((run as any)?.tools_used)
    ? (run as any).tools_used.map(String).filter(Boolean)
    : [];
  if (!tools.some((tool: string) => tool === "spending_timeseries_monthly" || tool === "typical_monthly_expense")) return;

  const aspect = resolveTimeAspectPt(input.text, new Date());
  if (!aspect.from || !aspect.to || !["trend", "habitual", "last_n_complete"].includes(String(aspect.aspect))) return;
  const executedPeriod = {
    from: aspect.from,
    to: aspect.to,
    label: aspect.label ?? null,
  };

  const state = await getState(sb as any, turn.session_id);
  const conversation = ((state as any)?.conversation ?? {}) as Record<string, any>;
  const semanticState = ((state as any)?.semantic_topic_state ?? {}) as Record<string, any>;
  const activeSemanticTopicId = String(semanticState.active_topic_id ?? "").trim() || null;
  const semanticTopics = Array.isArray(semanticState.topics) ? semanticState.topics : [];
  const nextSemanticTopics = semanticTopics.map((topic: any) => {
    if (!activeSemanticTopicId || String(topic?.topic_id ?? "") !== activeSemanticTopicId) return topic;
    return {
      ...topic,
      period: { from: aspect.from, to: aspect.to },
      ir: topic?.ir
        ? {
          ...topic.ir,
          period: {
            ...(topic.ir.period ?? {}),
            from: aspect.from,
            to: aspect.to,
            label: aspect.label ?? topic.ir?.period?.label ?? "período executado",
          },
        }
        : topic?.ir,
    };
  });

  await patchState(sb as any, turn.session_id, {
    conversation: { ...conversation, active_period: executedPeriod },
    ...(semanticTopics.length
      ? { semantic_topic_state: { ...semanticState, topics: nextSemanticTopics } }
      : {}),
  });

  const durableTopicId = String(conversation.active_topic_id ?? "").trim() || null;
  if (durableTopicId) {
    await sb.from("nino_topic_threads").update({
      period_from: aspect.from,
      period_to: aspect.to,
    }).eq("id", durableTopicId).eq("user_id", input.user_id);
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

  // Shadow snapshot is captured before the official turn can mutate memory.
  // It is gated per-user and never changes the official response or financial state.
  const authorityEnabled = await isEnabled("runtime_v3_authority_v1", input.user_id).catch(() => false);
  const shadowEnabled = !authorityEnabled
    && await isEnabled("runtime_v3_shadow", input.user_id).catch(() => false);
  const shadowSb = shadowEnabled ? service() : null;
  const shadowSnapshot = shadowSb
    ? await captureRuntimeV3ShadowSnapshot(shadowSb, {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      inbound_message_id: input.inbound_message_id ?? null,
      channel: input.channel,
      text: input.text,
    }).catch((error) => {
      console.warn("[AgentCoreV2Entry] V3 shadow snapshot failed", String((error as Error)?.message ?? error).slice(0, 220));
      return null;
    })
    : null;

  const turn = await handleTurnV2Core(input);
  await bindEvidence(input, turn).catch((error) => {
    console.error("[AgentCoreV2Entry] evidence binding failed", String((error as Error)?.message ?? error).slice(0, 240));
  });
  await bindRequestedArtifact(input, turn).catch((error) => {
    console.error("[AgentCoreV2Entry] artifact binding failed", String((error as Error)?.message ?? error).slice(0, 240));
  });
  await bindExecutedMonthlyPeriod(input, turn).catch((error) => {
    console.error("[AgentCoreV2Entry] monthly period binding failed", String((error as Error)?.message ?? error).slice(0, 240));
  });

  if (shadowSb && shadowSnapshot) {
    scheduleRuntimeV3ProductionShadow({
      sb: shadowSb,
      snapshot: shadowSnapshot,
      official: {
        path: turn.path ?? null,
        reply_kind: turn.reply_kind ?? null,
        run_id: turn.run_id ?? null,
      },
    });
  }

  return turn;
}
