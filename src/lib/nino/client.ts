import { supabase } from "@/integrations/supabase/client";
import {
  normalizeNinoContext,
  type NinoContext,
  type ProactivePreferences,
} from "./contracts";

type RpcError = { message?: string; code?: string } | null;
type RpcResponse = Promise<{ data: unknown; error: RpcError }>;

const untypedRpc = (
  supabase as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => RpcResponse;
  }
).rpc.bind(supabase);

function fail(error: RpcError, fallback: string): never {
  const suffix = error?.code ? ` [${error.code}]` : "";
  throw new Error(`${error?.message || fallback}${suffix}`);
}

export async function loadNinoContext(): Promise<NinoContext> {
  const { data, error } = await untypedRpc("my_nino_context");
  if (error) fail(error, "Não foi possível carregar o contexto do Nino.");
  return normalizeNinoContext(data);
}

export async function updateNinoMemory(args: {
  id: string;
  value: Record<string, unknown>;
  expiresAt?: string | null;
}): Promise<void> {
  const { error } = await untypedRpc("my_nino_memory_update", {
    _memory_id: args.id,
    _value: args.value,
    _expires_at: args.expiresAt ?? null,
  });
  if (error) fail(error, "Não foi possível corrigir esta memória.");
}

export async function deleteNinoMemory(id: string): Promise<void> {
  const { error } = await untypedRpc("my_nino_memory_delete", {
    _memory_id: id,
  });
  if (error) fail(error, "Não foi possível apagar esta memória.");
}

export async function sendHypothesisFeedback(args: {
  id: string;
  verdict: "confirmed" | "partial" | "rejected";
  feedback?: string;
}): Promise<void> {
  const { error } = await untypedRpc("my_behavior_hypothesis_feedback", {
    _hypothesis_id: args.id,
    _verdict: args.verdict,
    _feedback: args.feedback ?? null,
  });
  if (error) fail(error, "Não foi possível registrar sua resposta.");
}

export async function updateAdvisorAction(args: {
  reviewId: string;
  actionKey: string;
  status: "pending" | "in_progress" | "done" | "dismissed";
}): Promise<void> {
  const { error } = await untypedRpc("my_advisor_action_feedback", {
    _review_id: args.reviewId,
    _action_key: args.actionKey,
    _status: args.status,
  });
  if (error) fail(error, "Não foi possível atualizar esta ação.");
}

export async function updateProactivePreferences(
  current: ProactivePreferences,
  patch: Partial<ProactivePreferences>,
): Promise<void> {
  const next = { ...current, ...patch };
  const { error } = await untypedRpc("my_proactive_preferences_update", {
    _max_per_day: next.max_proactive_per_day,
    _whatsapp: next.whatsapp_proactive,
    _muted: next.muted_proactive_kinds,
    _financial: next.proactive_financial,
    _emotional: next.emotional_checkin,
    _smart_tips: next.smart_tips,
  });
  if (error) fail(error, "Não foi possível salvar as preferências.");
}

export async function sendCommunicationFeedback(
  id: string,
  feedback: "useful" | "not_useful" | "dismissed",
): Promise<void> {
  const { error } = await untypedRpc("my_communication_feedback", {
    _delivery_id: id,
    _feedback: feedback,
  });
  if (error) fail(error, "Não foi possível registrar o feedback.");
}

export type AdvisorReadiness = {
  eligible: boolean;
  transactions_90d: number;
  months_observed: number;
  missing: string[];
  weekly_last_generated_at: string | null;
  monthly_last_generated_at: string | null;
};

export async function loadAdvisorReadiness(): Promise<AdvisorReadiness> {
  const { data, error } = await untypedRpc("my_advisor_readiness");
  if (error) fail(error, "Não foi possível verificar sua revisão.");
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    eligible: raw.eligible === true,
    transactions_90d: Number(raw.transactions_90d ?? 0),
    months_observed: Number(raw.months_observed ?? 0),
    missing: Array.isArray(raw.missing) ? raw.missing.map(String) : [],
    weekly_last_generated_at: (raw.weekly_last_generated_at as string | null) ?? null,
    monthly_last_generated_at: (raw.monthly_last_generated_at as string | null) ?? null,
  };
}

/** Gera revisão/insights sob demanda apenas para o próprio usuário (canal app). */
export async function requestNinoRefresh(): Promise<void> {
  const { error } = await supabase.functions.invoke("agent-proactive-tick", {
    body: { self: true, only: ["profile", "behavior", "advisor", "proactive"] },
  });
  if (error) throw new Error(error.message || "Não foi possível atualizar agora.");
}

export async function sendTipFeedback(
  insightId: string,
  feedback: "useful" | "not_useful" | "dismissed" | "acted",
): Promise<void> {
  const { error } = await untypedRpc("my_tip_feedback", {
    _insight_id: insightId,
    _feedback: feedback,
  });
  if (error) fail(error, "Não foi possível registrar o feedback.");
}
