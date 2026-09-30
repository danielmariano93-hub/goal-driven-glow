// Edge Function: nino-insights (`nino_executive_insights.v1`)
// Leitura executiva das finanças da pessoa para a tela do Nino.
// - get: devolve a leitura do dia (cache de 30 min), recalculando se preciso;
// - refresh: recalcula agora;
// - feedback: registra útil / não ajudou / dispensar para uma causa-raiz.
// Com x-cron-secret aceita { user_id } (verificação interna/cron).
// Nenhuma ação movimenta dinheiro.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { computeExecutiveInsights, EXECUTIVE_INSIGHTS_VERSION } from "../_shared/insights/executive/engine.ts";
import { loadExecutiveInput } from "../_shared/insights/executive/load.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRETS = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);
const CACHE_MS = 30 * 60_000;
/** "Não ajudou"/"dispensar" silenciam a mesma causa por 30 dias. */
const SUPPRESS_DAYS = 30;
const FEEDBACK = new Set(["useful", "not_useful", "dismiss", "acted"]);

function todaySP(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function suppressedKeys(sb: any, userId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - SUPPRESS_DAYS * 86_400_000).toISOString();
  const { data } = await sb.from("nino_executive_insight_feedback")
    .select("insight_key,feedback")
    .eq("user_id", userId)
    .in("feedback", ["not_useful", "dismiss"])
    .gte("created_at", since);
  return new Set(((data ?? []) as any[]).map((row) => String(row.insight_key)));
}

async function briefingFor(sb: any, userId: string, force: boolean) {
  const asOf = todaySP();
  if (!force) {
    const { data: cached } = await sb.from("nino_executive_insights")
      .select("as_of,payload,computed_at").eq("user_id", userId).maybeSingle();
    const fresh = cached
      && String(cached.as_of) === asOf
      && cached.payload?.version === EXECUTIVE_INSIGHTS_VERSION
      && Date.now() - Date.parse(String(cached.computed_at)) < CACHE_MS;
    if (fresh) return cached.payload;
  }
  const briefing = computeExecutiveInsights(await loadExecutiveInput(sb, userId, asOf));
  await sb.from("nino_executive_insights").upsert({
    user_id: userId, as_of: asOf, payload: briefing, computed_at: new Date().toISOString(),
  });
  return briefing;
}

Deno.serve(async (req) => {
  const h = httpContext("nino-insights", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  let body: { action?: unknown; user_id?: unknown; key?: unknown; kind?: unknown; feedback?: unknown } = {};
  try { body = await req.json(); } catch { /* corpo vazio = get */ }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let userId: string | null = null;
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  if (cronHeader && CRON_SECRETS.includes(cronHeader) && typeof body.user_id === "string") {
    userId = body.user_id;
  } else {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return h.fail("unauthorized", 401);
    const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u } = await sbAuth.auth.getUser();
    userId = u?.user?.id ?? null;
  }
  if (!userId) return h.fail("unauthorized", 401);

  const action = typeof body.action === "string" ? body.action : "get";
  try {
    if (action === "feedback") {
      const key = typeof body.key === "string" ? body.key.slice(0, 200) : "";
      const feedback = typeof body.feedback === "string" ? body.feedback : "";
      if (!key || !FEEDBACK.has(feedback)) return h.fail("invalid_feedback", 400);
      const { error } = await sb.from("nino_executive_insight_feedback").insert({
        user_id: userId,
        insight_key: key,
        insight_kind: typeof body.kind === "string" ? body.kind.slice(0, 60) : "unknown",
        feedback,
      });
      if (error) throw new Error(`feedback:${error.message}`);
      return h.ok({ ok: true });
    }
    if (action !== "get" && action !== "refresh") return h.fail("invalid_action", 400);

    const [briefing, hidden] = await Promise.all([
      briefingFor(sb, userId, action === "refresh"),
      suppressedKeys(sb, userId),
    ]);
    return h.ok({
      ok: true,
      briefing: { ...briefing, insights: (briefing.insights ?? []).filter((i: any) => !hidden.has(String(i.key))) },
    });
  } catch (error) {
    console.error("[nino-insights]", String((error as Error)?.message ?? error).slice(0, 300));
    return h.fail("insights_unavailable", 500);
  }
});
