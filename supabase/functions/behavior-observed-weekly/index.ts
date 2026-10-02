// Edge Function: behavior-observed-weekly (`behavior_observed_runtime.v1`)
//
// Grava, uma vez por semana, a leitura "Nino observa" de TODOS os usuários
// ativos em `behavior_observed_snapshots` (upsert por user_id + week_start),
// sem depender de o usuário abrir a tela. O cálculo é o mesmo motor canônico
// da UI (`_shared/finance-core/behaviorObserved.ts`).
//
// Acesso: somente com `x-cron-secret` (mesmo padrão de `nino-insights`).
// Corpo opcional: { user_id } para um usuário; { cursor, limit } para lotes.
// Sem tempo suficiente para todos, reagenda a si mesma com o próximo cursor.
// Nenhuma ação movimenta dinheiro.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { saveWeeklyObservedSnapshot, type WeeklySnapshotOutcome } from "../_shared/behavioral/observedRuntime.ts";
import { matchesAnySecret } from "../_shared/security/secrets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRETS = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_BUDGET_MS = 100_000;
const CONCURRENCY = 4;
const ACTIVE_WINDOW_DAYS = 45;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !matchesAnySecret(secret, CRON_SECRETS)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { user_id?: unknown; cursor?: unknown; limit?: unknown } = {};
  try { body = await req.json(); } catch { /* corpo vazio = todos */ }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();

  if (body.user_id !== undefined) {
    if (typeof body.user_id !== "string" || !UUID_RX.test(body.user_id)) return json({ ok: false, error: "invalid_user_id" }, 400);
    const outcome = await saveWeeklyObservedSnapshot(sb, body.user_id);
    return json({ ok: outcome.status !== "error", outcome });
  }

  const cursor = typeof body.cursor === "string" && UUID_RX.test(body.cursor) ? body.cursor : null;
  const limit = Math.min(2000, Math.max(1, Number(body.limit ?? 500) || 500));
  const { data: ids, error } = await sb.rpc("behavior_observed_active_users", {
    p_since_days: ACTIVE_WINDOW_DAYS, p_after: cursor, p_limit: limit,
  });
  if (error) return json({ ok: false, error: `active_users:${error.message}` }, 500);
  const users = ((ids ?? []) as any[]).map((row) => String(row.user_id ?? row)).filter((id) => UUID_RX.test(id));

  const outcomes: WeeklySnapshotOutcome[] = [];
  let index = 0;
  let lastProcessed: string | null = null;
  const worker = async () => {
    while (index < users.length && Date.now() - started < TIME_BUDGET_MS) {
      const userId = users[index++];
      outcomes.push(await saveWeeklyObservedSnapshot(sb, userId));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // Usuários são processados em ordem; o cursor é o último iniciado.
  lastProcessed = index > 0 ? users[index - 1] : cursor;

  const unfinished = index < users.length || users.length === limit;
  let continued = false;
  if (unfinished && lastProcessed) {
    const next = fetch(`${SUPABASE_URL}/functions/v1/behavior-observed-weekly`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ cursor: lastProcessed, limit }),
    }).catch((e) => console.error("[behavior-observed-weekly] continuation failed", String(e).slice(0, 200)));
    // Mantém a função viva até a continuação ser despachada.
    (globalThis as any).EdgeRuntime?.waitUntil?.(next);
    continued = true;
  }

  const summary = {
    saved: outcomes.filter((o) => o.status === "saved").length,
    skipped_low_coverage: outcomes.filter((o) => o.status === "skipped_low_coverage").length,
    errors: outcomes.filter((o) => o.status === "error").length,
  };
  if (summary.errors) console.error("[behavior-observed-weekly] errors", JSON.stringify(outcomes.filter((o) => o.status === "error").slice(0, 10)));
  return json({ ok: true, processed: outcomes.length, ...summary, continued, duration_ms: Date.now() - started });
});
