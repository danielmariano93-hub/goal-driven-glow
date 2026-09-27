// Real-provider smoke for the semantic authority that is active in production.
// Run only when GROQ_API_KEY + NINO_AI_PROVIDER are configured.
//
// Deployment blocking policy:
// - invalid credential/model/transport/semantic contract MUST block deployment;
// - a provider 429 is capacity pressure, not a broken revision. In the production
//   deploy workflow only, it is recorded as a warning after the credential and
//   model catalog have already been validated by the workflow;
// - the standalone diagnostic workflow stays fail-closed on 429 so it can still
//   be used deliberately to investigate provider capacity.
//
// This avoids a paradox where a healthy fix cannot be deployed precisely when
// the current production runtime is consuming the provider quota.
import { interpretConversationTurn } from "../supabase/functions/_shared/agent/core/ConversationBrain.ts";
import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";
import { callStructuredFunction } from "../supabase/functions/_shared/ai-structured.ts";
import { resolveAiProvider } from "../supabase/functions/_shared/ai-runtime.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const fastModel = Deno.env.get("NINO_AI_FAST_MODEL") ?? "openai/gpt-oss-20b";
const deployWorkflow = Deno.env.get("GITHUB_WORKFLOW") === "Nino Direct Supabase Deploy";
const allowTransientRateLimit = deployWorkflow
  || Deno.env.get("NINO_PROVIDER_SMOKE_ALLOW_RATE_LIMIT") === "1";

function isRateLimit(value: unknown): boolean {
  return /(?:^|[_\s-])429(?:$|[_\s-])|rate\s*limit|too many requests/i.test(String(value ?? ""));
}

function warnRateLimit(stage: string, error: unknown): void {
  console.warn(
    `[provider-smoke] ${stage} skipped after transient Groq rate limit; `
      + `credential/model availability is validated separately. detail=${String(error ?? "429").slice(0, 160)}`,
  );
}

// The smoke must expose deterministic contract reason codes and safe provider
// error details. Use an in-memory Supabase-shaped sink so CI gets the same
// diagnostic metadata as production without writing any row to the real DB.
let capturedContractInvalidReasons: unknown = null;
let capturedUpstreamError: unknown = null;
const diagnosticSink = {
  from(table: string) {
    return {
      insert: async (row: Record<string, unknown>) => {
        if (table === "ai_usage_ledger") {
          const metadata = row?.metadata as Record<string, unknown> | null | undefined;
          if (row?.error_code === "conversation_brain_contract_invalid") {
            capturedContractInvalidReasons = metadata?.contract_invalid_reasons ?? null;
          }
          if (String(row?.error_code ?? "").startsWith("conversation_brain_gateway_")) {
            capturedUpstreamError = metadata?.upstream_error ?? null;
          }
        }
        return { data: null, error: null };
      },
    };
  },
};

let fullModelRateLimited = false;
let v2Summary: Record<string, unknown> | null = null;
let semanticSmokeStages: string[] = [];

// V3 / primary model: production semantic authority. Exercise the two shapes
// that exposed real shadow gaps before rollout: historical monthly read + write.
const v3Monthly = await interpretSemanticTurnV3({
  text: "Quanto gastei com Alimentação por mês nos últimos 5 meses?",
  history_text: "",
  context_text: "",
  model,
});
if (!v3Monthly.telemetry.ok || !v3Monthly.turn || v3Monthly.turn.kind !== "task") {
  const detail = v3Monthly.telemetry.error ?? "missing_task";
  if (allowTransientRateLimit && isRateLimit(detail)) {
    fullModelRateLimited = true;
    warnRateLimit("v3_monthly", detail);
  } else {
    throw new Error(`V3 monthly authority smoke failed: ${detail}`);
  }
} else {
  const monthlyTask = v3Monthly.turn.tasks[0];
  if (monthlyTask?.kind !== "financial_query"
    || monthlyTask.metric !== "expense_amount"
    || monthlyTask.operation !== "trend"
    || monthlyTask.group_by[0] !== "month"
    || !monthlyTask.filters.some((filter) => filter.field === "category" && filter.entity.value.toLowerCase() === "alimentação")) {
    throw new Error(`V3 lost monthly semantics: ${JSON.stringify(v3Monthly.turn)}`);
  }
  const v3MonthlyBridge = bridgeTurnSpecV3ToRuntime(v3Monthly.turn);
  if (!v3MonthlyBridge.ok || v3MonthlyBridge.contract.mode !== "read") {
    throw new Error(`V3 monthly bridge failed: ${JSON.stringify(v3MonthlyBridge)}`);
  }
  semanticSmokeStages.push("v3_monthly");
}

