// Watchdog: recover stuck leases and dead-letter old messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext, recordIncident } from "../_shared/http.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INTERNAL_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  const h = httpContext("whatsapp-ack-watchdog", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Gate: service-role bearer OR internal cron secret. Never publicly callable.
  const auth = req.headers.get("Authorization") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? req.headers.get("x-cron-secret") ?? "";
  const authorized =
    auth === `Bearer ${SERVICE_ROLE}` ||
    (INTERNAL_SECRET.length > 0 && providedSecret === INTERNAL_SECRET);
  if (!authorized) return h.fail("unauthorized", 401);


  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {

  const { data: recovered } = await supabase.rpc("recover_expired_outbound_leases");
  const recoveredCount = Number(recovered ?? 0);

  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: stuck } = await supabase
    .from("outbound_messages")
    .select("id, attempts")
    .in("status", ["queued", "processing"])
    .lt("updated_at", cutoff)
    .limit(50);

  const results: Array<{ id: string; action: string }> = [];
  for (const m of stuck ?? []) {
    const attempts = (m.attempts as number) ?? 0;
    if (attempts >= 6) {
      await supabase.from("outbound_messages").update({ status: "dead" }).eq("id", m.id);
      results.push({ id: m.id as string, action: "dead_letter" });
      // Dead-letter é perda de mensagem: precisa de rastro auditável.
      await recordIncident({
        functionName: "whatsapp-ack-watchdog",
        errorCode: "outbound_dead_letter",
        requestId: h.requestId,
        retryable: false,
        details: { outbound_message_id: m.id, attempts },
      });
    } else {
      await supabase.from("outbound_messages").update({
        status: "queued",
        next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        claimed_at: null,
        lease_expires_at: null,
      }).eq("id", m.id);
      results.push({ id: m.id as string, action: "requeued" });
    }
  }

  // ACK stall: mensagens já enviadas mas sem `delivered_at` há > 10 min.
  // Antes de declarar falha, perguntamos o ACK real à WAHA — só o provedor sabe
  // se a entrega aconteceu sem o webhook ter chegado.
  const ackStallCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: ackStalled } = await supabase
    .from("outbound_messages")
    .select("id, retry_count, provider_message_id, to_phone, user_id, context_type, context_id, participant_id")
    .eq("status", "sent")
    .is("delivered_at", null)
    .lt("sent_at", ackStallCutoff)
    .limit(50);

  await loadWahaConfig(supabase).catch(() => {});
  const waha = getWahaAccess();

  let stalledCount = 0;
  let reconciled = 0;
  let ownerAlerts = 0;
  for (const m of ackStalled ?? []) {
    const row = m as any;
    const rc = Number(row.retry_count ?? 0);
    const ack = await fetchWahaAck({
      apiUrl: waha.api_url,
      apiKey: waha.api_key,
      session: waha.session,
      providerMessageId: String(row.provider_message_id ?? ""),
      toPhone: String(row.to_phone ?? ""),
    });

    if (ack === "delivered" || ack === "read") {
      // Webhook perdido: reconciliamos o estado real sem gerar falso incidente.
      const now = new Date().toISOString();
      await supabase.from("outbound_messages").update({
        status: "delivered",
        delivered_at: now,
        read_at: ack === "read" ? now : row.read_at ?? null,
        last_ack_at: now,
      }).eq("id", row.id);
      reconciled++;
      continue;
    }

    if (ack === "failed" || rc >= 2) {
      await supabase.from("outbound_messages").update({
        status: "failed",
        last_error: ack === "failed" ? "provider_ack_error" : "ack_stalled_no_delivery",
        last_ack_at: new Date().toISOString(),
      }).eq("id", row.id);
      await recordIncident({
        functionName: "whatsapp-ack-watchdog",
        errorCode: "outbound_ack_stalled",
        requestId: h.requestId,
        retryable: false,
        details: { outbound_message_id: row.id, retry_count: rc, provider_ack: ack },
      });
      // Falha terminal de lembrete de rolê: o dono precisa saber que o
      // participante não recebeu, para cobrar por outro caminho.
      if (row.context_type === "shared_expense" && row.user_id) {
        const alerted = await notifyOwnerOfUndelivered(supabase, {
          ownerUserId: String(row.user_id),
          sharedExpenseId: row.context_id ? String(row.context_id) : null,
          participantId: row.participant_id ? String(row.participant_id) : null,
          outboundMessageId: String(row.id),
        });
        if (alerted) ownerAlerts++;
      }
      if (row.participant_id) {
        await supabase.from("reminder_jobs").update({
          delivery_status: "failed",
          last_error: "ack_stalled_no_delivery",
        }).eq("outbound_message_id", row.id);
      }
    } else {
      await supabase.from("outbound_messages").update({
        retry_count: rc + 1,
        last_ack_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
    stalledCount++;
  }


  const deadLettered = results.filter((r) => r.action === "dead_letter").length;
  console.log(JSON.stringify({
    fn: "whatsapp-ack-watchdog",
    request_id: h.requestId,
    recovered: recoveredCount,
    requeued: results.filter((r) => r.action === "requeued").length,
    dead_lettered: deadLettered,
    ack_stalled: stalledCount,
  }));

  await writeJobHeartbeat({
    jobKey: "whatsapp-ack-watchdog",
    ok: deadLettered === 0,
    processed: recoveredCount + (stuck ?? []).length + stalledCount,
    failed: deadLettered,
    sb: supabase,
  });
  return h.ok({
    recovered: recoveredCount,
    checked: (stuck ?? []).length,
    ack_stalled: stalledCount,
    results,
  });
  } catch (e) {
    // Qualquer exceção precisa deixar rastro: heartbeat com falha + incidente.
    const code = (e as Error)?.message?.slice(0, 120) ?? "unknown_error";
    await writeJobHeartbeat({
      jobKey: "whatsapp-ack-watchdog",
      ok: false,
      processed: 0,
      failed: 1,
      errorCode: code,
      sb: supabase,
    });
    await recordIncident({
      functionName: "whatsapp-ack-watchdog",
      errorCode: "watchdog_unhandled_error",
      requestId: h.requestId,
      status: 500,
      retryable: true,
      details: { message: code },
    });
    return h.fail("internal", 500, { details: { message: code } });
  }
});

