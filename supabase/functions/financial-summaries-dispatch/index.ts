// Resumos financeiros em PDF (semanal e mensal) pelo WhatsApp.
//   - cron    : a cada hora; para quem tem a flag ligada, o opt-in do tipo e o WhatsApp ativo, gera e enfileira
//               o semanal (segunda) e o mensal (dia 2) no horário escolhido (padrão 8h, fuso do usuário).
//               Também apaga PDFs com mais de 30 dias.
//   - request : pedido pelo WhatsApp (resumo da semana, última semana, mês, fechamento de outubro).
//   - resend  : reenvia o último PDF gerado.
//   - preview : gera e guarda o PDF sem enviar; devolve link assinado curto (piloto/inspeção).
// Só service role ou x-cron-secret. Nada é enviado para quem não tem `use_whatsapp_pdf_summaries`.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { safeEqual } from "../_shared/security/secrets.ts";
import { today as civilToday } from "../_shared/finance-core/ninoClock.ts";
import { mondayOf, addDays, shiftMonth } from "../_shared/summaries/format.ts";
import { produceSummary, queueWhatsappSummary, summariesEnabled, SUMMARY_BUCKET, SIGNED_URL_TTL_S, type SummaryPeriod, type Produced } from "../_shared/summaries/pipeline.ts";
import type { SummaryDTO } from "../_shared/summaries/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const log = (e: Record<string, unknown>) => console.log(JSON.stringify({ fn: "financial-summaries-dispatch", ...e }));

function localClock(tz: string, now: Date): { date: string; hour: number; dow: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date, hour: Number(g("hour")) % 24, dow, day: Number(g("day")) };
}

const dtoBrief = (dto: SummaryDTO) => ({ type: dto.type, period_start: dto.period_start, period_end_exclusive: dto.period_end_exclusive, as_of: dto.as_of, is_partial: dto.is_partial, insight: dto.insight.rule_id, action: dto.action.rule_id, quality_flags: dto.quality_flags });