if (!fullModelRateLimited) {
  const v3Write = await interpretSemanticTurnV3({
    text: "Registre um gasto de R$ 50,00 no estabelecimento Teste em 26 de setembro de 2026 na conta Corrente Itaú.",
    history_text: "",
    context_text: "",
    model,
  });
  if (!v3Write.telemetry.ok || !v3Write.turn || v3Write.turn.kind !== "task") {
    const detail = v3Write.telemetry.error ?? "missing_task";
    if (allowTransientRateLimit && isRateLimit(detail)) {
      fullModelRateLimited = true;
      warnRateLimit("v3_write", detail);
    } else {
      throw new Error(`V3 write authority smoke failed: ${detail}`);
    }
  } else {
    const writeTask = v3Write.turn.tasks[0];
    if (writeTask?.kind !== "financial_write" || writeTask.action !== "transaction.create") {
      throw new Error(`V3 lost canonical write action: ${JSON.stringify(v3Write.turn)}`);
    }
    const v3WriteBridge = bridgeTurnSpecV3ToRuntime(v3Write.turn);
    if (!v3WriteBridge.ok || v3WriteBridge.contract.mode !== "write") {
      throw new Error(`V3 write bridge failed: ${JSON.stringify(v3WriteBridge)}`);
    }
    semanticSmokeStages.push("v3_write");
  }
}

// V2 is a circuit breaker. Do not spend another full-model request after a 429:
// that only deepens provider pressure and cannot distinguish code health from quota.
if (!fullModelRateLimited) {
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
    const detail = outcome.telemetry.error ?? "missing_contract";
    if (allowTransientRateLimit && (isRateLimit(detail) || isRateLimit(capturedUpstreamError))) {
      fullModelRateLimited = true;
      warnRateLimit("v2_circuit_breaker", `${detail} ${JSON.stringify(capturedUpstreamError)}`);
    } else {
      throw new Error(
        `ConversationBrain provider smoke failed: ${detail}`
          + ` reasons=${JSON.stringify(capturedContractInvalidReasons)}`
          + ` upstream=${JSON.stringify(capturedUpstreamError)}`,
      );
    }
  } else {
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
    v2Summary = {
      mode: outcome.contract.mode,
      act: outcome.contract.act,
      periods,
      canonical_request: outcome.contract.canonical_request,
      financial_read: outcome.contract.financial_read,
    };
    semanticSmokeStages.push("v2_circuit_breaker");
  }
}

// Fast model: validate the provider transport it is allowed to use. This remains
// blocking: a malformed/unsupported strict transport is a compatibility defect.
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
  const detail = `${strictProbe.error_code ?? "unknown"} ${JSON.stringify(strictProbe.error_detail)}`;
  if (allowTransientRateLimit && isRateLimit(detail)) {
    warnRateLimit("fast_strict_transport", detail);
  } else {
    throw new Error(`Fast-model strict JSON Schema smoke failed: ${detail}`);
  }
} else {
  let strictArgs: { ok?: boolean } = {};
  try {
    strictArgs = JSON.parse(strictProbe.arguments);
  } catch {
    throw new Error("Fast-model strict JSON Schema smoke returned invalid JSON");
  }
  if (strictArgs.ok !== true) {
    throw new Error(`Fast-model strict JSON Schema smoke returned invalid payload: ${strictProbe.arguments}`);
  }
  semanticSmokeStages.push("fast_strict_transport");
}

console.log(JSON.stringify({
  ok: true,
  provider: provider.name,
  models: {
    v3_semantic_authority: model,
    v2_circuit_breaker: model,
    fast_strict_transport_probe: fastModel,
  },
  semantic_smoke_stages: semanticSmokeStages,
  full_model_rate_limited: fullModelRateLimited,
  v2: v2Summary,
  note: fullModelRateLimited
    ? "Deployment continued after transient 429; credential/models were validated and non-429 defects remain blocking."
    : "Full live provider smoke passed.",
}));
