// Vigia operacional: a cada 5 minutos confere se o Nino está funcionando e avisa o admin quando algo cai.
// Canais: painel (sempre), push ntfy (independe do WhatsApp) e WhatsApp (só para falhas que não são do próprio WhatsApp).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { getWahaAccess, loadWahaConfig } from "../_shared/messaging/waha.ts";
import { safeEqual } from "../_shared/security/secrets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

type Active = { key: string; severity: "critical" | "warning"; title: string; detail: string };
type Notify = { id: string; kind: "new" | "reminder" | "recovered"; key: string; severity: string; title: string; detail: string; since?: string };

/** O servidor do WAHA responde e a sessão do WhatsApp está conectada? */
async function checkWaha(sb: any): Promise<Active[]> {
  await loadWahaConfig(sb);
  const { api_url, api_key, session } = getWahaAccess();
  if (!api_url || !api_key) return [];
  try {
    const res = await fetch(`${api_url.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(session)}`, {
      headers: { "X-Api-Key": api_key }, signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401 || res.status === 403) {
      return [{ key: "waha_auth", severity: "critical", title: "O WAHA recusou a chave de acesso do Nino", detail: `Resposta ${res.status}. A chave guardada no cofre pode estar desatualizada.` }];
    }
    if (!res.ok) {
      return [{ key: "waha_unreachable", severity: "critical", title: "O servidor do WhatsApp (WAHA) está com erro", detail: `Resposta ${res.status} em ${new URL(api_url).host}.` }];
    }
    const body = await res.json().catch(() => ({}));
    const status = String(body?.status ?? "").toUpperCase();
    if (status && status !== "WORKING") {
      return [{ key: "waha_session_down", severity: "critical", title: "A sessão do WhatsApp não está conectada", detail: `Estado atual: ${status}. Pode ser preciso ler o QR code de novo.` }];
    }
    return [];
  } catch (e) {
    const host = (() => { try { return new URL(api_url).host; } catch { return "WAHA"; } })();
    return [{ key: "waha_unreachable", severity: "critical", title: "O servidor do WhatsApp (WAHA) não responde", detail: `Não foi possível conectar em ${host}: ${String((e as Error)?.message ?? e).slice(0, 100)}. Pode ser domínio, DNS ou servidor fora do ar.` }];
  }
}

function messageFor(n: Notify): { title: string; body: string } {
  const icon = n.kind === "recovered" ? "✅" : n.severity === "critical" ? "🚨" : "⚠️";
  const prefix = n.kind === "recovered" ? "Resolvido: " : n.kind === "reminder" ? "Ainda ativo: " : "";
  const since = n.since ? ` (desde ${new Date(n.since).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : "";
  return { title: `${icon} Nino: ${prefix}${n.title}`, body: `${n.detail}${since}`.trim() };
}

async function sendNtfy(topic: string, n: Notify): Promise<boolean> {
  const m = messageFor(n);
  try {
    const res = await fetch("https://ntfy.sh/", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ topic, title: m.title, message: m.body || m.title, priority: n.kind === "recovered" ? 3 : n.severity === "critical" ? 5 : 4, tags: [n.kind === "recovered" ? "white_check_mark" : "rotating_light"] }),
    });
    return res.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  const h = httpContext("ops-alerts-tick", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = req.headers.get("Authorization") ?? "";
  const provided = req.headers.get("x-internal-secret") ?? req.headers.get("x-cron-secret") ?? "";
  const authorized = auth === `Bearer ${SERVICE_ROLE}` || (INTERNAL_SECRET.length > 0 && safeEqual(provided, INTERNAL_SECRET));
  if (!authorized) return h.fail("unauthorized", 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: fromDb, error: evalErr } = await sb.rpc("ops_alerts_evaluate");
    if (evalErr) throw new Error(`evaluate:${evalErr.message}`);
    const active: Active[] = [...((fromDb as Active[]) ?? []), ...(await checkWaha(sb))];

    const { data: synced, error: syncErr } = await sb.rpc("ops_alerts_sync", { _active: active });
    if (syncErr) throw new Error(`sync:${syncErr.message}`);
    const notify: Notify[] = (synced as any)?.notify ?? [];
    const settings = (synced as any)?.settings ?? {};
    const adminPhone: string | null = (synced as any)?.admin_phone ?? null;

    let sent = 0;
    if (settings.enabled !== false) {
      for (const n of notify) {
        const externalConfigured = Boolean(settings.ntfy_topic) || Boolean(settings.notify_whatsapp && adminPhone);
        let delivered = false;
        if (settings.ntfy_topic) delivered = (await sendNtfy(String(settings.ntfy_topic), n)) || delivered;
        // WhatsApp só serve de canal quando a falha não é do próprio WhatsApp.
        const whatsappIsTheProblem = /^(whatsapp|waha|inbound)/.test(n.key) || n.key.startsWith("cron_whatsapp");
        if (settings.notify_whatsapp && adminPhone && !whatsappIsTheProblem) {
          const m = messageFor(n);
          const { error } = await sb.from("outbound_messages").insert({ to_phone: adminPhone, body: `${m.title}\n${m.body}`, kind: "system" });
          delivered = !error || delivered;
        }
        // Sem canal externo configurado, o aviso fica só no painel; com canal, só marca como avisado se algum entregou.
        if (!externalConfigured || delivered) {
          await sb.rpc("ops_alerts_ack", { _id: n.id, _kind: n.kind });
          if (delivered) sent++;
        }
      }
    }
    await writeJobHeartbeat({ jobKey: "ops-alerts-tick", ok: true, processed: notify.length, failed: 0 }).catch(() => {});
    return h.ok({ ok: true, active: active.map((a) => a.key), notified: sent });
  } catch (e) {
    await writeJobHeartbeat({ jobKey: "ops-alerts-tick", ok: false, processed: 0, failed: 1 }).catch(() => {});
    console.error("ops-alerts-tick", String((e as Error)?.message ?? e).slice(0, 200));
    return h.fail("ops_alerts_failed", 500);
  }
});
