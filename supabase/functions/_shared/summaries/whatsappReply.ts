// Gancho leve do webhook: reconhece pedidos/comandos de resumo e responde. A geração do PDF roda na
// função `financial-summaries-dispatch` (o webhook não carrega o motor nem as fontes).
// Fail-closed: flag desligada, dúvida ou erro → null e a conversa segue para o agente, como antes.
// deno-lint-ignore-file no-explicit-any
import { today as civilToday } from "../finance-core/ninoClock.ts";
import { parseSummaryIntent } from "./intents.ts";

export interface SummaryReply { action: string; reply: string | null }

export async function handleSummaryReply(sb: any, args: { userId: string; text: string; inboundMessageId: string; supabaseUrl: string; serviceRole: string; now?: Date }): Promise<SummaryReply | null> {
  const { data: flag } = await sb.from("financial_feature_flags").select("use_whatsapp_pdf_summaries").eq("user_id", args.userId).maybeSingle();
  if (flag?.use_whatsapp_pdf_summaries !== true) return null;
  const { data: prefs } = await sb.from("notification_preferences").select("report_timezone").eq("user_id", args.userId).maybeSingle();
  const tz = prefs?.report_timezone ?? "America/Sao_Paulo";
  const today = civilToday({ timezone: tz }, args.now);
  const intent = parseSummaryIntent(args.text, today);
  if (!intent) return null;

  if (intent.kind === "clarify") return { action: "summary_clarify", reply: intent.question };
  if (intent.kind === "prefs") {
    const patch: Record<string, unknown> = { user_id: args.userId, updated_at: new Date().toISOString() };
    const at = new Date().toISOString();
    if (intent.weekly !== undefined) { patch.weekly_report_enabled = intent.weekly; if (intent.weekly) { patch.weekly_summary_opt_in_at = at; patch.weekly_summary_opt_in_origin = "whatsapp"; } }
    if (intent.monthly !== undefined) { patch.monthly_report_enabled = intent.monthly; if (intent.monthly) { patch.monthly_summary_opt_in_at = at; patch.monthly_summary_opt_in_origin = "whatsapp"; } }
    if (intent.hour !== undefined) patch.summary_hour = intent.hour;
    const { error } = await sb.from("notification_preferences").upsert(patch, { onConflict: "user_id" });
    if (error) return { action: "summary_prefs_failed", reply: "Não consegui salvar agora. Tente de novo em alguns minutos." };
    return { action: "summary_prefs", reply: intent.reply };
  }

  const body = intent.kind === "resend"
    ? { mode: "resend", user_id: args.userId, inbound_message_id: args.inboundMessageId }
    : { mode: "request", user_id: args.userId, inbound_message_id: args.inboundMessageId, summary_type: intent.type, week_start: intent.type === "weekly" ? intent.weekStart : undefined, month: intent.type === "monthly" ? intent.month : undefined };
  try {
    const r = await fetch(`${args.supabaseUrl}/functions/v1/financial-summaries-dispatch`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.serviceRole}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && j?.queued) return { action: `summary_${body.mode}`, reply: null };
    if (j?.reason === "nothing_to_resend") return { action: "summary_resend_none", reply: "Ainda não há um resumo enviado para reenviar. Peça \"resumo da semana\" ou \"resumo do mês\"." };
    return { action: "summary_failed", reply: "Não consegui gerar seu resumo agora. Tente de novo em alguns minutos." };
  } catch {
    return { action: "summary_failed", reply: "Não consegui gerar seu resumo agora. Tente de novo em alguns minutos." };
  }
}
