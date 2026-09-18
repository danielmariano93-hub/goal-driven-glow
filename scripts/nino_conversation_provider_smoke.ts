// Real-provider smoke for the semantic authority used in production.
// Run only when GROQ_API_KEY + NINO_AI_PROVIDER are configured.
//
// IMPORTANT: this is a DEPLOYMENT-COMPATIBILITY probe, not a semantic benchmark.
// It deliberately uses an unambiguous request with explicit entity + period so
// the gate measures whether the provider can emit the canonical structured
// contract. Broader language/continuity cases stay covered by the deterministic
// Conversation Brain regression suite and must not make infrastructure deploys
// depend on one model's interpretation of an intentionally open-ended phrase.
import { interpretConversationTurn } from "../supabase/functions/_shared/agent/core/ConversationBrain.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
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

console.log(JSON.stringify({
  ok: true,
  provider: outcome.telemetry.provider,
  model: outcome.telemetry.model,
  mode: outcome.contract.mode,
  act: outcome.contract.act,
  periods,
  canonical_request: outcome.contract.canonical_request,
  financial_read: outcome.contract.financial_read,
}));
