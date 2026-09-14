// ConversationBrainShadow (`nino_conversation_brain.v1`)
//
// Executa SOMENTE a interpretação do Conversation Brain em paralelo ao caminho
// legado. Não chama tools, não cria drafts e não altera verdade financeira.
// O resultado serve para medir paridade antes de tornar a V2 autoritativa.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadHistory, withoutCurrentTurn } from "./ConversationHistory.ts";
import { loadConversationMemory } from "./ConversationMemory.ts";
import { loadWorkflow } from "./WriteWorkflowManager.ts";
import { resolveSession } from "./SessionManager.ts";
import { interpretConversationTurn } from "./ConversationBrain.ts";

export type ShadowInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id?: string | null;
  channel: "app" | "whatsapp" | "simulator" | string;
  text: string;
};

export type LegacyShadowObservation = {
  path?: string | null;
  reply_kind?: string | null;
};

export type ShadowEvaluationResult = {
  ok: boolean;
  brain_mode: string | null;
  brain_act: string | null;
  error: string | null;
};

export async function evaluateConversationBrainShadow(args: {
  sb: SupabaseClient;
  input: ShadowInput;
  legacy?: LegacyShadowObservation | null;
  model: string;
}): Promise<ShadowEvaluationResult> {
  const started = Date.now();
  try {
    const session = await resolveSession(args.sb, {
      user_id: args.input.user_id,
      channel: args.input.channel as any,
      conversation_id: args.input.conversation_id,
    }).catch(() => null as any);
    const sessionId = session?.id as string | undefined;

    const [loadedHistory, memory, workflow] = await Promise.all([
      loadHistory(args.sb, args.input.conversation_id, {
        limit: 12,
        excludeMessageId: args.input.inbound_message_id ?? undefined,
      }).catch(() => []),
      loadConversationMemory(args.sb, sessionId ?? null).catch(() => null),
      loadWorkflow(args.sb, {
        user_id: args.input.user_id,
        conversation_id: args.input.conversation_id,
      }).catch(() => null),
    ]);

    const history = args.input.channel === "app"
      ? loadedHistory
      : withoutCurrentTurn(loadedHistory, args.input.text);

    const brain = await interpretConversationTurn({
      text: args.input.text,
      history,
      memory,
      workflow,
      model: args.model,
      sb: args.sb,
      user_id: args.input.user_id,
      run_id: null,
    });

    const contract = brain.contract;
    await args.sb.from("conversation_brain_shadow_evaluations").insert({
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      inbound_message_id: args.input.inbound_message_id ?? null,
      brain_act: contract?.act ?? null,
      brain_mode: contract?.mode ?? null,
      brain_canonical_request: contract?.canonical_request ?? null,
      brain_focus: contract?.focus ?? {},
      brain_action: contract?.action ?? null,
      brain_confidence: contract?.confidence ?? null,
      brain_latency_ms: brain.telemetry.latency_ms ?? (Date.now() - started),
      tokens_in: brain.telemetry.tokens_in ?? 0,
      tokens_out: brain.telemetry.tokens_out ?? 0,
      legacy_path: args.legacy?.path ?? null,
      legacy_reply_kind: args.legacy?.reply_kind ?? null,
      status: contract ? "ok" : "brain_error",
      error_code: brain.telemetry.error ?? null,
    }).catch(() => ({ error: null } as any));

    return {
      ok: Boolean(contract),
      brain_mode: contract?.mode ?? null,
      brain_act: contract?.act ?? null,
      error: brain.telemetry.error ?? null,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 180) : "shadow_unknown_error";
    await args.sb.from("conversation_brain_shadow_evaluations").insert({
      user_id: args.input.user_id,
      conversation_id: args.input.conversation_id,
      inbound_message_id: args.input.inbound_message_id ?? null,
      brain_focus: {},
      brain_latency_ms: Date.now() - started,
      tokens_in: 0,
      tokens_out: 0,
      legacy_path: args.legacy?.path ?? null,
      legacy_reply_kind: args.legacy?.reply_kind ?? null,
      status: "brain_error",
      error_code: code,
    }).catch(() => ({ error: null } as any));
    return { ok: false, brain_mode: null, brain_act: null, error: code };
  }
}

/** Completa a linha shadow depois que o caminho legado termina. */
export async function attachLegacyShadowObservation(args: {
  sb: SupabaseClient;
  input: ShadowInput;
  legacy: LegacyShadowObservation;
}): Promise<void> {
  const inbound = args.input.inbound_message_id ?? null;
  if (!inbound) return;
  await args.sb.from("conversation_brain_shadow_evaluations")
    .update({
      legacy_path: args.legacy.path ?? null,
      legacy_reply_kind: args.legacy.reply_kind ?? null,
    })
    .eq("user_id", args.input.user_id)
    .eq("conversation_id", args.input.conversation_id)
    .eq("inbound_message_id", inbound)
    .order("created_at", { ascending: false })
    .limit(1)
    .catch(() => ({ error: null } as any));
}
