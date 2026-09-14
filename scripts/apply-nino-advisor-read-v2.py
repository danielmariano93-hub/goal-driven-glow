from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# --- AgentCoreV2 wiring -----------------------------------------------------
p = "supabase/functions/_shared/agent/core/AgentCoreV2.ts"
replace(p,
'import type { ConversationTurnContract } from "./ConversationTurnContract.ts";',
'import { normalizePeriodExpressions, type ConversationTurnContract } from "./ConversationTurnContract.ts";\nimport { resolvePeriodExpressions } from "../../analytics/multiPeriodResolver.ts";\nimport { loadBrainUserContext } from "./BrainUserContext.ts";')
replace(p,
'    period: Boolean(contract.focus.period_expression),',
'    period: Boolean(contract.focus.period_expression || contract.focus.period_expressions?.length),')
replace(p,
'      path: "conversation_brain_v1",',
'      // agent_runs.path has a legacy enum CHECK; keep the stable analytics path\n      // and stamp the architecture in capability/context_layers instead.\n      path: "llm",')
replace(p,
'      context_layers: runtimeContext(`conversation_brain:${args.contract.mode}`),',
'      context_layers: {\n        ...runtimeContext(`conversation_brain:${args.contract.mode}`),\n        conversation_architecture: { version: "conversation_brain_v1", mode: args.contract.mode },\n      },')
replace(p,
'    if (error) return undefined;\n    return (data as any)?.id as string | undefined;\n  } catch {\n    return undefined;\n  }',
'    if (error) {\n      console.error("conversation_brain_run_persist_failed", { code: error.code, message: error.message });\n      return undefined;\n    }\n    return (data as any)?.id as string | undefined;\n  } catch (error) {\n    console.error("conversation_brain_run_persist_exception", error);\n    return undefined;\n  }')
replace(p,
'  const [loadedHistory, memory, workflow] = await Promise.all([\n    loadHistory(sb, input.conversation_id, { limit: 12, excludeMessageId: input.inbound_message_id }).catch(() => []),\n    loadConversationMemory(sb, session_id ?? null).catch(() => null),\n    loadWorkflow(sb, { user_id: input.user_id, conversation_id: input.conversation_id }).catch(() => null),\n  ]);',
'  const [loadedHistory, memory, workflow, userContext] = await Promise.all([\n    loadHistory(sb, input.conversation_id, { limit: 12, excludeMessageId: input.inbound_message_id }).catch(() => []),\n    loadConversationMemory(sb, session_id ?? null).catch(() => null),\n    loadWorkflow(sb, { user_id: input.user_id, conversation_id: input.conversation_id }).catch(() => null),\n    loadBrainUserContext(sb, input.user_id).catch(() => null),\n  ]);')
replace(p,
'    workflow,\n    model: BRAIN_MODEL,',
'    workflow,\n    user_context: userContext,\n    model: BRAIN_MODEL,')
replace(p,
'  const canonical = String(contract.canonical_request ?? input.text).trim();\n  const plan = buildTurnPlan({ text: canonical, history });',
'  const canonical = String(contract.canonical_request ?? input.text).trim();\n  const periodResolution = resolvePeriodExpressions(\n    normalizePeriodExpressions(contract.focus),\n    canonical,\n  );\n  const plan = buildTurnPlan({ text: canonical, history });\n  const primaryPeriod = periodResolution.periods[0] ?? plan.effective_period;')
replace(p,
'    period: {\n      from: plan.effective_period.from,\n      to: plan.effective_period.to,\n      label: plan.effective_period.label,\n    },\n    comparison_period: plan.previous_period,',
'    period: {\n      from: primaryPeriod.from,\n      to: primaryPeriod.to,\n      label: primaryPeriod.label,\n    },\n    periods: periodResolution.periods.map((period) => ({\n      from: period.from, to: period.to, label: period.label,\n    })),\n    comparison_intent: periodResolution.comparison_intent,\n    comparison_period: periodResolution.comparison_intent && periodResolution.periods.length === 2\n      ? {\n        from: periodResolution.periods[1].from,\n        to: periodResolution.periods[1].to,\n        label: periodResolution.periods[1].label,\n      }\n      : plan.previous_period,')
replace(p,
'      period: {\n        from: plan.effective_period.from,\n        to: plan.effective_period.to,\n        label: plan.effective_period.label,\n      },',
'      period: {\n        from: primaryPeriod.from,\n        to: primaryPeriod.to,\n        label: primaryPeriod.label,\n      },')
replace(p,
'    active_period: {\n      from: plan.effective_period.from,\n      to: plan.effective_period.to,\n      label: plan.effective_period.label,\n    },\n    comparison_period: plan.previous_period,\n    pending_slots: semantic.status === "clarification_required" ? ["semantic_clarification"] : [],',
'    active_period: {\n      from: primaryPeriod.from,\n      to: primaryPeriod.to,\n      label: primaryPeriod.label,\n    },\n    comparison_period: periodResolution.comparison_intent && periodResolution.periods.length === 2\n      ? {\n        from: periodResolution.periods[1].from,\n        to: periodResolution.periods[1].to,\n        label: periodResolution.periods[1].label,\n      }\n      : plan.previous_period,\n    last_analysis: periodResolution.periods.length >= 2\n      ? {\n        kind: "multi_period_read",\n        payload: {\n          request: canonical,\n          category: contract.focus.category ?? null,\n          periods: periodResolution.periods.map((period) => ({\n            from: period.from, to: period.to, label: period.label,\n          })),\n        },\n        created_at: new Date().toISOString(),\n      }\n      : (memory?.last_analysis ?? null),\n    pending_slots: semantic.status === "clarification_required" ? ["semantic_clarification"] : [],')

# --- Weekly review = last CLOSED week --------------------------------------
p = "supabase/functions/_shared/agent/core/AdvisorReviewServiceV2.ts"
replace(p,
'  const weekday = (today.getUTCDay() + 6) % 7;\n  const start = new Date(today.getTime() - weekday * DAY);\n  const end = new Date(start.getTime() + 6 * DAY);\n  const previousStart = new Date(start.getTime() - 7 * DAY);\n  const previousEnd = new Date(start.getTime() - DAY);',
'  // Weekly review is a CLOSED-period review. The current week is never\n  // complete, so always use the previous Monday-Sunday window.\n  const weekday = (today.getUTCDay() + 6) % 7;\n  const currentWeekStart = new Date(today.getTime() - weekday * DAY);\n  const start = new Date(currentWeekStart.getTime() - 7 * DAY);\n  const end = new Date(currentWeekStart.getTime() - DAY);\n  const previousStart = new Date(start.getTime() - 7 * DAY);\n  const previousEnd = new Date(start.getTime() - DAY);')

# --- Runtime stamp ----------------------------------------------------------
p = "supabase/functions/_shared/agent/core/RuntimeContract.ts"
replace(p,
'export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-11.22";',
'export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-14.23";')
replace(p,
'export const ANALYTICAL_CONTRACT_VERSION = "nino_analytical.v2";',
'export const ANALYTICAL_CONTRACT_VERSION = "nino_analytical.v3";')

print("nino advisor-read v2 patch applied")
