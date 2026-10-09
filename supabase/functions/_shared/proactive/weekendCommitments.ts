// nino_weekend_commitments.v1 — combinado do fim de semana ("topo") e "detalhes".
//
// Ciclo: sexta oferece o limite → a pessoa responde "topo" no WhatsApp → o Nino
// grava o combinado → segunda o fechamento mede o gasto real contra ele.
// A resposta é tratada ANTES do agente, mas só quando existe uma oferta aberta:
// sem oferta, "topo" ou "detalhes" seguem para o agente como qualquer mensagem.
// deno-lint-ignore-file no-explicit-any
import { money0, type WeekendOffer } from "./weekendMessages.ts";

type SupabaseClient = any;

export const WEEKEND_COMMITMENTS_VERSION = "nino_weekend_commitments.v1";

/** Sexta → segunda (e uma folga): depois disso a oferta já não vale. */
export const WEEKEND_OFFER_TTL_DAYS = 4;

export type WeekendReplyAction = "accept" | "details";

function normalizeReply(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Respostas curtas e inequívocas ao convite da sexta. */
export function matchWeekendReply(text: string): WeekendReplyAction | null {
  const t = normalizeReply(text);
  if (!t || t.length > 40) return null;
  if (/^(eu )?topo( sim)?( tentar)?$|^bora( tentar)?$|^vamos tentar$|^aceito$|^combinado$|^fechado$/.test(t)) return "accept";
  if (/^(ver )?detalhes$|^(quero|me mostra|mostra)( ver)?( os)? detalhes$/.test(t)) return "details";
  return null;
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Data civil de São Paulo. */
export function saoPauloDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Grava a oferta da sexta (idempotente: não reescreve um combinado já aceito). */
export async function persistWeekendOffer(
  sb: SupabaseClient,
  userId: string,
  args: { friday: string; category: string; offer: WeekendOffer | null; detail: string },
): Promise<void> {
  const { offer } = args;
  await sb.from("weekend_commitments").upsert({
    user_id: userId,
    friday: args.friday,
    category: args.category,
    status: offer ? "offered" : "info",
    target_amount: offer?.target ?? null,
    expected_amount: offer?.expected ?? null,
    projected_before: offer?.projected_before ?? null,
    projected_if_met: offer?.projected_if_target ?? null,
    anchor_kind: offer?.anchor.kind ?? null,
    anchor_amount: offer?.anchor.amount ?? null,
    detail: args.detail,
  }, { onConflict: "user_id,friday,category", ignoreDuplicates: true });
}

/** Categorias em que a pessoa já decidiu (aceitou ou recusou) para a sexta `friday`, por exemplo na tela de hábitos. */
export async function loadDecidedWeekendCategories(sb: SupabaseClient, userId: string, friday: string): Promise<Set<string>> {
  const { data } = await sb.from("weekend_commitments").select("category")
    .eq("user_id", userId).eq("friday", friday).in("status", ["accepted", "declined"]).limit(20);
  return new Set(((data as any[]) ?? []).map((r) => String(r.category)));
}

/** Combinados aceitos para a sexta `friday`, por categoria. */
export async function loadAcceptedCommitments(
  sb: SupabaseClient,
  userId: string,
  friday: string,
): Promise<Record<string, { target_amount: number }>> {
  const { data } = await sb.from("weekend_commitments")
    .select("category,target_amount,status")
    .eq("user_id", userId).eq("friday", friday).in("status", ["accepted", "kept", "missed"])
    .not("target_amount", "is", null).limit(10);
  const out: Record<string, { target_amount: number }> = {};
  for (const row of ((data as any[]) ?? [])) out[String(row.category)] = { target_amount: Number(row.target_amount) };
  return out;
}

/** Resultado medido no fechamento de segunda. */
export async function recordCommitmentOutcomes(
  sb: SupabaseClient,
  userId: string,
  outcomes: Array<{ category: string; friday: string; realized: number; kept: boolean | null }>,
): Promise<void> {
  for (const o of outcomes) {
    if (o.kept == null) continue;
    await sb.from("weekend_commitments").update({
      status: o.kept ? "kept" : "missed",
      realized_amount: o.realized,
      evaluated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("friday", o.friday).eq("category", o.category).eq("status", "accepted");
  }
}

/**
 * Responde "topo" / "detalhes" quando há oferta aberta. Devolve null quando a
 * mensagem não é para este fluxo (o agente segue normalmente).
 */
export async function handleWeekendReply(
  sb: SupabaseClient,
  args: { userId: string; text: string; now?: Date },
): Promise<{ action: WeekendReplyAction; reply: string } | null> {
  const action = matchWeekendReply(args.text);
  if (!action) return null;
  const today = saoPauloDate(args.now ?? new Date());
  const since = addDays(today, -WEEKEND_OFFER_TTL_DAYS);
  const { data } = await sb.from("weekend_commitments")
    .select("id,friday,category,status,target_amount,projected_if_met,detail")
    .eq("user_id", args.userId).gte("friday", since)
    .in("status", ["offered", "accepted", "info"])
    .order("friday", { ascending: false }).order("offered_at", { ascending: false }).limit(5);
  const rows = ((data as any[]) ?? []);
  if (!rows.length) return null;

  if (action === "details") {
    const detail = rows.find((r) => r.detail)?.detail;
    return detail ? { action, reply: String(detail) } : null;
  }

  const open = rows.find((r) => r.status === "offered") ?? rows.find((r) => r.status === "accepted");
  if (!open || open.target_amount == null) return null;
  const target = money0(Number(open.target_amount));
  if (open.status === "accepted") {
    return { action, reply: `Já está combinado ✅ ${open.category} até *${target}* neste fim de semana. Na segunda eu te conto como foi.` };
  }
  const { error } = await sb.from("weekend_commitments")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", open.id).eq("status", "offered");
  if (error) return null;
  const effect = open.projected_if_met != null ? `\n\nSe ficar nisso, o mês fecha em *${money0(Number(open.projected_if_met))}*.` : "";
  return {
    action,
    reply: `🎯 *Combinado!* Neste fim de semana, *${open.category}* até *${target}*.${effect}\n\nNa segunda eu te conto como foi. Boa! 🙌`,
  };
}
