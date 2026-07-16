// Consumir reminder_jobs pendentes e enfileirar em outbound_messages (WAHA opcional).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const wahaConfigured = !!Deno.env.get("WAHA_BASE_URL");
    const { data: jobs } = await admin
      .from("reminder_jobs")
      .select("id,owner_user_id,shared_expense_id,participant_id")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .limit(20);

    let processed = 0;
    for (const j of jobs ?? []) {
      const { data: p } = await admin
        .from("shared_expense_participants")
        .select("id,name,phone_e164,amount_due,amount_paid,opt_out_at")
        .eq("id", j.participant_id)
        .single();
      if (!p || p.opt_out_at) {
        await admin.from("reminder_jobs").update({ status: "skipped", last_error: "opted_out_or_missing" }).eq("id", j.id);
        continue;
      }
      const { data: se } = await admin
        .from("shared_expenses")
        .select("title,due_date,pix_key")
        .eq("id", j.shared_expense_id)
        .single();
      if (!wahaConfigured || !p.phone_e164) {
        await admin.from("reminder_jobs").update({ status: "skipped", last_error: wahaConfigured ? "no_phone" : "provider_not_configured" }).eq("id", j.id);
        continue;
      }
      const remaining = Number(p.amount_due) - Number(p.amount_paid);
      const msg = `Oi ${p.name}! Sobre ${se?.title}: você deve R$ ${remaining.toFixed(2).replace(".", ",")}${se?.due_date ? ` (venc. ${se.due_date})` : ""}.${se?.pix_key ? ` Pix: ${se.pix_key}` : ""}`;
      const { data: om, error } = await admin
        .from("outbound_messages")
        .insert({ channel: "whatsapp", to_phone: p.phone_e164, body: msg, status: "queued" })
        .select("id")
        .single();
      if (error) {
        await admin.from("reminder_jobs").update({ status: "failed", last_error: error.message, attempts: (j as any).attempts + 1 }).eq("id", j.id);
      } else {
        await admin.from("reminder_jobs").update({ status: "sent", outbound_message_id: om.id }).eq("id", j.id);
        processed += 1;
      }
    }
    return new Response(JSON.stringify({ processed, total: jobs?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
