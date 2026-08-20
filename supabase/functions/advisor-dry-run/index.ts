// Edge Function: advisor-dry-run
// Observabilidade do consultor: mostra como o Nino avaliaria um usuário HOJE,
// usando os motores canônicos (financial_performance.v1 + advisor_relevance.v1).
// Nunca grava snapshot, nunca enfileira mensagem — leitura pura.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { computeFinancialPerformance } from "../_shared/finance-core/financialPerformance.ts";
import { computeAdvisorDecision } from "../_shared/finance-core/advisorRelevance.ts";
import { today as localToday } from "../_shared/finance-core/ninoClock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const h = httpContext("advisor-dry-run", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return h.fail("unauthorized", 401);

  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sbAuth.auth.getUser();
  const callerId = userData?.user?.id;
  if (userErr || !callerId) return h.fail("unauthorized", 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: adminRow } = await sb.from("platform_admins")
    .select("role, active").eq("user_id", callerId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (!adminRow || !(adminRow as any).active) return h.fail("forbidden", 403);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const target = String(body?.user_id ?? "").trim();
  if (!target) return h.fail("missing_fields", 400, { details: { field: "user_id" } });

  try {
    const asOf = localToday(null);
    const [txsRes, catsRes, affinityRes] = await Promise.all([
      sb.from("transactions").select("*")
        .eq("user_id", target)
        .gte("occurred_at", shiftDays(asOf, -420))
        .lte("occurred_at", asOf)
        .limit(20000),
      sb.from("categories").select("id,name").eq("user_id", target),
      sb.from("user_advisor_topic_affinity")
        .select("topic_key,score,signals,last_seen_at").eq("user_id", target),
    ]);

    const categoryNames = new Map<string, string>(
      // deno-lint-ignore no-explicit-any
      ((catsRes.data ?? []) as any[]).map((c) => [String(c.id), String(c.name)]),
    );
    const perf = computeFinancialPerformance({
      // deno-lint-ignore no-explicit-any
      txs: (txsRes.data ?? []) as any,
      categoryNames,
      as_of: asOf,
      mode: "MTD_EQUIVALENT",
    });
    // deno-lint-ignore no-explicit-any
    const affinity = ((affinityRes.data ?? []) as any[]).map((row) => ({
      topic_key: String(row.topic_key),
      score: Number(row.score ?? 0),
      signals: Number(row.signals ?? 0),
      last_seen: row.last_seen_at ?? null,
    }));
    const decision = computeAdvisorDecision({
      highlights: perf.highlights,
      affinity,
      as_of: asOf,
      channel: "app",
      maxItems: 4,
    });

    return h.ok({
      dry_run: true,
      persisted: false,
      as_of: asOf,
      transactions_considered: (txsRes.data ?? []).length,
      headline: decision.headline || perf.headline,
      methodology: decision.methodology,
      next_action: decision.next_action,
      items: decision.items,
      suppressed: decision.suppressed,
      comparisons: perf.comparisons,
      affinity,
      formula_version: decision.formula_version,
    });
  } catch (error) {
    return h.fail("dry_run_failed", 500, { details: { message: String((error as Error)?.message ?? error) } });
  }
});
