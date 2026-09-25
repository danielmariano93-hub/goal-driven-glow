// Real-provider smoke for the semantic authorities used in production/migration.
// Run only when GROQ_API_KEY + NINO_AI_PROVIDER are configured.
//
// This is a DEPLOYMENT-COMPATIBILITY probe plus two closed-form V3 semantic
// invariants derived from real production incidents. No user/database data is used.
// The V3 cases intentionally exercise both GPT-OSS models so the smoke validates
// strict Structured Outputs without consuming the same model's minute-token
// budget twice back-to-back.
import { interpretConversationTurn } from "../supabase/functions/_shared/agent/core/ConversationBrain.ts";
import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const fastModel = Deno.env.get("NINO_AI_FAST_MODEL") ?? "openai/gpt-oss-20b";
const outcome = await interpretConversationTurn({
  text: "Nino, quanto eu gastei com Alimentação em agosto?",
  history: [],
  memory: null,
  workflow: null,
  user_context: JSON.stringify({
    preferences: { verbosity: "concise", suggestion_frequency: "medium" },
  }),
  model,
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

// V3 / 120b: current-turn entity must beat prior memory; temporal demonstrative
// must remain a period rather than becoming a reference to the old category.
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

// V3 / 20b: goals overview is executable semantics, never generic conversation.
// Using the second configured GPT-OSS model avoids manufacturing a 120b TPM
// collision in CI while still exercising the exact strict-schema transport.
const goals = await interpretSemanticTurnV3({
  text: "Quais metas eu tenho?",
  history_text: "",
  context_text: JSON.stringify({ conversation_state: null }),
  model: fastModel,
});
if (!goals.telemetry.ok || goals.turn?.kind !== "task") {
  throw new Error(`V3 goals smoke failed: ${goals.telemetry.error ?? "missing_task"}`);
}
const goalTask = goals.turn.tasks.find((item) => item.kind === "goal_query");
if (!goalTask || goalTask.kind !== "goal_query" || goalTask.operation !== "overview" || goalTask.goal !== null) {
  throw new Error(`V3 goals semantics invalid: ${JSON.stringify(goalTask)}`);
}

console.log(JSON.stringify({
  ok: true,
  provider: outcome.telemetry.provider,
  model: outcome.telemetry.model,
  v2: {
    mode: outcome.contract.mode,
    act: outcome.contract.act,
    periods,
    canonical_request: outcome.contract.canonical_request,
    financial_read: outcome.contract.financial_read,
  },
  v3_models: {
    explicit_entity_override: model,
    goals_overview: fastModel,
  },
  v3_smokes: ["explicit_entity_override", "goals_overview"],
}));
