import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { USER_SAFE_MESSAGES } from "./agent/core/UserSafeError.ts";

export type AiBlock = {
  status: 402 | 403;
  requires: "top_up" | "admin_action" | null;
  message: string;
};

/**
 * Janela mínima entre sondas de recuperação. Um bloqueio 402/403 continua
 * terminal no turno, mas o circuito NÃO fica pausado para sempre: passada a
 * janela, o próximo turno faz UMA única chamada real de teste. Se ela passar,
 * o circuito reabre sozinho (crédito reposto, limite ampliado, IA reativada);
 * se falhar, `pauseAiCircuit` renova a janela. Nunca há loop.
 */
export const AI_PROBE_BACKOFF_MS = 10 * 60 * 1000;

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

/**
 * Consulta o bloqueio permitindo recuperação automática.
 *
 * Devolve `null` (isto é: "pode chamar a IA") quando o circuito está aberto OU
 * quando a janela de sonda expirou. A reserva da sonda é atômica: o próprio
 * UPDATE condicional garante que apenas UM turno concorrente recebe a permissão
 * e a janela é imediatamente empurrada para frente.
 */
export async function getAiBlockAllowingProbe(
  sb: SupabaseClient,
): Promise<{ block: AiBlock | null; probe: boolean }> {
  const block = await getAiBlock(sb);
  if (!block) return { block: null, probe: false };
  const now = new Date();
  const next = new Date(now.getTime() + AI_PROBE_BACKOFF_MS).toISOString();
  const { data } = await sb.from("ai_runtime_circuit")
    .update({ probe_after: next, last_probe_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("circuit_key", "lovable_ai")
    .eq("status", "paused")
    .or(`probe_after.is.null,probe_after.lte.${now.toISOString()}`)
    .select("circuit_key")
    .maybeSingle();
  if (data?.circuit_key) return { block: null, probe: true };
  return { block, probe: false };
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
  const now = new Date();
  await sb.from("ai_runtime_circuit").upsert({
    circuit_key: "lovable_ai", status: "paused", blocked_status: status,
    requires, user_message: message, paused_at: now.toISOString(),
    // Renova a janela de sonda: a próxima tentativa real só acontece depois.
    probe_after: new Date(now.getTime() + AI_PROBE_BACKOFF_MS).toISOString(),
    resumed_at: null, updated_at: now.toISOString(),
  }, { onConflict: "circuit_key" });
  return { status, requires, message };
}

/**
 * Reabre o circuito depois de uma chamada real bem-sucedida. Idempotente:
 * chamar com o circuito já aberto não muda nada relevante.
 */
export async function resumeAiCircuit(sb: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  await sb.from("ai_runtime_circuit").update({
    status: "open", blocked_status: null, requires: null, user_message: null,
    probe_after: null, resumed_at: now, updated_at: now,
  }).eq("circuit_key", "lovable_ai").eq("status", "paused");
}

/** Texto para o usuário: neutro, igual para 402 e 403 (ver UserSafeError.ts). */
export function aiBlockReply(_block: AiBlock): string {
  return USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE;
}
