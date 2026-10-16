// Edge Function: mapa-weekly (`mapa_financeiro.v1`)
//
// Grava, uma vez por semana, a leitura do Mapa Financeiro das contas liberadas (`mapa_access.enabled`) em `map_readings`,
// sem depender de a pessoa abrir a tela. É o que dá histórico para a Evolução (E10) e para o relatório de sombra da migração.
// Acesso: somente com `x-cron-secret`. Corpo opcional: { user_id } para uma conta. Nenhuma ação movimenta dinheiro.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { matchesAnySecret } from "../_shared/security/secrets.ts";
import { loadMapaReading } from "../_shared/mapa/runtime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRETS = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_BUDGET_MS = 100_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Data civil de São Paulo (mesma regra do restante do app). */
function todaySP(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !matchesAnySecret(secret, CRON_SECRETS)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { user_id?: unknown } = {};
  try { body = await req.json(); } catch { /* corpo vazio = todas as contas liberadas */ }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();

  let users: string[];
  if (body.user_id !== undefined) {
    if (typeof body.user_id !== "string" || !UUID_RX.test(body.user_id)) return json({ ok: false, error: "invalid_user_id" }, 400);
    users = [body.user_id];
  } else {
    const { data, error } = await sb.from("mapa_access").select("user_id").eq("enabled", true).limit(1000);
    if (error) return json({ ok: false, error: `mapa_access:${error.message}` }, 500);
    users = ((data ?? []) as any[]).map((r) => String(r.user_id)).filter((id) => UUID_RX.test(id));
  }

  const today = todaySP();
  const outcomes: Array<{ user_id: string; status: "saved" | "error" | "skipped"; indicators?: number; error?: string }> = [];
  for (const userId of users) {
    if (Date.now() - started > TIME_BUDGET_MS) { outcomes.push({ user_id: userId, status: "skipped" }); continue; }
    try {
      const reading = await loadMapaReading(sb, userId, today, { persist: true });
      outcomes.push({ user_id: userId, status: "saved", indicators: reading.indicators.length });
    } catch (error) {
      console.error("[mapa-weekly] failed", userId, String(error).slice(0, 200));
      outcomes.push({ user_id: userId, status: "error", error: String(error).slice(0, 120) });
    }
  }
  return json({
    ok: outcomes.every((o) => o.status !== "error"), as_of: today, total: users.length,
    saved: outcomes.filter((o) => o.status === "saved").length, errors: outcomes.filter((o) => o.status === "error").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
  });
});
