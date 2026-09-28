// Nino Runtime V3 — single semantic authority with model tiering.
//
// Natural-language meaning is interpreted only by V3. We may change MODEL TIER
// when a turn is complex or a provider/model is unavailable, but we never fall
// back to a regex/router/legacy brain that can reinterpret the same sentence.
// deno-lint-ignore-file no-explicit-any

import type { AiProviderConfig } from "../../ai-runtime.ts";
import {
  interpretSemanticTurnV3,
  type SemanticInterpreterV3Outcome,
  type SemanticInterpreterV3Telemetry,
} from "./SemanticInterpreterV3.ts";
import { compareSemanticSignaturesV3, semanticSignatureV3 } from "./SemanticComparatorV3.ts";
import type { TurnSpecV3 } from "./TurnSpecV3.ts";

function envValue(name: string): string | undefined {
  const denoEnv = (globalThis as any)?.Deno?.env;
  if (denoEnv && typeof denoEnv.get === "function") return denoEnv.get(name) ?? undefined;
  const processEnv = (globalThis as any)?.process?.env;
  return processEnv ? processEnv[name] : undefined;
}

export type SemanticAuthorityV3Input = {
  text: string;
  history_text?: string | null;
  context_text?: string | null;
  deep_model?: string | null;
  provider_override?: AiProviderConfig | null;
};

export type SemanticAuthorityV3Outcome = SemanticInterpreterV3Outcome & {
  tier: "fast" | "deep" | "reviewed" | "unavailable";
  review_required: boolean;
  review_match: boolean | null;
  review_reasons: string[];
};

export function semanticFastModel(): string {
  return String(envValue("NINO_SEMANTIC_FAST_MODEL") ?? "openai/gpt-oss-20b").trim();
}

export function semanticDeepModel(explicit?: string | null): string {
  return String(
    explicit
      ?? envValue("NINO_SEMANTIC_DEEP_MODEL")
      ?? envValue("NINO_AI_MODEL")
      ?? "openai/gpt-oss-120b",
  ).trim();
}

/**
 * Review is selected from the STRUCTURED meaning, never from lexical rules.
 * Writes, compound turns, advisory reasoning and contextual references carry
 * more consequence/ambiguity and therefore get a second semantic opinion.
 */
export function requiresDeepSemanticReview(turn: TurnSpecV3): boolean {
  if (turn.kind !== "task") return false;
  if (turn.tasks.length > 1) return true;
  if (turn.references.length > 0) return true;
  return turn.tasks.some((task) => task.kind === "financial_write" || task.kind === "advisory");
}

function aggregateTelemetry(
  fast: SemanticInterpreterV3Telemetry,
  deep: SemanticInterpreterV3Telemetry,
  ok: boolean,
  error: string | null,
): SemanticInterpreterV3Telemetry {
  return {
    model: `${fast.model}->${deep.model}`.slice(0, 180),
    provider: deep.provider ?? fast.provider,
    llm_calls: Number(fast.llm_calls ?? 0) + Number(deep.llm_calls ?? 0),
    tokens_in: Number(fast.tokens_in ?? 0) + Number(deep.tokens_in ?? 0),
    tokens_out: Number(fast.tokens_out ?? 0) + Number(deep.tokens_out ?? 0),
    latency_ms: Number(fast.latency_ms ?? 0) + Number(deep.latency_ms ?? 0),
    ok,
    error,
  };
}

function unavailable(
  first: SemanticInterpreterV3Outcome,
  second: SemanticInterpreterV3Outcome | null,
  reason: string,
): SemanticAuthorityV3Outcome {
  const telemetry = second
    ? aggregateTelemetry(first.telemetry, second.telemetry, false, reason)
    : { ...first.telemetry, ok: false, error: reason };
  return {
    turn: null,
    telemetry,
    violations: [...new Set([...(first.violations ?? []), ...(second?.violations ?? [])])],
    tier: "unavailable",
    review_required: false,
    review_match: null,
    review_reasons: [],
  };
}

export async function interpretWithSingleSemanticAuthorityV3(
  input: SemanticAuthorityV3Input,
): Promise<SemanticAuthorityV3Outcome> {
  const fastModel = semanticFastModel();
  const deepModel = semanticDeepModel(input.deep_model);

  const fast = await interpretSemanticTurnV3({
    text: input.text,
    history_text: input.history_text,
    context_text: input.context_text,
    model: fastModel,
    provider_override: input.provider_override ?? null,
  });

  // If the fast semantic tier cannot produce a valid contract, change MODEL
  // tier. This is not semantic fallback: both tiers emit the same TurnSpecV3.
  if (!fast.turn) {
    if (!deepModel || deepModel === fastModel) {
      return unavailable(fast, null, String(fast.telemetry.error ?? "semantic_authority_unavailable"));
    }
    const deep = await interpretSemanticTurnV3({
      text: input.text,
      history_text: input.history_text,
      context_text: input.context_text,
      model: deepModel,
      provider_override: input.provider_override ?? null,
    });
    if (!deep.turn) {
      return unavailable(
        fast,
        deep,
        `semantic_tiers_unavailable:${String(fast.telemetry.error ?? "fast")}:${String(deep.telemetry.error ?? "deep")}`.slice(0, 220),
      );
    }
    return {
      ...deep,
      telemetry: aggregateTelemetry(fast.telemetry, deep.telemetry, true, null),
      tier: "deep",
      review_required: false,
      review_match: null,
      review_reasons: [],
    };
  }

  const reviewRequired = requiresDeepSemanticReview(fast.turn);
  if (!reviewRequired || !deepModel || deepModel === fastModel) {
    return {
      ...fast,
      tier: "fast",
      review_required: reviewRequired,
      review_match: reviewRequired ? true : null,
      review_reasons: [],
    };
  }

  const deep = await interpretSemanticTurnV3({
    text: input.text,
    history_text: input.history_text,
    context_text: input.context_text,
    model: deepModel,
    provider_override: input.provider_override ?? null,
  });
  if (!deep.turn) {
    // Reads/conversation can use the valid fast contract. Writes/compound turns
    // fail closed when the independent semantic review is unavailable.
    return unavailable(
      fast,
      deep,
      `semantic_review_unavailable:${String(deep.telemetry.error ?? "deep")}`.slice(0, 220),
    );
  }

  const comparison = compareSemanticSignaturesV3(
    semanticSignatureV3(fast.turn),
    semanticSignatureV3(deep.turn),
  );
  if (!comparison.semantic_match) {
    return {
      turn: null,
      telemetry: aggregateTelemetry(fast.telemetry, deep.telemetry, false, "semantic_tier_disagreement"),
      violations: comparison.divergence_reasons,
      tier: "unavailable",
      review_required: true,
      review_match: false,
      review_reasons: comparison.divergence_reasons,
    };
  }

  return {
    ...deep,
    telemetry: aggregateTelemetry(fast.telemetry, deep.telemetry, true, null),
    tier: "reviewed",
    review_required: true,
    review_match: true,
    review_reasons: [],
  };
}
