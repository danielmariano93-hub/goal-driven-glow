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
import { renderMessageTemplate, type MessagePersona } from "../_shared/agent/messageTemplates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function authenticatedCaller(auth: string) {
  if (!auth.startsWith("Bearer ")) return { userId: null, admin: false };
  const sb = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes.user) return { userId: null, admin: false };
  const { data } = await sb.rpc("is_current_user_admin");
  return { userId: userRes.user.id, admin: data === true };
}

function maskPhone(p?: string | null): string {
  if (!p) return "";
  return p.replace(/^(\+\d{2})\d+(\d{4})$/, "$1****$2");
}

function messageFor(kind: string, p: any, se: any, remaining: number, persona: MessagePersona): string {
  const amount = `R$ ${remaining.toFixed(2).replace(".", ",")}`;
  const due = se?.due_date ? new Date(`${se.due_date}T12:00:00`).toLocaleDateString("pt-BR") : null;
  return renderMessageTemplate(kind, persona, {
    participant_name: String(p.name ?? "").trim() || "tudo bem",
    owner_name: String(se.owner_name ?? "A pessoa responsável pelo rolê"),
    title: String(se.title ?? "seu rolê"),
    amount,
    due_date: due ?? "",
    due_sentence: due ? ` O combinado é pagar até ${due}.` : "",
    pix_key: String(se.pix_key ?? ""),
    pix_sentence: se.pix_key ? ` Pix: ${se.pix_key}.` : "",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Gate: cron secret OR admin JWT
  const cronHdr = req.headers.get("x-cron-secret") ?? "";
  const authHdr = req.headers.get("Authorization") ?? "";
  const okCron = CRON_SECRET.length > 0 && cronHdr === CRON_SECRET;
  const okService = authHdr === `Bearer ${SERVICE_ROLE}`;
  const caller = (!okCron && !okService) ? await authenticatedCaller(authHdr) : { userId: null, admin: false };
  if (!okCron && !okService && !caller.userId) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim atomically; respects quiet hours (SP 08–22) and attempt limits.
  // Usuários autenticados podem adiantar somente a própria fila logo após
  // criar/repetir um convite. Cron, service role e admin processam a fila global.
  const globalWorker = okCron || okService || caller.admin;
  const { data: claimed, error: claimErr } = globalWorker
    ? await sb.rpc("claim_reminder_jobs", { p_limit: 20 })
    : await sb.rpc("claim_reminder_jobs_for_owner", { p_owner_user_id: caller.userId, p_limit: 20 });
  if (claimErr) return json({ error: claimErr.message }, 500);
  const jobs = (claimed as Array<any> | null) ?? [];

  const { data: activePrompt } = await sb.from("agent_prompt_versions")
    .select("structured_config")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const persona = ((activePrompt?.structured_config ?? {}) as MessagePersona);
  const ownerNames = new Map<string, string>();

  let enqueued = 0, skipped = 0, failed = 0;
  for (const j of jobs) {
    try {
      const kind = String(j.kind ?? "reminder");
      const terminalNotice = kind === "payment_confirmation" || kind === "completed";
      const { data: p } = await sb
        .from("shared_expense_participants")
        .select("id,name,phone_e164,amount_due,amount_paid,opt_out_at,status")
        .eq("id", j.participant_id)
        .single();
      if (!p || p.opt_out_at || !p.phone_e164 || (!terminalNotice && !["pending","partial","notified"].includes(p.status))) {
        await sb.from("reminder_jobs").update({
          status: "skipped", last_error: p?.opt_out_at ? "opted_out" : !p?.phone_e164 ? "no_phone" : "bad_state",
          lease_expires_at: null,
        }).eq("id", j.id);
        skipped++;
        continue;
      }

      const { data: se } = await sb
        .from("shared_expenses")
        .select("title,due_date,pix_key,owner_user_id,status")
        .eq("id", j.shared_expense_id)
        .single();

      if (se?.owner_user_id && !ownerNames.has(se.owner_user_id)) {
        const { data: owner } = await sb.from("profiles")
          .select("display_name")
          .eq("id", se.owner_user_id)
          .maybeSingle();
        ownerNames.set(se.owner_user_id, String(owner?.display_name ?? "").trim());
      }
      if (se) se.owner_name = ownerNames.get(se.owner_user_id) || "A pessoa responsável pelo rolê";

      const remaining = Number(p.amount_due) - Number(p.amount_paid);
      if (!se || se.status === "cancelled") {
        await sb.from("reminder_jobs").update({ status: "skipped", last_error: "split_cancelled", lease_expires_at: null }).eq("id", j.id);
        skipped++;
        continue;
      }
      const msg = messageFor(kind, p, se, remaining, persona);

      const dedupDay = new Date(j.scheduled_for).toISOString().slice(0, 10);
      const idem = `split:${kind}:${j.participant_id}:${dedupDay}`;

      const { data: om, error: omErr } = await sb
        .from("outbound_messages")
        .insert({
          channel: "whatsapp",
          user_id: se.owner_user_id,
          to_phone: p.phone_e164,
          body: msg,
          status: "queued",
          kind: `split_${kind}`,
          idempotency_key: idem,
          context_type: "shared_expense",
          context_id: j.shared_expense_id,
          participant_id: j.participant_id,
          metadata: { job_id: j.id, origin: "split_reminder", template: kind },
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
        await sb.from("shared_expense_events").insert({
          shared_expense_id: j.shared_expense_id,
          owner_user_id: se.owner_user_id,
          participant_id: j.participant_id,
          event_type: "message_enqueued",
          payload: { kind, job_id: j.id, outbound_message_id: om.id },
        });
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

  // Todo tick autorizado também processa outbound_messages já existentes.
  // Isso evita que mensagens queued fiquem presas quando nenhum job novo foi criado.
  let outboundProcessed = 0;
  let outboundKicked = false;
  try {
    const sendResponse = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "split-reminders-dispatch", enqueued }),
    });
    const sendResult = await sendResponse.json().catch(() => ({}));
    outboundProcessed = Number(sendResult?.processed ?? 0);
    outboundKicked = sendResponse.ok;
    if (!sendResponse.ok) {
      console.error(JSON.stringify({ event: "split_outbound_kick_failed", status: sendResponse.status }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "split_outbound_kick_failed", error: String((error as Error).message).slice(0, 160) }));
  }
  return json({ claimed: jobs.length, enqueued, skipped, failed, outbound_processed: outboundProcessed, outbound_kicked: outboundKicked });
});
