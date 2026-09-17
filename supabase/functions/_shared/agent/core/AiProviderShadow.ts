// AiProviderShadow (`nino_ai_provider_shadow.v1`)
//
// Benchmarks an alternative AI provider against the authoritative Conversation
// Brain contract without changing the user-visible answer or executing tools.
// This path is intentionally telemetry-only and can be enabled per rollout flag.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveAiProvider, type AiProviderName } from "../../ai-runtime.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { WriteWorkflow } from "./WriteWorkflowManager.ts";
import { interpretConversationTurn, type ConversationTurnContract } from "./ConversationBrain.ts";
import { isEnabled } from "./FeatureFlags.ts";

export type ProviderShadowInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id?: string | null;
  text: string;
};

type HistoryTurn = { role: "user" | "assistant"; content: string; created_at?: string };

function env(name: string): string {
  return String((globalThis as any).Deno?.env?.get(name) ?? "").trim();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function actionKind(contract: ConversationTurnContract | null): string | null {
  return contract?.action?.action ?? null;
}

async function writeRow(sb: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  try {
    await sb.from("ai_provider_shadow_evaluations").insert(row);
  } catch (error) {
    console.warn("[ai-provider-shadow] telemetry insert failed", error);
  }
}

async function evaluate(args: {
  sb: SupabaseClient;
  input: ProviderShadowInput;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  official_contract: ConversationTurnContract;
  official_model: string;
  official_latency_ms: number;
}): Promise<void> {
  const requestedProvider = env("NINO_SHADOW_AI_PROVIDER").toLowerCase();
  const requestedModel = env("NINO_SHADOW_AI_MODEL");
  const officialProvider = resolveAiProvider()?.provider ?? "lovable";

  if (!requestedProvider || !requestedModel) {
    await writeRow(args.sb, {
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      inbound_message_id: args.input.inbound_message_id ?? null,
      official_provider: officialProvider,
      official_model: args.official_model,
      shadow_provider: requestedProvider || "unconfigured",
      shadow_model: requestedModel || "unconfigured",
      official_act: args.official_contract.act,
      official_mode: args.official_contract.mode,
      official_canonical_request: args.official_contract.canonical_request,
      official_focus: args.official_contract.focus,
      official_action: args.official_contract.action,
      official_confidence: args.official_contract.confidence,
      official_latency_ms: args.official_latency_ms,
      status: "not_configured",
      error_code: "shadow_provider_not_configured",
    });
    return;
  }

  if (!["groq", "openrouter"].includes(requestedProvider)) {
    await writeRow(args.sb, {
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      inbound_message_id: args.input.inbound_message_id ?? null,
      official_provider: officialProvider,
      official_model: args.official_model,
      shadow_provider: requestedProvider,
      shadow_model: requestedModel,
      official_act: args.official_contract.act,
      official_mode: args.official_contract.mode,
      official_canonical_request: args.official_contract.canonical_request,
      official_focus: args.official_contract.focus,
      official_action: args.official_contract.action,
      official_confidence: args.official_contract.confidence,
      official_latency_ms: args.official_latency_ms,
      status: "shadow_error",
      error_code: "unsupported_shadow_provider",
    });
    return;
  }

  const shadowProvider = resolveAiProvider(undefined, {
    provider: requestedProvider as AiProviderName,
    model: requestedModel,
  });
  if (!shadowProvider) {
    await writeRow(args.sb, {
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      inbound_message_id: args.input.inbound_message_id ?? null,
      official_provider: officialProvider,
      official_model: args.official_model,
      shadow_provider: requestedProvider,
      shadow_model: requestedModel,
      official_act: args.official_contract.act,
      official_mode: args.official_contract.mode,
      official_canonical_request: args.official_contract.canonical_request,
      official_focus: args.official_contract.focus,
      official_action: args.official_contract.action,
      official_confidence: args.official_contract.confidence,
      official_latency_ms: args.official_latency_ms,
      status: "not_configured",
      error_code: "shadow_provider_key_missing",
    });
    return;
  }

  const shadow = await interpretConversationTurn({
    text: args.input.text,
    history: args.history,
    memory: args.memory,
    workflow: args.workflow,
    model: requestedModel,
    provider_override: shadowProvider,
    // Deliberately omit sb/run_id: provider-shadow usage belongs to its own
    // evaluation ledger and must not be mistaken for the authoritative AI path.
  });

  const candidate = shadow.contract;
  const official = args.official_contract;
  await writeRow(args.sb, {
    user_id: args.input.user_id,
    conversation_id: args.input.conversation_id,
    inbound_message_id: args.input.inbound_message_id ?? null,
    official_provider: officialProvider,
    official_model: args.official_model,
    shadow_provider: shadowProvider.provider,
    shadow_model: shadow.telemetry.model || requestedModel,
    official_act: official.act,
    official_mode: official.mode,
    official_canonical_request: official.canonical_request,
    official_focus: official.focus,
    official_action: official.action,
    official_confidence: official.confidence,
    shadow_act: candidate?.act ?? null,
    shadow_mode: candidate?.mode ?? null,
    shadow_canonical_request: candidate?.canonical_request ?? null,
    shadow_focus: candidate?.focus ?? {},
    shadow_action: candidate?.action ?? null,
    shadow_confidence: candidate?.confidence ?? null,
    same_act: candidate ? candidate.act === official.act : null,
    same_mode: candidate ? candidate.mode === official.mode : null,
    same_canonical_request: candidate
      ? normalizeText(candidate.canonical_request) === normalizeText(official.canonical_request)
      : null,
    same_focus: candidate ? stableJson(candidate.focus) === stableJson(official.focus) : null,
    same_action_kind: candidate ? actionKind(candidate) === actionKind(official) : null,
    official_latency_ms: args.official_latency_ms,
    shadow_latency_ms: shadow.telemetry.latency_ms,
    shadow_tokens_in: shadow.telemetry.tokens_in,
    shadow_tokens_out: shadow.telemetry.tokens_out,
    status: candidate ? "ok" : "shadow_error",
    error_code: shadow.telemetry.error ?? null,
  });
}

export async function scheduleAiProviderShadow(args: {
  sb: SupabaseClient;
  input: ProviderShadowInput;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  official_contract: ConversationTurnContract;
  official_model: string;
  official_latency_ms: number;
}): Promise<void> {
  const enabled = await isEnabled("ai_provider_shadow_v1", args.input.user_id);
  if (!enabled) return;

  const work = evaluate(args).catch((error) => {
    console.warn("[ai-provider-shadow] evaluation failed", error);
  });

  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
    edgeRuntime.waitUntil(work);
  } else {
    // Local/tests: do not block the authoritative answer, but keep the promise
    // handled so shadow failures never escape into the user path.
    work.catch(() => undefined);
  }
}