async function purgeExpired(sb: any): Promise<number> {
  const { data } = await sb.from("financial_summary_deliveries").select("id,storage_path").lt("expires_at", new Date().toISOString()).not("storage_path", "is", null).limit(200);
  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
  if (!rows.length) return 0;
  await sb.storage.from(SUMMARY_BUCKET).remove(rows.map((r) => r.storage_path));
  for (const r of rows) await sb.from("financial_summary_deliveries").update({ storage_path: null, metadata: { purged_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", r.id);
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const isService = (req.headers.get("Authorization") ?? "") === `Bearer ${SERVICE_ROLE}`;
  const isCron = !!CRON_SECRET && safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET);
  if (!isService && !isCron) return respond({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestId = crypto.randomUUID();
  const mode = String(body.mode ?? "cron");

  if (mode === "cron") {
    const now = new Date();
    let queued = 0; let failed = 0; let skipped = 0;
    const { data: flags } = await sb.from("financial_feature_flags").select("user_id").eq("use_whatsapp_pdf_summaries", true).limit(1000);
    for (const f of (flags ?? []) as Array<{ user_id: string }>) {
      const { data: p } = await sb.from("notification_preferences").select("weekly_report_enabled,monthly_report_enabled,report_channel,report_timezone,summary_hour,weekly_summary_opt_in_at,monthly_summary_opt_in_at").eq("user_id", f.user_id).maybeSingle();
      if (!p || (p.report_channel !== "whatsapp" && p.report_channel !== "both")) { skipped++; continue; }
      const tz = p.report_timezone ?? "America/Sao_Paulo";
      const c = localClock(tz, now);
      if (c.hour !== (p.summary_hour ?? 8)) continue;
      const due: SummaryPeriod[] = [];
      if (c.dow === 1 && p.weekly_report_enabled && p.weekly_summary_opt_in_at) due.push({ type: "weekly", weekStart: addDays(mondayOf(c.date), -7) });
      if (c.day === 2 && p.monthly_report_enabled && p.monthly_summary_opt_in_at) due.push({ type: "monthly", month: shiftMonth(c.date.slice(0, 7), -1) });
      for (const period of due) {
        try {
          const prod = await produceSummary(sb, { userId: f.user_id, period, origin: "schedule", channel: "whatsapp", requestId, timezone: tz, now });
          // Agendado e já enviado (mesma chave): não manda de novo.
          if (prod.reused) { skipped++; continue; }
          const q = await queueWhatsappSummary(sb, prod, { userId: f.user_id, requestId });
          if (q.outboundId) queued++; else skipped++;
          log({ event: "scheduled_summary", user_id: f.user_id, delivery_id: prod.deliveryId, ...dtoBrief(prod.dto), size: prod.sizeBytes });
        } catch (e) {
          failed++;
          log({ event: "scheduled_summary_error", user_id: f.user_id, period, err: String((e as Error).message).slice(0, 200) });
        }
      }
    }
    const purged = await purgeExpired(sb).catch(() => 0);
    await writeJobHeartbeat({ jobKey: "financial-summaries-dispatch", ok: failed === 0, processed: queued, failed, sb });
    return respond({ ok: true, queued, failed, skipped, purged });
  }

  const userId = String(body.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return respond({ ok: false, error: "invalid_user" }, 400);
  const { data: prefs } = await sb.from("notification_preferences").select("report_timezone").eq("user_id", userId).maybeSingle();
  const tz = prefs?.report_timezone ?? "America/Sao_Paulo";
  const today = civilToday({ timezone: tz });

  if (mode === "resend") {
    if (!(await summariesEnabled(sb, userId))) return respond({ ok: false, reason: "flag_off" }, 403);
    const { data: last } = await sb.from("financial_summary_deliveries").select("id,summary_type,period_start,period_end_exclusive,as_of,is_partial,storage_path,template_version")
      .eq("user_id", userId).not("storage_path", "is", null).in("status", ["sending", "accepted", "delivered", "validated", "failed_retryable"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) return respond({ ok: false, reason: "nothing_to_resend" });
    const dto = { type: last.summary_type, period_start: last.period_start, period_end_exclusive: last.period_end_exclusive, as_of: last.as_of, is_partial: last.is_partial, template_version: last.template_version } as SummaryDTO;
    const prod: Produced = { deliveryId: last.id, dto, storagePath: last.storage_path, sizeBytes: 0, sha256: "", reused: true };
    const q = await queueWhatsappSummary(sb, prod, { userId, requestId, inboundMessageId: body.inbound_message_id ?? null });
    log({ event: "resend_summary", user_id: userId, delivery_id: last.id, queued: !!q.outboundId });
    return respond({ ok: !!q.outboundId, queued: !!q.outboundId, reason: q.skipped ?? null });
  }

  const type = body.summary_type === "monthly" ? "monthly" : "weekly";
  const period: SummaryPeriod = type === "weekly"
    ? { type, weekStart: /^\d{4}-\d{2}-\d{2}$/.test(String(body.week_start ?? "")) ? mondayOf(String(body.week_start)) : mondayOf(today) }
    : { type, month: /^\d{4}-\d{2}$/.test(String(body.month ?? "")) ? String(body.month) : today.slice(0, 7) };
  if ((period.type === "weekly" && period.weekStart > today) || (period.type === "monthly" && period.month > today.slice(0, 7))) return respond({ ok: false, error: "future_period" }, 400);

  if (mode === "preview") {
    const prod = await produceSummary(sb, { userId, period, origin: "preview", channel: "none", requestId, timezone: tz });
    const signed = await sb.storage.from(SUMMARY_BUCKET).createSignedUrl(prod.storagePath, SIGNED_URL_TTL_S);
    return respond({ ok: true, delivery_id: prod.deliveryId, size_bytes: prod.sizeBytes, sha256: prod.sha256, url: signed.data?.signedUrl ?? null, summary: dtoBrief(prod.dto) });
  }
  if (mode === "request") {
    if (!(await summariesEnabled(sb, userId))) return respond({ ok: false, reason: "flag_off" }, 403);
    try {
      const prod = await produceSummary(sb, { userId, period, origin: "on_demand", channel: "whatsapp", requestId, timezone: tz });
      const q = await queueWhatsappSummary(sb, prod, { userId, requestId, inboundMessageId: body.inbound_message_id ?? null });
      log({ event: "on_demand_summary", user_id: userId, delivery_id: prod.deliveryId, ...dtoBrief(prod.dto), queued: !!q.outboundId });
      return respond({ ok: !!q.outboundId, queued: !!q.outboundId, reason: q.skipped ?? null, delivery_id: prod.deliveryId });
    } catch (e) {
      log({ event: "on_demand_summary_error", user_id: userId, err: String((e as Error).message).slice(0, 200) });
      return respond({ ok: false, reason: "generation_failed" }, 500);
    }
  }
  return respond({ ok: false, error: "unknown_mode" }, 400);
});
