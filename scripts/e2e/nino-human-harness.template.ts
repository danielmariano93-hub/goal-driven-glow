// Nino human-conversation E2E harness (temporary Edge Function template).
//
// Deployed manually for a test window with the exact revision under test
// (`__SHA__`) and a per-run shared secret (`__TOKEN__`). It reproduces what the
// WhatsApp webhook does for a text message — inbound row, conversation history
// row, orchestrator turn — for a synthetic test user only, then returns the
// reply plus the persisted run diagnostics. Never deploy it without a token and
// replace it with a 410 stub after the test window.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runOrchestrator, service } from "https://raw.githubusercontent.com/danielmariano93-hub/goal-driven-glow/__SHA__/supabase/functions/_shared/agent/orchestrator.ts";

const USER_ID = "__USER_ID__";
const TOKEN = "__TOKEN__";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!TOKEN || req.headers.get("x-e2e-token") !== TOKEN) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const sb = service();

  if (body.action === "new") {
    const phone = String(body.phone ?? "");
    if (!/^\+55119999\d{4}$/.test(phone)) return json({ error: "phone_invalid" }, 400);
    const { data, error } = await sb.from("conversations").insert({
      user_id: USER_ID, source: "whatsapp", phone_e164: phone, last_message_at: new Date().toISOString(),
    }).select("id").single();
    if (error) return json({ error: `conversation_failed:${error.code ?? "unknown"}` }, 500);
    return json({ conversation_id: data.id, phone });
  }

  if (body.action === "memory") {
    const { data } = await sb.from("agent_memory").select("kind,key,value,source,updated_at")
      .eq("user_id", USER_ID).eq("kind", "context").like("key", "life:%");
    return json({ memory: data ?? [] });
  }

  if (body.action !== "turn") return json({ error: "action_invalid" }, 400);
  const conversationId = String(body.conversation_id ?? "");
  const phone = String(body.phone ?? "");
  const text = String(body.text ?? "").slice(0, 2000);
  if (!conversationId || !phone || !text) return json({ error: "turn_invalid" }, 400);

  const inboundId = crypto.randomUUID();
  const { error: inboundError } = await sb.from("inbound_messages").insert({
    id: inboundId, provider: "waha", provider_message_id: `e2e-${Date.now()}-${inboundId}`,
    from_phone: phone, to_phone: "+5500000000000", body: text, received_at: new Date().toISOString(),
    has_media: false, logical_dedup_key: `e2e:${conversationId}:${inboundId}`,
  });
  if (inboundError) return json({ error: `inbound_failed:${inboundError.code ?? "unknown"}` }, 500);
  await sb.from("conversation_messages").insert({
    conversation_id: conversationId, user_id: USER_ID, direction: "inbound", body_masked: text.slice(0, 500),
  });

  const started = Date.now();
  try {
    const result = await runOrchestrator({
      user_id: USER_ID, conversation_id: conversationId, inbound_message_id: inboundId,
      text, source: "simulator", to_phone: phone,
    });
    const latency = Date.now() - started;
    let run: any = null;
    if (result.run_id) {
      const { data } = await sb.from("agent_runs")
        .select("model,provider,path,status,llm_calls,tokens_in,tokens_out,error_sanitized,context_layers")
        .eq("id", result.run_id).maybeSingle();
      run = data;
    }
    return json({
      text, reply: result.reply, reply_kind: result.reply_kind, path: result.path, run_id: result.run_id,
      latency_ms: latency,
      run: run ? {
        model: run.model, provider: run.provider, status: run.status, llm_calls: run.llm_calls,
        tokens_in: run.tokens_in, tokens_out: run.tokens_out, error: run.error_sanitized,
        diagnostics: run.context_layers?.semantic_execution ?? null,
      } : null,
    });
  } catch (error) {
    return json({ text, error: String((error as Error)?.message ?? error).slice(0, 300) }, 500);
  }
});
