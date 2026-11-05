// nino_engagement.v1 — medir se a pessoa reagiu a uma mensagem proativa do WhatsApp.
//
// Antes, `interacted_at` e `acted_at` ficavam vazios em TODAS as entregas: não havia como saber o que funciona (replay de
// 05/11/2026). Aproximação honesta: uma mensagem da pessoa até 2 h depois de uma proativa conta como "respondeu" na
// entrega mais recente ainda sem resposta. Não prova que a resposta foi ao aviso (a pessoa conversa com o Nino por outros
// motivos); é um indício que permite comparar tipos de aviso. A AÇÃO ("topo") é medida à parte e é inequívoca.
// deno-lint-ignore-file no-explicit-any

export const ENGAGEMENT_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Ação ("topo") pode vir bem depois do convite. */
export const ACTION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Tipos cujo convite aceita "topo". */
const ACTIONABLE_KINDS = ["weekend_spending_risk", "weekday_spending_risk"];

export type DeliveryRow = { id: string; kind?: string; delivered_at: string | null; interacted_at?: string | null; acted_at?: string | null };

/** Entrega a creditar com a resposta: a mais recente, dentro da janela, ainda sem resposta. */
export function pickInteractionTarget(rows: DeliveryRow[], now: Date): string | null {
  const t = now.getTime();
  const eligible = rows
    .filter((r) => r.delivered_at && !r.interacted_at)
    .map((r) => ({ id: r.id, at: Date.parse(String(r.delivered_at)) }))
    .filter((r) => Number.isFinite(r.at) && r.at <= t && t - r.at <= ENGAGEMENT_WINDOW_MS)
    .sort((a, b) => b.at - a.at);
  return eligible[0]?.id ?? null;
}

/** Entrega a creditar com a ação: o convite aceitável mais recente, ainda sem ação. */
export function pickActionTarget(rows: DeliveryRow[], now: Date): string | null {
  const t = now.getTime();
  const eligible = rows
    .filter((r) => r.delivered_at && !r.acted_at && ACTIONABLE_KINDS.includes(String(r.kind ?? "")))
    .map((r) => ({ id: r.id, at: Date.parse(String(r.delivered_at)) }))
    .filter((r) => Number.isFinite(r.at) && r.at <= t && t - r.at <= ACTION_WINDOW_MS)
    .sort((a, b) => b.at - a.at);
  return eligible[0]?.id ?? null;
}

async function recentWhatsappDeliveries(sb: any, userId: string, since: Date): Promise<DeliveryRow[]> {
  const { data } = await sb.from("communication_deliveries")
    .select("id,kind,delivered_at,interacted_at,acted_at")
    .eq("user_id", userId).eq("channel", "whatsapp").eq("status", "delivered")
    .gte("delivered_at", since.toISOString())
    .order("delivered_at", { ascending: false }).limit(20);
  return ((data as any[]) ?? []) as DeliveryRow[];
}

/** Chamar a cada mensagem recebida da pessoa. Falha aqui nunca pode afetar a conversa. */
export async function recordInteraction(sb: any, userId: string, now: Date = new Date()): Promise<void> {
  try {
    const rows = await recentWhatsappDeliveries(sb, userId, new Date(now.getTime() - ENGAGEMENT_WINDOW_MS));
    const id = pickInteractionTarget(rows, now);
    if (id) await sb.from("communication_deliveries").update({ interacted_at: now.toISOString() }).eq("id", id).is("interacted_at", null);
  } catch (error) {
    console.warn("[engagement] interaction not recorded", String((error as Error)?.message ?? error).slice(0, 120));
  }
}

/** Chamar quando a pessoa aceita o convite ("topo") ou pede detalhes. */
export async function recordAction(sb: any, userId: string, action: string, now: Date = new Date()): Promise<void> {
  try {
    const rows = await recentWhatsappDeliveries(sb, userId, new Date(now.getTime() - ACTION_WINDOW_MS));
    const id = pickActionTarget(rows, now);
    if (id) {
      await sb.from("communication_deliveries")
        .update({ acted_at: now.toISOString(), action_taken: action, interacted_at: now.toISOString() })
        .eq("id", id).is("acted_at", null);
    }
  } catch (error) {
    console.warn("[engagement] action not recorded", String((error as Error)?.message ?? error).slice(0, 120));
  }
}
