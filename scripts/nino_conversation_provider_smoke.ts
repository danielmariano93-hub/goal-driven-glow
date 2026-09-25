// Real-provider smoke for the semantic authority that is active in production.
// Run only when GROQ_API_KEY + NINO_AI_PROVIDER are configured.
//
// Deployment blocking policy:
// - exercise the FULL ConversationBrain contract on the SAME primary model used
//   by AgentCoreV2 in production (GPT-OSS 120b);
// - exercise strict JSON-Schema transport on the fast model with a tiny schema,
//   without pretending the 20b model is a semantic authority for the full Nino
//   contract. V3 semantic breadth remains covered by the repository regression
//   suite and gets a full-model smoke before its authority rollout is enabled.
//
// This keeps the deployment gate fail-closed without manufacturing semantic
// failures on a model that production never uses as ConversationBrain authority.
import { interpretConversationTurn } from "../supabase/functions/_shared/agent/core/ConversationBrain.ts";
import { callStructuredFunction } from "../supabase/functions/_shared/ai-structured.ts";
import { resolveAiProvider } from "../supabase/functions/_shared/ai-runtime.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const fastModel = Deno.env.get("NINO_AI_FAST_MODEL") ?? "openai/gpt-oss-20b";

// The smoke must expose deterministic contract reason codes when the provider
// returns syntactically valid JSON that is rejected by Nino's canonical
// invariants. Use an in-memory Supabase-shaped sink so CI gets the same
// diagnostic metadata as production without writing any row to the real DB.
let capturedContractInvalidReasons: unknown = null;
const diagnosticSink = {
  from(table: string) {
    return {
      insert: async (row: Record<string, unknown>) => {
        if (table === "ai_usage_ledger" && row?.error_code === "conversation_brain_contract_invalid") {
          const metadata = row?.metadata as Record<string, unknown> | null | undefined;
          capturedContractInvalidReasons = metadata?.contract_invalid_reasons ?? null;
        }
        return { data: null, error: null };
      },
    };
  },
};

// V2 / primary model: this is the exact semantic authority active in AgentCoreV2.
const outcome = await interpretConversationTurn({
  text: "Nino, quanto eu gastei com Alimentação em agosto?",
  history: [],
  memory: null,
  workflow: null,
  user_context: JSON.stringify({
    preferences: { verbosity: "concise", suggestion_frequency: "medium" },
  }),
  model,
  sb: diagnosticSink as any,
});

if (!outcome.telemetry.ok || !outcome.contract) {
  throw new Error(
    `ConversationBrain provider smoke failed: ${outcome.telemetry.error ?? "missing_contract"}`
      + ` reasons=${JSON.stringify(capturedContractInvalidReasons)}`,
  );
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

// Fast model: validate only the provider transport it is allowed to use. A small
// strict schema is intentional; semantic V3 correctness is validated separately
// and must not be conflated with provider compatibility for a fast-tier model.
const provider = resolveAiProvider();
if (!provider) throw new Error("Groq provider not configured for strict transport smoke");
const strictProbe = await callStructuredFunction({
  provider,
  model: fastModel,
  system: "Return the requested structured compatibility result only.",
  user: "Emit ok=true.",
  tool: {
    name: "emit_strict_transport_probe",
    description: "Provider compatibility probe; no domain action is executed.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  },
  temperature: 0,
  reasoning_effort: "low",
});
if (!strictProbe.ok) {
  throw new Error(`Fast-model strict JSON Schema smoke failed: ${strictProbe.error_code ?? "unknown"}`);
}
let strictArgs: { ok?: boolean } = {};
try {
  strictArgs = JSON.parse(strictProbe.arguments);
} catch {
  throw new Error("Fast-model strict JSON Schema smoke returned invalid JSON");
}
if (strictArgs.ok !== true) {
  throw new Error(`Fast-model strict JSON Schema smoke returned invalid payload: ${strictProbe.arguments}`);
}

console.log(JSON.stringify({
  ok: true,
  provider: outcome.telemetry.provider,
  models: {
    v2_semantic_authority: model,
    fast_strict_transport_probe: fastModel,
  },
  v2: {
    mode: outcome.contract.mode,
    act: outcome.contract.act,
    periods,
    canonical_request: outcome.contract.canonical_request,
    financial_read: outcome.contract.financial_read,
  },
  strict_transport_probe: true,
  note: "V3 semantic regressions remain in repository tests; full primary-model V3 smoke gates its future authority rollout, not the current V2 deployment.",
}));
