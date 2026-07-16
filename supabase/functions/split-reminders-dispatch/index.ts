// Reminder dispatch worker.
// Gate: requires either header `x-cron-secret` matching CRON_SECRET env,
// or an admin JWT (is_current_user_admin === true). Never publicly callable.
// Semantics: claims reminder_jobs atomically (lease), respects quiet hours
// via claim_reminder_jobs RPC, enqueues in outbound_messages with a dedup
// idempotency key. Marks job as `enqueued`, NEVER as `sent` — the outbound
// worker + provider ack drives the terminal state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function requireAdmin(auth: string) {
  if (!auth.startsWith("Bearer ")) return false;
  const sb = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes.user) return false;
  const { data } = await sb.rpc("is_current_user_admin");
  return data === true;
}

function maskPhone(p?: string | null): string {
  if (!p) return "";
  return p.replace(/^(\+\d{2})\d+(\d{4})$/, "$1****$2");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Gate: cron secret OR admin JWT
  const cronHdr = req.headers.get("x-cron-secret") ?? "";
  const authHdr = req.headers.get("Authorization") ?? "";
  const okCron = CRON_SECRET.length > 0 && cronHdr === CRON_SECRET;
  const okAdmin = !okCron ? await requireAdmin(authHdr) : false;
  if (!okCron && !okAdmin) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim atomically; respects quiet hours (SP 08–22) and attempt limits.
  const { data: claimed, error: claimErr } = await sb.rpc("claim_reminder_jobs", { p_limit: 20 });
  if (claimErr) return json({ error: claimErr.message }, 500);
  const jobs = (claimed as Array<any> | null) ?? [];

  let enqueued = 0, skipped = 0, failed = 0;
  for (const j of jobs) {
    try {
      const { data: p } = await sb
        .from("shared_expense_participants")
        .select("id,name,phone_e164,amount_due,amount_paid,opt_out_at,status")
        .eq("id", j.participant_id)
        .single();
      if (!p || p.opt_out_at || !p.phone_e164 || !["pending","partial","notified"].includes(p.status)) {
        await sb.from("reminder_jobs").update({
          status: "skipped", last_error: p?.opt_out_at ? "opted_out" : !p?.phone_e164 ? "no_phone" : "bad_state",
          lease_expires_at: null,
        }).eq("id", j.id);
        skipped++;
        continue;
      }

      const { data: se } = await sb
        .from("shared_expenses")
        .select("title,due_date,pix_key,owner_user_id")
        .eq("id", j.shared_expense_id)
        .single();

      const remaining = Number(p.amount_due) - Number(p.amount_paid);
      const msg = `Oi ${p.name}! Sobre ${se?.title}: você deve R$ ${remaining.toFixed(2).replace(".", ",")}` +
                  `${se?.due_date ? ` (venc. ${se.due_date})` : ""}` +
                  `${se?.pix_key ? ` Pix: ${se.pix_key}` : ""}`;

      const dedupDay = new Date(j.scheduled_for).toISOString().slice(0, 10);
      const idem = `reminder:${j.participant_id}:${dedupDay}`;

      const { data: om, error: omErr } = await sb
        .from("outbound_messages")
        .insert({
          channel: "whatsapp",
          to_phone: p.phone_e164,
          body: msg,
          status: "queued",
          idempotency_key: idem,
        })
        .select("id")
        .single();

      if (omErr) {
        // duplicate idempotency = already enqueued → treat as skipped-ok
        const dupe = String(omErr.message).includes("duplicate") || String(omErr.code) === "23505";
        await sb.from("reminder_jobs").update({
          status: dupe ? "skipped" : "failed",
          last_error: dupe ? "duplicate_idempotency" : String(omErr.message).slice(0, 200),
          lease_expires_at: null,
        }).eq("id", j.id);
        if (dupe) skipped++; else failed++;
      } else {
        await sb.from("reminder_jobs").update({
          status: "enqueued",
          outbound_message_id: om.id,
          lease_expires_at: null,
        }).eq("id", j.id);
        enqueued++;
      }
    } catch (e) {
      failed++;
      await sb.from("reminder_jobs").update({
        status: "failed",
        last_error: String((e as Error).message).slice(0, 200),
        lease_expires_at: null,
      }).eq("id", j.id);
    }
  }

  // Never leak Pix or full phone in logs
  console.log(JSON.stringify({
    event: "reminder_dispatch",
    claimed: jobs.length, enqueued, skipped, failed,
    ids: jobs.map((j) => ({ id: j.id, phone: maskPhone(null) })),
  }));

  await writeJobHeartbeat({
    jobKey: "split-reminders-dispatch",
    ok: failed === 0,
    processed: enqueued,
    failed,
  });
  return json({ claimed: jobs.length, enqueued, skipped, failed });
});

