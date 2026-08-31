// finance-current-snapshot-worker (`home_snapshot.v4`)
// ====================================================
// Recalcula o read model corrente FORA do caminho de navegação.
// A fila é preenchida pelos triggers de verdade financeira; o claim só libera
// o usuário quando os meses sujos já foram processados pelo finance-facts-worker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function todaySP(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secrets = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!secrets.length || !secrets.includes(provided)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { body = {}; }
  const limit = Math.max(1, Math.min(Number(body.limit ?? 12), 30));

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: claimed, error: claimError } = await sb.rpc("finance_snapshot_refresh_claim", {
    p_limit: limit,
    p_lease_seconds: 180,
  });
  if (claimError) return json({ ok: false, error: "claim_failed", message: claimError.message }, 500);

  const today = todaySP();
  const start = `${today.slice(0, 7)}-01`;
  const rows = (claimed ?? []) as Array<{ user_id: string; claimed_marked_at: string }>;

  const results: Array<{
    user_id: string; ok: boolean; compute_ms?: number | null; cache_hit?: boolean; error?: string;
  }> = [];
  const concurrency = 3;
  for (let offset = 0; offset < rows.length; offset += concurrency) {
    const batch = rows.slice(offset, offset + concurrency);
    const batchResults = await Promise.all(batch.map(async (row) => {
      const userId = String(row.user_id);
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/home-snapshot`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": provided,
          },
          body: JSON.stringify({
            user_id: userId,
            start,
            end: today,
            today,
            force_refresh: true,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.message ?? payload?.error ?? `home_snapshot_${response.status}`);
        }
        await sb.rpc("finance_snapshot_refresh_done", {
          p_user: userId,
          p_claimed_marked_at: row.claimed_marked_at,
        });
        return { user_id: userId, ok: true, compute_ms: payload?.compute_ms ?? null, cache_hit: payload?.cache_hit ?? false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await sb.rpc("finance_snapshot_refresh_failed", {
          p_user: userId,
          p_error: message.slice(0, 500),
        });
        return { user_id: userId, ok: false, error: message };
      }
    }));
    results.push(...batchResults);
  }

  return json({
    ok: true,
    contract_version: "home_snapshot.v4",
    claimed: rows.length,
    processed: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  });
});
