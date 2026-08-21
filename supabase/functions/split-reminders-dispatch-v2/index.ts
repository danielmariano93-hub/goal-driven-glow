// Split reminder worker v2.
// Delivers both in-app and WhatsApp, while reminder_jobs remains the source of
// truth. Due-date jobs are created by schedule_split_due_reminders() in SQL.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { renderMessageTemplate, buildLinkSentence, type MessagePersona } from "../_shared/agent/messageTemplates.ts";
import { buildSharedExpenseUrl, buildSignupUrl } from "../_shared/messaging/appUrl.ts";
import { shortenAppUrl } from "../_shared/agent/core/ShortLinks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

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

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function notificationTitle(kind: string, title: string): string {
  if (kind === "due_soon") return `“${title}” vence amanhã`;
  if (kind === "due_today") return `“${title}” vence hoje`;
  if (kind === "overdue") return `Pagamento pendente em “${title}”`;
  if (kind === "payment_confirmation") return `Pagamento registrado em “${title}”`;
  if (kind === "completed") return `Rolê “${title}” concluído`;
  if (kind === "invite") return `Você foi incluído em “${title}”`;
  if (kind === "owner_digest") return `Quem ainda não pagou em “${title}”`;
  return `Lembrete de “${title}”`;
}

type PendingParticipant = {
  id: string;
  name: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  reminder_count: number | null;
  status: string;
};

/** Resumo para o dono: quem já foi cobrado e continua em aberto. */
function ownerDigestMessage(
  expenseTitle: string,
  pending: PendingParticipant[],
  persona: MessagePersona,
  linkSentence: string,
): string {
  const total = pending.reduce(
    (sum, p) => sum + Math.max(0, Number(p.amount_due ?? 0) - Number(p.amount_paid ?? 0)),
    0,
  );
  const lines = pending.map((p) => {
    const remaining = Math.max(0, Number(p.amount_due ?? 0) - Number(p.amount_paid ?? 0));
    const reminders = Number(p.reminder_count ?? 0);
    const cobranca = reminders > 0
      ? ` — ${reminders} ${reminders === 1 ? "cobrança enviada" : "cobranças enviadas"}`
      : " — ainda sem cobrança enviada";
    return `• ${String(p.name ?? "Participante").trim() || "Participante"}: ${formatBRL(remaining)}${cobranca}`;
  });

  return renderMessageTemplate("owner_digest", persona, {
    title: expenseTitle,
    amount: formatBRL(total),
    pending_count: String(pending.length),
    pending_word: pending.length === 1 ? "pessoa" : "pessoas",
    pending_list: `${lines.join("\n")}\n`,
    link_sentence: linkSentence,
  });
}


function messageFor(
  kind: string,
  participant: any,
  expense: any,
  remaining: number,
  persona: MessagePersona,
  linkSentence: string,
  split: { participantsCount: number; totalAmount: number },
): string {
  const due = expense?.due_date
    ? new Date(`${expense.due_date}T12:00:00`).toLocaleDateString("pt-BR")
    : null;
  const participantsCount = Math.max(1, Number(split.participantsCount || 0));
  const totalAmount = Number(split.totalAmount || 0);
  const splitContextSentence = totalAmount > 0
    ? ` (total do rolê: ${formatBRL(totalAmount)}, dividido entre ${participantsCount} ${participantsCount === 1 ? "pessoa" : "pessoas"})`
    : "";

  return renderMessageTemplate(kind, persona, {
    participant_name: String(participant.name ?? "").trim() || "tudo bem",
    owner_name: String(expense.owner_name ?? "A pessoa responsável pelo rolê"),
    title: String(expense.title ?? "seu rolê"),
    amount: formatBRL(remaining),
    total_amount: formatBRL(totalAmount),
    participants_count: String(participantsCount),
    split_context_sentence: splitContextSentence,
    due_date: due ?? "",
    due_sentence: due ? ` O combinado é pagar até ${due}.` : "",
    pix_key: String(expense.pix_key ?? ""),
    pix_sentence: expense.pix_key ? ` Pix: ${expense.pix_key}.` : "",
    link_sentence: linkSentence,
  });
}

