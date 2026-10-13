// deno-lint-ignore-file no-explicit-any
// due-reminders-tick — lembrete de vencimento no WhatsApp (nino_due_reminders.v1).
//
// Canal dedicado, fora da disputa de atenção do motor proativo: quem ligou (opt-in em
// `notification_preferences.due_reminders_enabled`) recebe, a partir do horário escolhido, UMA mensagem
// com o que vence hoje / nos próximos dias combinados, lida da agenda canônica de compromissos.
// Cada obrigação avisa uma vez por etapa (`due_reminder_log`); nada sai fora da janela diurna.
//
// Autorização: x-cron-secret (cron) ou Bearer de admin de plataforma.
// Body opcional: { user_id?: string, dry_run?: boolean }  — dry_run devolve o texto e NÃO envia nem registra.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { safeEqual } from "../_shared/security/secrets.ts";
import { computeAgentSnapshot } from "../_shared/engine/metrics.ts";
import { saoPauloHour } from "../_shared/proactive/weekdayNudge.ts";
import {
  clampReminderHour, normalizeDaysBefore, planDueReminders, DUE_REMINDERS_VERSION, type AgendaItem,
} from "../_shared/proactive/dueReminders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
const MAX_USERS_PER_RUN = 500;

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const h = httpContext("due-reminders-tick", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as { user_id?: string; dry_run?: boolean };

  const cron = req.headers.get("x-cron-secret") ?? "";
  let authorised = CRON_SECRET !== "" && safeEqual(cron, CRON_SECRET);
  const bearer = req.headers.get("Authorization") ?? "";
  if (!authorised && bearer.startsWith("Bearer ")) {
    const { data } = await createClient(SUPABASE_URL, SERVICE_ROLE, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false } }).auth.getUser();
    const uid = data?.user?.id;
    if (uid) {
      const { data: admin } = await sb.from("platform_admins").select("active").eq("user_id", uid).maybeSingle();
      authorised = Boolean((admin as any)?.active);
    }
  }
  if (!authorised) return h.fail("unauthorized", 401);

  const dryRun = body.dry_run === true;
  const now = new Date();
  const hourNow = saoPauloHour(now);

  let query = sb.from("notification_preferences")
    .select("user_id,due_reminders_days,due_reminders_hour,quiet_start,quiet_end,whatsapp_proactive")
    .eq("due_reminders_enabled", true).limit(MAX_USERS_PER_RUN);
  if (body.user_id) query = query.eq("user_id", body.user_id);
  const { data: prefs, error: prefsError } = await query;
  if (prefsError) return h.fail("preferences_unavailable", 500);

  const counts = { considered: 0, not_yet: 0, no_link: 0, nothing_due: 0, queued: 0, failed: 0 };
  const previews: Array<{ user_id: string; message: string; items: number }> = [];
  const agendaPreview: Array<{ source: string; name: string; date: string; payment_status: string | null }> = [];

  for (const pref of (prefs ?? []) as any[]) {
    counts.considered++;
    const userId = String(pref.user_id);
    try {
      const sendHour = clampReminderHour(pref.due_reminders_hour, String(pref.quiet_start ?? "21:00"), String(pref.quiet_end ?? "08:00"));
      const lastHour = Number(String(pref.quiet_start ?? "21:00").slice(0, 2)) - 1;
      // A partir do horário escolhido e até o início do silêncio: quem perdeu uma rodada ainda recebe no mesmo dia.
      if (!dryRun && (hourNow < sendHour || hourNow > Math.max(lastHour, sendHour))) { counts.not_yet++; continue; }

      const { data: link } = await sb.from("whatsapp_links").select("phone_e164")
        .eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!(link as any)?.phone_e164 || pref.whatsapp_proactive === false) { counts.no_link++; continue; }

      const snapshot = await computeAgentSnapshot(sb, userId);
      const asOf = String((snapshot as any).today);
      const items = (((snapshot as any).commitment_agenda?.items ?? []) as AgendaItem[]);

      const { data: logRows } = await sb.from("due_reminder_log").select("obligation_key,days_before")
        .eq("user_id", userId).gte("due_date", asOf);
      const sentKeys = new Set(((logRows ?? []) as any[]).map((r) => `${r.obligation_key}|${r.days_before}`));

      const plan = planDueReminders({ items, asOf, daysBefore: normalizeDaysBefore(pref.due_reminders_days), sentKeys });
      // Diagnóstico (só em dry_run, só para quem chamou com cron/admin): o que a agenda tem nos próximos 10 dias.
      if (dryRun) {
        for (const i of items) {
          const d = Math.round((Date.parse(`${i.date}T12:00:00Z`) - Date.parse(`${asOf}T12:00:00Z`)) / 86_400_000);
          if (d >= -1 && d <= 10) agendaPreview.push({ source: i.source, name: i.name, date: i.date, payment_status: i.payment_status ?? null });
        }
      }
      if (!plan.message) { counts.nothing_due++; continue; }
      if (dryRun) { previews.push({ user_id: userId, message: plan.message, items: plan.keys.length }); continue; }

      const signature = await sha(plan.keys.map((k) => `${k.key}|${k.days}`).sort().join(";"));
      const { data: outbound, error: outboundError } = await sb.from("outbound_messages").insert({
        user_id: userId,
        to_phone: (link as any).phone_e164,
        body: plan.message,
        provider: "waha",
        status: "queued",
        kind: "due_reminder",
        channel: "whatsapp",
        idempotency_key: `due_reminder:${userId}:${asOf}:${signature}`,
        context_type: "due_reminder",
        surface: "whatsapp",
        feature: "due_reminder",
        metadata: { version: DUE_REMINDERS_VERSION, as_of: asOf, items: plan.keys },
      }).select("id").single();
      if (outboundError && outboundError.code !== "23505") throw outboundError;

      await sb.from("due_reminder_log").upsert(plan.keys.map((k) => ({
        user_id: userId, obligation_key: k.key, due_date: k.due_date, days_before: k.days,
        outbound_message_id: (outbound as any)?.id ?? null, sent_for_date: asOf,
      })), { onConflict: "user_id,obligation_key,days_before", ignoreDuplicates: true });
      counts.queued++;
    } catch (error) {
      counts.failed++;
      console.warn("[due-reminders] user_failed", String((error as Error)?.message ?? error).slice(0, 160));
    }
  }

  if (!dryRun) {
    await writeJobHeartbeat({
      jobKey: "due-reminders-tick", ok: counts.failed === 0, processed: counts.queued, failed: counts.failed, sb,
    }).catch(() => undefined);
  }
  return h.ok({ version: DUE_REMINDERS_VERSION, dry_run: dryRun, hour_sp: hourNow, ...counts, previews, ...(dryRun ? { agenda_preview: agendaPreview } : {}) });
});
