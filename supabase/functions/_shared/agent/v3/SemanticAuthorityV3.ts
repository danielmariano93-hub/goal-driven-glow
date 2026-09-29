// Nino Runtime V3 — single semantic authority with a primary interpreter and
// an independent reviewer.
//
// Natural-language meaning is interpreted only by V3. We may change MODEL when
// a turn is consequential or a model is unavailable, but we never fall back to
// a regex/router/legacy brain that can reinterpret the same sentence.
//
// Tiering (measured in production, 2026-09-29): gpt-oss-20b violated the strict
// TurnSpec schema in >60% of turns while gpt-oss-120b and qwen3.8-27b produced
// valid contracts 10/10. The primary is therefore the most reliable model and
// the reviewer is a DIFFERENT model family, so a review is an independent
// second reading instead of the same model agreeing with itself.
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
  /** Explicit primary model (callers historically passed it as the "deep" model). */
  deep_model?: string | null;
  provider_override?: AiProviderConfig | null;
};

export type SemanticAuthorityV3Tier =
  | "primary"
  | "reviewed"
  | "primary_unreviewed"
  | "fallback"
  | "unavailable";

export type SemanticAuthorityV3Outcome = SemanticInterpreterV3Outcome & {
  tier: SemanticAuthorityV3Tier;
  review_required: boolean;
  review_match: boolean | null;
  review_reasons: string[];
};

export function semanticPrimaryModel(explicit?: string | null): string {
  return String(
    explicit
      ?? envValue("NINO_SEMANTIC_PRIMARY_MODEL")
      ?? envValue("NINO_AI_MODEL")
      ?? "openai/gpt-oss-120b",
  ).trim();
}

export function semanticReviewModel(): string {
  return String(
    envValue("NINO_SEMANTIC_REVIEW_MODEL")
      ?? "qwen/qwen3.8-27b",
  ).trim();
}

/**
 * Review is selected from the STRUCTURED meaning, never from lexical rules.
 * Writes, compound turns, advisory reasoning and contextual references carry
 * more consequence/ambiguity and therefore get an independent second reading.
 */
export function requiresDeepSemanticReview(turn: TurnSpecV3): boolean {
  if (turn.kind !== "task") return false;
  if (turn.tasks.length > 1) return true;
  if (turn.references.length > 0) return true;
  return turn.tasks.some((task) => task.kind === "financial_write" || task.kind === "advisory");
}

function proposesWrite(turn: TurnSpecV3 | null): boolean {
  return !!turn && turn.kind === "task" && turn.tasks.some((task) => task.kind === "financial_write");
}

function aggregateTelemetry(
  first: SemanticInterpreterV3Telemetry,
  second: SemanticInterpreterV3Telemetry,
  ok: boolean,
  error: string | null,
): SemanticInterpreterV3Telemetry {
  return {
    model: `${first.model}->${second.model}`.slice(0, 180),
    provider: first.provider ?? second.provider,
    llm_calls: Number(first.llm_calls ?? 0) + Number(second.llm_calls ?? 0),
    tokens_in: Number(first.tokens_in ?? 0) + Number(second.tokens_in ?? 0),
    tokens_out: Number(first.tokens_out ?? 0) + Number(second.tokens_out ?? 0),
    latency_ms: Number(first.latency_ms ?? 0) + Number(second.latency_ms ?? 0),
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
  const primaryModel = semanticPrimaryModel(input.deep_model);
  const reviewModel = semanticReviewModel();
  const distinctReviewer = !!reviewModel && reviewModel !== primaryModel;
  const interpret = (model: string) => interpretSemanticTurnV3({
    text: input.text,
    history_text: input.history_text,
    context_text: input.context_text,
    model,
    provider_override: input.provider_override ?? null,
  });

  const primaryPromise = interpret(primaryModel);
  // Latency: the independent reading is started speculatively alongside the
  // primary. Consequential turns wait for max(primary, review) instead of the
  // sum, and a primary failure has its fallback ready without a second wait.
  // Non-consequential turns simply ignore the speculative result.
  const speculativeReview = distinctReviewer && envValue("NINO_SEMANTIC_SPECULATIVE_REVIEW") !== "false"
    ? interpret(reviewModel).catch((error) => ({
      turn: null,
      violations: [],
      telemetry: {
        model: reviewModel, provider: null, llm_calls: 1, tokens_in: 0, tokens_out: 0, latency_ms: 0,
        ok: false, error: `review_exception:${String((error as Error)?.message ?? error).slice(0, 80)}`,
      },
    } as SemanticInterpreterV3Outcome))
    : null;
  const reviewOnce = () => speculativeReview ?? interpret(reviewModel);

  const primary = await primaryPromise;

  // Primary unavailable/invalid: change MODEL, not semantics. The reviewer
  // emits the same strict TurnSpecV3 and is subject to the same invariants.
  if (!primary.turn) {
    if (!distinctReviewer) {
      return unavailable(primary, null, String(primary.telemetry.error ?? "semantic_authority_unavailable"));
    }
    const fallback = await reviewOnce();
    if (!fallback.turn) {
      return unavailable(
        primary,
        fallback,
        `semantic_tiers_unavailable:${String(primary.telemetry.error ?? "primary")}:${String(fallback.telemetry.error ?? "review")}`.slice(0, 220),
      );
    }
    return {
      ...fallback,
      telemetry: aggregateTelemetry(primary.telemetry, fallback.telemetry, true, null),
      tier: "fallback",
      review_required: requiresDeepSemanticReview(fallback.turn),
      review_match: null,
      review_reasons: [],
    };
  }

  const reviewRequired = requiresDeepSemanticReview(primary.turn);
  if (!reviewRequired || !distinctReviewer) {
    return {
      ...primary,
      tier: "primary",
      review_required: reviewRequired,
      review_match: null,
      review_reasons: [],
    };
  }

  const review = await reviewOnce();
  if (!review.turn) {
    // A reviewer that cannot produce a valid contract gives no second opinion;
    // it is not evidence against the primary reading. Writes remain gated by
    // the explicit user confirmation of the resulting draft.
    return {
      ...primary,
      telemetry: aggregateTelemetry(primary.telemetry, review.telemetry, true, null),
      tier: "primary_unreviewed",
      review_required: true,
      review_match: null,
      review_reasons: [`review_unavailable:${String(review.telemetry.error ?? "unknown")}`.slice(0, 120)],
    };
  }

  const comparison = compareSemanticSignaturesV3(
    semanticSignatureV3(primary.turn),
    semanticSignatureV3(review.turn),
  );
  if (comparison.semantic_match) {
    return {
      ...primary,
      telemetry: aggregateTelemetry(primary.telemetry, review.telemetry, true, null),
      tier: "reviewed",
      review_required: true,
      review_match: true,
      review_reasons: [],
    };
  }

  // Writes are consequential: they execute only when both readings agree.
  if (proposesWrite(primary.turn) || proposesWrite(review.turn)) {
    return {
      turn: null,
      telemetry: aggregateTelemetry(primary.telemetry, review.telemetry, false, "semantic_tier_disagreement"),
      violations: comparison.divergence_reasons,
      tier: "unavailable",
      review_required: true,
      review_match: false,
      review_reasons: comparison.divergence_reasons,
    };
  }

  // Read/advice turns cannot mutate anything and still pass grounding and the
  // contract fulfillment gate; the primary (strongest) reading is used.
  return {
    ...primary,
    telemetry: aggregateTelemetry(primary.telemetry, review.telemetry, true, null),
    tier: "reviewed",
    review_required: true,
    review_match: false,
    review_reasons: comparison.divergence_reasons,
  };
}
