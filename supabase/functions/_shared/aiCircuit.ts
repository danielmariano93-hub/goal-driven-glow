import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    message: String(data.user_message ?? "A inteligência do Nino está temporariamente indisponível."),
  };
}

export async function pauseAiCircuit(sb: SupabaseClient, status: number, rawBody: string): Promise<AiBlock | null> {
  if (status !== 402 && status !== 403) return null;
  let message = status === 402
    ? "A inteligência do Nino está temporariamente sem créditos. O responsável pelo app precisa adicionar créditos para reativá-la."
    : "A inteligência do Nino foi bloqueada por uma configuração administrativa. O responsável pelo app precisa reativá-la.";
  let requires: AiBlock["requires"] = status === 402 ? "top_up" : "admin_action";
  try {
    const parsed = JSON.parse(rawBody) as { message?: string; props?: { requires?: string } };
    if (parsed.message) message = String(parsed.message).slice(0, 500);
    if (parsed.props?.requires === "top_up" || parsed.props?.requires === "admin_action") requires = parsed.props.requires;
  } catch { /* resposta upstream sem JSON */ }
  await sb.from("ai_runtime_circuit").upsert({
    circuit_key: "lovable_ai", status: "paused", blocked_status: status,
    requires, user_message: message, paused_at: new Date().toISOString(),
  }, { onConflict: "circuit_key" });
  return { status, requires, message };
}

export function aiBlockReply(block: AiBlock): string {
  return block.status === 402
    ? "Minha inteligência está temporariamente indisponível porque os créditos do app acabaram. O responsável já pode reativar adicionando créditos. Seus dados continuam seguros e nada foi alterado."
    : "Minha inteligência está temporariamente bloqueada por uma configuração administrativa. O responsável pelo app precisa reativá-la. Seus dados continuam seguros e nada foi alterado.";
}