// deno-lint-ignore-file no-explicit-any
// push-notify — notificações push (Web Push / PWA).
//
// Usuário (JWT):  { action: "config" }                      → chave pública VAPID
//                 { action: "subscribe", subscription }      → registra o aparelho
//                 { action: "unsubscribe", endpoint }        → remove o aparelho
//                 { action: "test" }                         → push de teste para os próprios aparelhos
// Interno (x-cron-secret, vindo do gatilho de `notifications`): { notification_id } → envia o push daquela notificação.
//
// Não registra conteúdo de notificação em log. Assinaturas mortas (404/410) são removidas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { safeEqual } from "../_shared/security/secrets.ts";
import {
  buildPushPayload, decidePush, PUSH_TTL_SECONDS, validSubscription,
} from "../_shared/push/rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://meunino.com.br";

type Keys = { publicKey: string; privateKey: string };
let keyCache: Keys | null = null;

/** Chaves do ambiente (se existirem) ou as guardadas no banco; na primeira vez, gera e guarda. */
async function vapidKeys(sb: any): Promise<Keys> {
  if (keyCache) return keyCache;
  const envPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const envPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (envPublic && envPrivate) return (keyCache = { publicKey: envPublic, privateKey: envPrivate });
  const read = async () => {
    const { data } = await sb.from("push_vapid_keys").select("public_key,private_key").eq("id", true).maybeSingle();
    return data ? { publicKey: String((data as any).public_key), privateKey: String((data as any).private_key) } : null;
  };
  let keys = await read();
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    await sb.from("push_vapid_keys").upsert({ id: true, public_key: fresh.publicKey, private_key: fresh.privateKey }, { onConflict: "id", ignoreDuplicates: true });
    keys = await read(); // se duas execuções disputarem, vale a primeira gravada
  }
  if (!keys) throw new Error("vapid_unavailable");
  return (keyCache = keys);
}

async function sendToUser(sb: any, userId: string, payload: Record<string, unknown>, opts: { notificationId?: string | null }) {
  const keys = await vapidKeys(sb);
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  const { data: subs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId).eq("enabled", true);
  const out = { sent: 0, removed: 0, failed: 0 };
  for (const sub of (subs ?? []) as any[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: PUSH_TTL_SECONDS, urgency: "normal" },
      );
      out.sent++;
      await sb.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, updated_at: new Date().toISOString() }).eq("id", sub.id);
      await sb.from("push_deliveries").insert({ user_id: userId, notification_id: opts.notificationId ?? null, subscription_id: sub.id, status: "sent" });
    } catch (error) {
      const status = Number((error as any)?.statusCode ?? 0);
      if (status === 404 || status === 410) {
        await sb.from("push_subscriptions").delete().eq("id", sub.id);
        out.removed++;
      } else {
        out.failed++;
        await sb.from("push_subscriptions").update({ failure_count: (Number(sub.failure_count ?? 0) + 1), updated_at: new Date().toISOString() }).eq("id", sub.id);
        await sb.from("push_deliveries").insert({ user_id: userId, notification_id: opts.notificationId ?? null, subscription_id: sub.id, status: "failed", error: `http_${status || "net"}` });
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const h = httpContext("push-notify", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as any;

  // ---- interno: gatilho de notificações ----
  const cron = req.headers.get("x-cron-secret") ?? "";
  if (CRON_SECRET !== "" && safeEqual(cron, CRON_SECRET)) {
    const id = String(body?.notification_id ?? "");
    if (!id) return h.fail("invalid_request", 400);
    const { data: n } = await sb.from("notifications").select("id,user_id,type,title,body,action_url,dedup_key").eq("id", id).maybeSingle();
    if (!n) return h.ok({ skipped: "not_found" });
    const [{ data: prefs }, { count }] = await Promise.all([
      sb.from("notification_preferences").select("*").eq("user_id", (n as any).user_id).maybeSingle(),
      sb.from("push_deliveries").select("id", { count: "exact", head: true })
        .eq("user_id", (n as any).user_id).eq("status", "sent").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    const decision = decidePush({ type: String((n as any).type), now: new Date(), prefs: prefs as any, sentLast24h: Number(count ?? 0) });
    if (!decision.send) return h.ok({ skipped: decision.reason });
    // idempotência por notificação: o gatilho pode repetir
    const { count: already } = await sb.from("push_deliveries").select("id", { count: "exact", head: true }).eq("notification_id", id).eq("status", "sent");
    if (Number(already ?? 0) > 0) return h.ok({ skipped: "already_sent" });
    const result = await sendToUser(sb, String((n as any).user_id), buildPushPayload(n as any), { notificationId: id });
    return h.ok(result);
  }

  // ---- usuário ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return h.fail("unauthorized", 401);
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
  const userId = String(userRes?.user?.id ?? "");
  if (userError || !userId) return h.fail("unauthorized", 401);

  const action = String(body?.action ?? "");
  try {
    if (action === "config") {
      const keys = await vapidKeys(sb);
      const { count } = await sb.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("enabled", true);
      return h.ok({ public_key: keys.publicKey, devices: Number(count ?? 0) });
    }
    if (action === "subscribe") {
      if (!validSubscription(body?.subscription)) return h.fail("invalid_subscription", 400);
      const s = body.subscription;
      const { error } = await sb.from("push_subscriptions").upsert({
        user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
        user_agent: String(body?.user_agent ?? "").slice(0, 200) || null, enabled: true, failure_count: 0, updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) return h.fail("subscribe_failed", 500);
      return h.ok({ subscribed: true });
    }
    if (action === "unsubscribe") {
      const endpoint = String(body?.endpoint ?? "");
      if (!endpoint) return h.fail("invalid_request", 400);
      await sb.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
      return h.ok({ unsubscribed: true });
    }
    if (action === "test") {
      const result = await sendToUser(sb, userId, {
        title: "Tudo certo por aqui 🎉",
        body: "As notificações do Nino estão ativas neste aparelho.",
        url: "/app", tag: "nino-push-test",
      }, { notificationId: null });
      return h.ok(result);
    }
    return h.fail("invalid_action", 400);
  } catch (error) {
    return h.fail("internal", 500, { details: { message: String((error as Error)?.message ?? error).slice(0, 120) } });
  }
});