async function isRegisteredPhone(sb: any, phoneE164: string): Promise<boolean> {
  if (!phoneE164) return false;
  const { data } = await sb.from("whatsapp_links")
    .select("user_id,status")
    .eq("phone_e164", phoneE164)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data?.user_id);
}

Deno.serve(async (req) => {
  const h = httpContext("split-reminders-dispatch-v2", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const validCron = CRON_SECRET.length > 0 && cronHeader === CRON_SECRET;
  const validService = authHeader === `Bearer ${SERVICE_ROLE}`;
  const caller = (!validCron && !validService)
    ? await authenticatedCaller(authHeader)
    : { userId: null, admin: false };
  if (!validCron && !validService && !caller.userId) return h.fail("unauthorized", 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const globalWorker = validCron || validService || caller.admin;
  const { data: claimed, error: claimError } = globalWorker
    ? await sb.rpc("claim_reminder_jobs", { p_limit: 30 })
    : await sb.rpc("claim_reminder_jobs_for_owner", { p_owner_user_id: caller.userId, p_limit: 20 });
  if (claimError) return h.fail("internal", 500, { details: { reason: String(claimError.message).slice(0, 200) } });

  const jobs = (claimed as any[] | null) ?? [];
  const { data: activePrompt } = await sb.from("agent_prompt_versions")
    .select("structured_config")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const persona = ((activePrompt?.structured_config ?? {}) as MessagePersona);
  const ownerNames = new Map<string, string>();
  const splitContextCache = new Map<string, { participantsCount: number; totalAmount: number }>();

  async function splitContext(expenseId: string) {
    const cached = splitContextCache.get(expenseId);
    if (cached) return cached;
    const { data: rows, error } = await sb.from("shared_expense_participants")
      .select("amount_due")
      .eq("shared_expense_id", expenseId);
    if (error) throw new Error(`split_context:${error.message}`);
    const list = (rows as Array<{ amount_due: number | null }> | null) ?? [];
    const value = {
      participantsCount: list.length,
      totalAmount: list.reduce((sum, row) => sum + Number(row.amount_due ?? 0), 0),
    };
    splitContextCache.set(expenseId, value);
    return value;
  }

  let appDelivered = 0;
  let whatsappQueued = 0;
  let skipped = 0;
  let failed = 0;
  const failedJobs: Array<{ job_id: string; reason: string }> = [];
  const targetOutboundIds: string[] = [];

  for (const job of jobs) {
    try {
      const kind = String(job.kind ?? "reminder");

      // ---- Resumo para o dono do rolê (não tem participante alvo) ----
      if (kind === "owner_digest") {
        const { data: expenseRow, error: expErr } = await sb.from("shared_expenses")
          .select("title,due_date,owner_user_id,status,deleted_at")
          .eq("id", job.shared_expense_id)
          .single();
        if (expErr || !expenseRow) throw new Error(expErr?.message ?? "split_not_found");
        if (["cancelled", "settled"].includes(String(expenseRow.status)) || expenseRow.deleted_at) {
          await sb.from("reminder_jobs").update({ status: "skipped", last_error: "split_closed", lease_expires_at: null }).eq("id", job.id);
          skipped++;
          continue;
        }

        const { data: pendingRows, error: pendErr } = await sb.from("shared_expense_participants")
          .select("id,name,amount_due,amount_paid,reminder_count,status")
          .eq("shared_expense_id", job.shared_expense_id)
          .in("status", ["pending", "partial", "notified"]);
        if (pendErr) throw new Error(`owner_digest:${pendErr.message}`);
        const pending = ((pendingRows as PendingParticipant[] | null) ?? []).filter(
          (p) => Math.max(0, Number(p.amount_due ?? 0) - Number(p.amount_paid ?? 0)) > 0,
        );
        if (pending.length === 0) {
          await sb.from("reminder_jobs").update({ status: "skipped", last_error: "no_pending_participants", lease_expires_at: null }).eq("id", job.id);
          skipped++;
          continue;
        }

        const envDigest = { APP_PUBLIC_URL: Deno.env.get("APP_PUBLIC_URL") ?? null };
        const ownerLink = await shortenAppUrl(sb, {
          user_id: expenseRow.owner_user_id,
          url: buildSharedExpenseUrl(envDigest, String(job.shared_expense_id), { ref: "owner_digest" }),
          kind: "split_owner_digest",
        });
        const ownerLinkSentence = buildLinkSentence({ isRegistered: true, appLink: ownerLink, signupLink: null });
        const digest = ownerDigestMessage(String(expenseRow.title ?? "seu rolê"), pending, persona, ownerLinkSentence);

        const { error: notifyError } = await sb.from("notifications").upsert({
          user_id: expenseRow.owner_user_id,
          type: "split_reminder",
          title: notificationTitle(kind, String(expenseRow.title)),
          body: digest,
          action_url: `/app/divisao-do-role/${String(job.shared_expense_id)}`,
          dedup_key: `split-job:${job.id}:owner`,
        }, { onConflict: "user_id,dedup_key" });
        if (notifyError) throw new Error(`notification:${notifyError.message}`);
        appDelivered++;

        let ownerOutboundId: string | null = null;
        const { data: ownerLinkRow } = await sb.from("whatsapp_links")
          .select("phone_e164").eq("user_id", expenseRow.owner_user_id).eq("status", "active")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const ownerPhone = String(ownerLinkRow?.phone_e164 ?? "");
        if (ownerPhone) {
          const idem = `split:owner_digest:${job.shared_expense_id}:${job.id}`;
          const { data: ob, error: obErr } = await sb.from("outbound_messages").insert({
            channel: "whatsapp",
            user_id: expenseRow.owner_user_id,
            to_phone: ownerPhone,
            body: digest,
            status: "queued",
            kind: "split_owner_digest",
            idempotency_key: idem,
            context_type: "shared_expense",
            context_id: job.shared_expense_id,
            metadata: { job_id: job.id, origin: "split_reminder_v2", template: kind },
            surface: "whatsapp",
            feature: "split_reminder",
          }).select("id").single();
          if (obErr) {
            const duplicate = String(obErr.code) === "23505" || String(obErr.message).toLowerCase().includes("duplicate");
            if (!duplicate) throw new Error(`outbound:${obErr.message}`);
            const { data: existing } = await sb.from("outbound_messages").select("id").eq("idempotency_key", idem).maybeSingle();
            ownerOutboundId = existing?.id ?? null;
          } else {
            ownerOutboundId = ob.id;
            whatsappQueued++;
          }
        }

        await sb.from("reminder_jobs").update({
          status: "enqueued",
          outbound_message_id: ownerOutboundId,
          last_error: ownerOutboundId ? null : "app_only",
          lease_expires_at: null,
        }).eq("id", job.id);

        await sb.from("shared_expense_events").insert({
          shared_expense_id: job.shared_expense_id,
          owner_user_id: expenseRow.owner_user_id,
          event_type: "message_enqueued",
          payload: { kind, job_id: job.id, outbound_message_id: ownerOutboundId, pending: pending.length, worker: "v2" },
        });
        continue;
      }

      const terminal = ["payment_confirmation", "completed"].includes(kind);

      const { data: participant, error: participantError } = await sb.from("shared_expense_participants")
        .select("id,name,phone_e164,amount_due,amount_paid,opt_out_at,status,linked_user_id,reminder_count")
        .eq("id", job.participant_id)
        .single();
      if (participantError || !participant) throw new Error(participantError?.message ?? "participant_not_found");

      const validState = terminal || ["pending", "partial", "notified"].includes(String(participant.status));
      if (!validState) {
        await sb.from("reminder_jobs").update({ status: "skipped", last_error: "participant_settled", lease_expires_at: null }).eq("id", job.id);
        skipped++;
        continue;
      }

      const { data: expense, error: expenseError } = await sb.from("shared_expenses")
        .select("title,due_date,pix_key,owner_user_id,status,deleted_at")
        .eq("id", job.shared_expense_id)
        .single();
      if (expenseError || !expense) throw new Error(expenseError?.message ?? "split_not_found");
      // Confirmação de pagamento e encerramento são mensagens terminais.
      // Elas são enfileiradas antes de o rolê mudar para "settled"; portanto
      // precisam continuar válidas depois da quitação. A regra anterior
      // descartava justamente a mensagem que reconhecia o pagamento.
      if (String(expense.status) === "cancelled" || expense.deleted_at || (String(expense.status) === "settled" && !terminal)) {
        await sb.from("reminder_jobs").update({ status: "skipped", last_error: "split_closed", lease_expires_at: null }).eq("id", job.id);
        skipped++;
        continue;
      }

      if (expense.owner_user_id && !ownerNames.has(expense.owner_user_id)) {
        const { data: owner } = await sb.from("profiles")
          .select("display_name").eq("id", expense.owner_user_id).maybeSingle();
        ownerNames.set(expense.owner_user_id, String(owner?.display_name ?? "").trim());
      }
      expense.owner_name = ownerNames.get(expense.owner_user_id) || "A pessoa responsável pelo rolê";

      const remaining = Math.max(0, Number(participant.amount_due) - Number(participant.amount_paid));
      const phone = String(participant.phone_e164 ?? "");
      const registered = await isRegisteredPhone(sb, phone);
      const env = { APP_PUBLIC_URL: Deno.env.get("APP_PUBLIC_URL") ?? null };
      const linkOwner = expense?.owner_user_id ?? null;
      const appLink = await shortenAppUrl(sb, {
        user_id: linkOwner,
        url: buildSharedExpenseUrl(env, String(job.shared_expense_id), { ref: "wa_split" }),
        kind: "split_participant",
      });
      const signupLink = await shortenAppUrl(sb, {
        user_id: linkOwner,
        url: buildSignupUrl(env, {
          ref: "wa_split",
          phone,
          next: `/app/divisao-do-role/${String(job.shared_expense_id)}`,
        }),
        kind: "split_signup",
      });
      const linkSentence = buildLinkSentence({ isRegistered: registered, appLink, signupLink });
      const message = messageFor(kind, participant, expense, remaining, persona, linkSentence, await splitContext(String(job.shared_expense_id)));

      let deliveredSomewhere = false;
      if (participant.linked_user_id) {
        const { error: notificationError } = await sb.from("notifications").upsert({
          user_id: participant.linked_user_id,
          type: kind === "invite" ? "split_participant_linked" : "split_reminder",
          title: notificationTitle(kind, String(expense.title)),
          body: message,
          action_url: `/app/divisao-do-role/${String(job.shared_expense_id)}`,
          dedup_key: `split-job:${job.id}:app`,
        }, { onConflict: "user_id,dedup_key" });
        if (notificationError) throw new Error(`notification:${notificationError.message}`);
        appDelivered++;
        deliveredSomewhere = true;
      }

      let outboundId: string | null = null;
      const whatsappAllowed = phone && !participant.opt_out_at;
      if (whatsappAllowed) {
        const idempotencyKey = `split:${kind}:${job.participant_id}:${job.id}`;
        const { data: outbound, error: outboundError } = await sb.from("outbound_messages")
          .insert({
            channel: "whatsapp",
            user_id: expense.owner_user_id,
            to_phone: phone,
            body: message,
            status: "queued",
            kind: `split_${kind}`,
            idempotency_key: idempotencyKey,
            context_type: "shared_expense",
            context_id: job.shared_expense_id,
            participant_id: job.participant_id,
            metadata: { job_id: job.id, origin: "split_reminder_v2", template: kind },
            surface: "whatsapp",
            feature: "split_reminder",
          })
          .select("id")
          .single();

        if (outboundError) {
          const duplicate = String(outboundError.code) === "23505" || String(outboundError.message).toLowerCase().includes("duplicate");
          if (!duplicate) throw new Error(`outbound:${outboundError.message}`);
          const { data: existing } = await sb.from("outbound_messages")
            .select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
          outboundId = existing?.id ?? null;
          if (!outboundId) throw new Error("outbound_duplicate_without_row");
          targetOutboundIds.push(outboundId);
        } else {
          outboundId = outbound.id;
          targetOutboundIds.push(outboundId);
        }
        whatsappQueued++;
        deliveredSomewhere = true;
      }

      if (!deliveredSomewhere) {
        await sb.from("reminder_jobs").update({
          status: "skipped",
          last_error: participant.opt_out_at ? "opted_out_without_app_user" : "no_delivery_channel",
          lease_expires_at: null,
        }).eq("id", job.id);
        skipped++;
        continue;
      }

      await sb.from("reminder_jobs").update({
        status: "enqueued",
        outbound_message_id: outboundId,
        last_error: outboundId ? null : "app_only",
        lease_expires_at: null,
      }).eq("id", job.id);

      if (["reminder", "due_soon", "due_today", "overdue"].includes(kind)) {
        await sb.from("shared_expense_participants").update({
          last_reminded_at: new Date().toISOString(),
          reminder_count: Number(participant.reminder_count ?? 0) + 1,
        }).eq("id", participant.id);
      }

      await sb.from("shared_expense_events").insert({
        shared_expense_id: job.shared_expense_id,
        owner_user_id: expense.owner_user_id,
        participant_id: job.participant_id,
        event_type: "message_enqueued",
        payload: {
          kind,
          job_id: job.id,
          outbound_message_id: outboundId,
          app_delivered: Boolean(participant.linked_user_id),
          worker: "v2",
        },
      });
    } catch (caught) {
      failed++;
      failedJobs.push({ job_id: job.id, reason: String((caught as Error).message).slice(0, 200) });
      await sb.from("reminder_jobs").update({
        status: "failed",
        last_error: String((caught as Error).message).slice(0, 200),
        lease_expires_at: null,
      }).eq("id", job.id);
    }
  }

  // comms_contract.v2: este worker é apenas produtor da fila. O consumo de
  // outbound_messages tem um único caminho (whatsapp_send_dispatch_tick), que
  // só acorda o whatsapp-send quando existe trabalho pendente. Assim o convite
  // continua saindo na hora, sem dois consumidores competindo pela fila.
  let outboundProcessed = 0;
  let outboundKicked = false;
  {
    const { error: kickError } = await sb.rpc("whatsapp_send_dispatch_tick");
    outboundKicked = !kickError;
    if (kickError) {
      console.error(JSON.stringify({ event: "split_outbound_kick_failed", error: kickError.message.slice(0, 160) }));
    }
  }

  let outboundSent = 0, outboundPending = 0, outboundFailed = 0;
  if (targetOutboundIds.length > 0) {
    const { data: targetRows } = await sb.from("outbound_messages").select("status").in("id", targetOutboundIds);
    for (const row of targetRows ?? []) {
      const status = String((row as { status?: string }).status ?? "");
      if (["sent", "delivered", "read"].includes(status)) outboundSent++;
      else if (["failed", "dead"].includes(status)) outboundFailed++;
      else outboundPending++;
    }
  }

  await writeJobHeartbeat({
    jobKey: "split-reminders-dispatch",
    ok: failed === 0,
    processed: whatsappQueued + appDelivered,
    failed,
    stages: {
      claimed: jobs.length,
      enqueued: whatsappQueued,
      app_delivered: appDelivered,
      skipped,
      failed,
    },
    sb: sb as never,
  });


  // partial_success: um único job falho impede ok:true (P1-3).
  return h.partial({
    enqueued: whatsappQueued,
    outbound_processed: outboundProcessed,
    outbound_kicked: outboundKicked,
    outbound_sent: outboundSent,
    outbound_pending: outboundPending,
    outbound_failed: outboundFailed,
    claimed: jobs.length,
    app_delivered: appDelivered,
    whatsapp_queued: whatsappQueued,
    skipped,
    failed,
  }, failedJobs, { errorCode: "split_reminder_delivery_failed" });
});
