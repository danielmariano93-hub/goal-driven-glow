// Real-provider smoke for the semantic authorities used in production/migration.
// Run only when GROQ_API_KEY + NINO_AI_PROVIDER are configured.
//
// This is intentionally a MINIMAL deployment-compatibility probe. The repository
// suite already covers semantic breadth (including goals overview). Here we spend
// provider quota only on the two exact transport families production depends on:
// - V2 best-effort/forced tool calling on the fast GPT-OSS model;
// - V3 strict Structured Outputs on the primary GPT-OSS model.
//
// Keeping this to two real calls avoids the deployment gate manufacturing Groq
// TPM/RPM failures while still failing closed on genuine provider incompatibility.
import { interpretConversationTurn } from "../supabase/functions/_shared/agent/core/ConversationBrain.ts";
import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const fastModel = Deno.env.get("NINO_AI_FAST_MODEL") ?? "openai/gpt-oss-20b";

// V2 / 20b: exercise the exact ConversationBrain structured tool-call transport.
// Semantic correctness is model-independent and already covered by the full suite;
// this probe verifies that the configured Groq account/model can execute the path.
const outcome = await interpretConversationTurn({
  text: "Nino, quanto eu gastei com Alimentação em agosto?",
  history: [],
  memory: null,
  workflow: null,
  user_context: JSON.stringify({
    preferences: { verbosity: "concise", suggestion_frequency: "medium" },
  }),
  model: fastModel,
});

if (!outcome.telemetry.ok || !outcome.contract) {
  throw new Error(`ConversationBrain provider smoke failed: ${outcome.telemetry.error ?? "missing_contract"}`);
}
if (outcome.contract.mode !== "read") {
  throw new Error(`Expected read mode, got ${outcome.contract.mode}`);
}
const periods = outcome.contract.focus.period_expressions ?? [];
const normalized = periods.map((p) => p.toLowerCase());
if (!normalized.some((p) => p.includes("agosto"))) {
  throw new Error(`ConversationBrain lost requested period: ${JSON.stringify(periods)}`);
}
if (String(outcome.contract.focus.category ?? "").toLowerCase() !== "alimentação") {
  throw new Error(`ConversationBrain lost explicit category entity: ${JSON.stringify(outcome.contract.focus)}`);
}
if (!String(outcome.contract.canonical_request ?? "").toLowerCase().includes("alimenta")) {
  throw new Error(`ConversationBrain lost category scope: ${outcome.contract.canonical_request}`);
}
if (outcome.contract.version !== "conversation_turn_contract.v2") {
  throw new Error(`Expected Turn Contract v2, got ${outcome.contract.version}`);
}
if (outcome.contract.domain !== "financial_read") {
  throw new Error(`Expected financial_read domain, got ${outcome.contract.domain}`);
}
const semantic = outcome.contract.financial_read;
const query = semantic?.queries?.[0];
if (!semantic || query?.metric !== "expense_amount" || query?.operation !== "sum") {
  throw new Error(`ConversationBrain lost authoritative financial semantics: ${JSON.stringify(semantic)}`);
}
if (!query.filters.some((filter) => filter.field === "category" && filter.value.toLowerCase() === "alimentação")) {
  throw new Error(`ConversationBrain lost explicit category filter: ${JSON.stringify(semantic)}`);
}
if ("confidence" in outcome.contract) {
  throw new Error("ConversationBrain reintroduced numeric self-confidence");
}

// V3 / 120b: exercise the exact strict JSON-schema transport and the production
// regression that previously inherited Alimentação into an explicit Lazer turn.
const lazer = await interpretSemanticTurnV3({
  text: "E em Lazer? Quanto eu gastei esse mês?",
  history_text: [
    "Usuário: Quanto eu gastei em Alimentação?",
    "Nino: Alimentação ficou abaixo da referência.",
  ].join("\n"),
  context_text: JSON.stringify({
    conversation_state: {
      current_topic: "categoria:Alimentação",
      active_category: "Alimentação",
      active_period: { from: "2026-09-01", to: "2026-09-25", label: "este mês" },
    },
  }),
  model,
});
if (!lazer.telemetry.ok || lazer.turn?.kind !== "task") {
  throw new Error(`V3 Lazer smoke failed: ${lazer.telemetry.error ?? "missing_task"}`);
}
const lazerTask = lazer.turn.tasks.find((item) => item.kind === "financial_query");
if (!lazerTask || lazerTask.kind !== "financial_query") throw new Error("V3 Lazer smoke missing financial_query");
const lazerCategory = lazerTask.filters.find((filter) => filter.field === "category")?.entity;
if (String(lazerCategory?.value ?? "").toLowerCase() !== "lazer" || lazerCategory?.source !== "current_turn") {
  throw new Error(`V3 did not preserve explicit Lazer override: ${JSON.stringify(lazerCategory)}`);
}
if (!lazerTask.periods.some((period) => /m[eê]s/i.test(period.value) && period.source === "current_turn")) {
  throw new Error(`V3 lost current-month period: ${JSON.stringify(lazerTask.periods)}`);
}
if (lazer.turn.references.length !== 0) {
  throw new Error(`V3 emitted inherited reference alongside explicit Lazer: ${JSON.stringify(lazer.turn.references)}`);
}

console.log(JSON.stringify({
  ok: true,
  provider: outcome.telemetry.provider,
  models: {
    v2_tool_call: fastModel,
    v3_strict_output: model,
  },
  v2: {
    mode: outcome.contract.mode,
    act: outcome.contract.act,
    periods,
    canonical_request: outcome.contract.canonical_request,
    financial_read: outcome.contract.financial_read,
  },
  v3_smokes: ["explicit_entity_override"],
  note: "goals_overview remains covered by deterministic/unit regression suite; no duplicate real-provider call",
}));
