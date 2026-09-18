// One-off production E2E for the comparison incident.
// IMPORTANT: this script never prints user identifiers, replies, financial values,
// tool results or secrets. The workflow redirects stdout/stderr as a second guard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleTurnV2 } from "../supabase/functions/_shared/agent/core/AgentCoreV2Entry.ts";
import { loadConversationMemory } from "../supabase/functions/_shared/agent/core/ConversationMemory.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("e2e_env_missing");

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(code: string): never {
  throw new Error(`e2e_${code}`);
}

function norm(value: string): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Resolve the incident owner from the production incident itself instead of
// committing a user/conversation identifier into this public repository.
const { data: incidentRows, error: incidentError } = await sb.from("agent_runs")
  .select("user_id")
  .eq("error_sanitized", "semantic_contract_failed_closed:compiler_failed")
  .gte("started_at", "2026-09-18T14:30:00Z")
  .lt("started_at", "2026-09-18T14:40:00Z");
if (incidentError) fail("incident_lookup_failed");
const userIds = [...new Set((incidentRows ?? []).map((row: any) => String(row.user_id ?? "")).filter(Boolean))];
if (userIds.length !== 1) fail("incident_owner_ambiguous");
const user_id = userIds[0]!;

const marker = `comparison_contract_${Date.now()}`;
const { data: conversation, error: conversationError } = await sb.from("conversations")
  .insert({
    user_id,
    source: "app",
    phone_e164: null,
    pending_slots: { __nino_e2e: marker, status: "running" },
  } as any)
  .select("id")
  .single();
if (conversationError || !conversation?.id) fail("conversation_create_failed");
const conversation_id = String(conversation.id);

const prompts = [
  "Nos últimos 3 meses, quais categorias ficaram acima da média dos 3 meses imediatamente anteriores?",
  "Qual delas ficou mais acima?",
  "E qual ficou menos acima da média?",
  "Esses valores que você está comparando são médias mensais ou valores totais?",
];

const turns: Array<Awaited<ReturnType<typeof handleTurnV2>>> = [];
try {
  for (const text of prompts) {
    const turn = await handleTurnV2({
      user_id,
      conversation_id,
      inbound_message_id: crypto.randomUUID(),
      text,
      channel: "app",
    });
    if (!turn.run_id || !turn.session_id) fail("turn_missing_trace");
    turns.push(turn);
  }

  const first = turns[0]!;
  const memory = await loadConversationMemory(sb as any, first.session_id ?? null);
  if (!memory) fail("memory_missing");
  const ref = [...(memory.references ?? [])].reverse().find((item: any) =>
    item?.status === "active" && item?.source?.context?.evidence?.kind === "comparison"
  ) as any;
  if (!ref) fail("comparison_reference_missing");

  const context = ref.source?.context ?? {};
  const evidence = context.evidence ?? null;
  if (!evidence || !Array.isArray(evidence.rows)) fail("comparison_evidence_missing");
  if (context.months !== 3) fail("baseline_window_wrong");
  if (context.target_period?.from !== "2026-06-18" || context.target_period?.to !== "2026-09-18") {
    fail("target_period_wrong");
  }
  if (evidence.comparison_alignment !== "preceding_rolling_window") fail("alignment_wrong");
  if (evidence.target_statistic !== "monthly_mean") fail("target_statistic_wrong");

  const positive = [...evidence.rows]
    .filter((row: any) => Number(row?.delta_abs ?? 0) > 0.005)
    .sort((a: any, b: any) => Number(b.delta_abs) - Number(a.delta_abs));
  if (positive.length < 2) fail("positive_rows_insufficient");
  const expectedMax = String(positive[0]?.name ?? "");
  const expectedMin = String(positive[positive.length - 1]?.name ?? "");
  if (!expectedMax || !expectedMin) fail("expected_entities_missing");

  if (!norm(turns[1]!.reply).includes(norm(expectedMax))) fail("max_followup_wrong");
  if (!norm(turns[2]!.reply).includes(norm(expectedMin))) fail("min_followup_wrong");

  const methodology = norm(turns[3]!.reply);
  if (!methodology.includes("medias mensais")) fail("methodology_not_monthly_mean");
  if (!(methodology.includes("nao misturo total") || methodology.includes("nao estou comparando um total"))) {
    fail("methodology_total_mean_guard_missing");
  }

  const runIds = turns.map((turn) => turn.run_id!).filter(Boolean);
  const { data: runs, error: runError } = await sb.from("agent_runs")
    .select("id,status,tools_used,error_sanitized,context_layers")
    .in("id", runIds);
  if (runError || (runs ?? []).length !== 4) fail("run_audit_missing");
  for (const run of runs ?? []) {
    if (String(run.status) !== "done") fail("run_not_done");
    if (run.error_sanitized) fail("run_error_present");
    const layers = (run.context_layers ?? {}) as any;
    if (layers.runtime_version !== "nino-agent-p0.2026-09-18.6") fail("runtime_version_wrong");
    if (layers.analytical_contract_version !== "nino_analytical.v5") fail("contract_version_wrong");
  }
  const firstRun = (runs ?? []).find((run: any) => String(run.id) === first.run_id) as any;
  if (!Array.isArray(firstRun?.tools_used) || !firstRun.tools_used.includes("compare_to_monthly_average")) {
    fail("canonical_engine_not_used");
  }

  const { data: calls, error: callsError } = await sb.from("agent_tool_calls")
    .select("tool_name,ok")
    .eq("run_id", first.run_id!);
  if (callsError || !(calls ?? []).some((call: any) => call.tool_name === "compare_to_monthly_average" && call.ok === true)) {
    fail("evidence_tool_call_missing");
  }

  await sb.from("conversations").update({
    pending_slots: {
      __nino_e2e: marker,
      status: "passed",
      run_ids: runIds,
      session_id: first.session_id,
      checked_at: new Date().toISOString(),
    },
  } as any).eq("id", conversation_id);
} catch (_error) {
  await sb.from("conversations").update({
    pending_slots: { __nino_e2e: marker, status: "failed", checked_at: new Date().toISOString() },
  } as any).eq("id", conversation_id).catch(() => undefined);
  fail("production_comparison_sequence_failed");
}
