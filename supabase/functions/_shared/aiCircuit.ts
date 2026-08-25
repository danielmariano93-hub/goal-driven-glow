import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { USER_SAFE_MESSAGES } from "./agent/core/UserSafeError.ts";

export type AiBlock = {
  status: 402 | 403;
  requires: "top_up" | "admin_action" | null;
  message: string;
};

export async function getAiBlock(sb: SupabaseClient): Promise<AiBlock | null> {
  const { data } = await sb.from("ai_runtime_circuit")
    .select("status,blocked_status,requires,user_message")
    .eq("circuit_key", "lovable_ai")
    .maybeSingle();
  if (data?.status !== "paused" || (data.blocked_status !== 402 && data.blocked_status !== 403)) return null;
  return {
    status: data.blocked_status,
    requires: data.requires === "top_up" || data.requires === "admin_action" ? data.requires : null,
    message: USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE,
  };
}

export async function pauseAiCircuit(sb: SupabaseClient, status: number, rawBody: string): Promise<AiBlock | null> {
  if (status !== 402 && status !== 403) return null;
  // `user_message` é lido por caminhos que respondem ao usuário: ele nunca
  // pode carregar detalhe de infraestrutura (ver UserSafeError.ts). O motivo
  // técnico fica em `blocked_status`/`requires` para o painel admin.
  let message = USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE;
  let requires: AiBlock["requires"] = status === 402 ? "top_up" : "admin_action";
  try {
    const parsed = JSON.parse(rawBody) as { message?: string; props?: { requires?: string } };
    if (parsed.props?.requires === "top_up" || parsed.props?.requires === "admin_action") requires = parsed.props.requires;
  } catch { /* resposta upstream sem JSON */ }
  await sb.from("ai_runtime_circuit").upsert({
    circuit_key: "lovable_ai", status: "paused", blocked_status: status,
    requires, user_message: message, paused_at: new Date().toISOString(),
  }, { onConflict: "circuit_key" });
  return { status, requires, message };
}

/** Texto para o usuário: neutro, igual para 402 e 403 (ver UserSafeError.ts). */
export function aiBlockReply(_block: AiBlock): string {
  return USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE;
}