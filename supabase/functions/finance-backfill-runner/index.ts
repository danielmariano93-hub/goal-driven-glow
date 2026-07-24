// finance-backfill-runner — executa o backfill canônico em fases idempotentes.
// Fatia D fase 2. Gate: header x-cron-secret == CRON_SECRET, ou service role.
// Timebox de 25s por invocação, heartbeat obrigatório, sem cron novo agendado.
//
// Máquina de estados por (job_key, cursor_user_id):
//   baseline   → backfill    (baseline foi computado pela migration canônica)
//   backfill   → dual_read   (nada a reprocessar; is_behavioral_consumption é generated column)
//   dual_read  → cutover     se abs(canonical - legacy) <= 0.01 para o período
//                            se divergente: registra em financial_metric_diffs e permanece
//   cutover    → terminal
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const JOB_KEY = "canonical_finance_backfill";
const TIMEBOX_MS = 25_000;
const DIFF_EPSILON = 0.01;

type Phase = "baseline" | "backfill" | "dual_read" | "cutover";

type Checkpoint = {
  job_key: string;
  cursor_user_id: string;
  cursor_date: string | null;
  status: string | null;
  attempts: number;
  rows_processed: number;
  phase: Phase;
  last_error: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const cronHdr = req.headers.get("x-cron-secret") ?? "";
  const authHdr = req.headers.get("Authorization") ?? "";
  const okCron = CRON_SECRET.length > 0 && cronHdr === CRON_SECRET;
  const okService = authHdr === `Bearer ${SERVICE_ROLE}`;
  if (!okCron && !okService) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const start = Date.now();
  const stats = { processed: 0, advanced: 0, cutover: 0, diffs: 0, failed: 0, ids: [] as string[] };

  try {
    // Busca checkpoints pendentes (phase != cutover), mais antigos primeiro.
    const { data: rows, error } = await sb
      .from("financial_backfill_checkpoints")
      .select("job_key, cursor_user_id, cursor_date, status, attempts, rows_processed, phase, last_error")
      .eq("job_key", JOB_KEY)
      .neq("phase", "cutover")
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(50);

    if (error) throw error;

    for (const cpRaw of (rows ?? []) as Checkpoint[]) {
      if (Date.now() - start > TIMEBOX_MS) break;
      const cp = cpRaw;
      stats.processed += 1;
      stats.ids.push(cp.cursor_user_id);
      try {
        const nextPhase = await advancePhase(sb, cp, stats);
        if (nextPhase !== cp.phase) {
          stats.advanced += 1;
          if (nextPhase === "cutover") stats.cutover += 1;
          await sb.from("financial_backfill_checkpoints").update({
            phase: nextPhase,
            status: nextPhase === "cutover" ? "done" : "running",
            attempts: (cp.attempts ?? 0) + 1,
            last_error: null,
            updated_at: new Date().toISOString(),
          }).match({ job_key: cp.job_key, cursor_user_id: cp.cursor_user_id });
        } else {
          await sb.from("financial_backfill_checkpoints").update({
            attempts: (cp.attempts ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }).match({ job_key: cp.job_key, cursor_user_id: cp.cursor_user_id });
        }
      } catch (e) {
        stats.failed += 1;
        await sb.from("financial_backfill_checkpoints").update({
          attempts: (cp.attempts ?? 0) + 1,
          last_error: String((e as Error).message ?? e).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).match({ job_key: cp.job_key, cursor_user_id: cp.cursor_user_id });
      }
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(writeJobHeartbeat({
      jobKey: "finance-backfill-runner",
      ok: stats.failed === 0,
      processed: stats.processed,
      failed: stats.failed,
    }));

    console.info(JSON.stringify({ event: "backfill_tick", ...stats }));
    return json({ ok: true, ...stats });
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(writeJobHeartbeat({
      jobKey: "finance-backfill-runner",
      ok: false,
      processed: stats.processed,
      failed: stats.failed + 1,
      errorCode: "runner_failure",
    }));
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function advancePhase(sb: any, cp: Checkpoint, stats: { diffs: number }): Promise<Phase> {
  if (cp.phase === "baseline") return "backfill";
  if (cp.phase === "backfill") return "dual_read";
  if (cp.phase === "dual_read") {
    const diverges = await computeAndRecordDiff(sb, cp);
    if (diverges) {
      stats.diffs += 1;
      return "dual_read";
    }
    return "cutover";
  }
  return cp.phase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeAndRecordDiff(sb: any, cp: Checkpoint): Promise<boolean> {
  // Janela do dual_read: últimos 90 dias até hoje (SP).
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const { data: facts } = await sb
    .from("financial_daily_facts")
    .select("behavioral_consumption")
    .eq("user_id", cp.cursor_user_id)
    .gte("fact_date", from)
    .lte("fact_date", today);
  const canonical = (facts ?? []).reduce(
    (a: number, r: { behavioral_consumption: number | string }) => a + Number(r.behavioral_consumption ?? 0),
    0,
  );

  const { data: txs } = await sb
    .from("transactions")
    .select("amount, type, status, movement_kind")
    .eq("user_id", cp.cursor_user_id)
    .eq("type", "expense")
    .eq("status", "confirmed")
    .gte("occurred_at", from)
    .lte("occurred_at", today);
  const legacy = (txs ?? [])
    .filter((t: { movement_kind: string | null }) => (t.movement_kind ?? "transaction") === "transaction")
    .reduce((a: number, t: { amount: number | string }) => a + Number(t.amount ?? 0), 0);

  const absDiff = Math.abs(canonical - legacy);
  if (absDiff <= DIFF_EPSILON) return false;

  await sb.from("financial_metric_diffs").insert({
    user_id: cp.cursor_user_id,
    metric_key: "behavioral_consumption_90d",
    period_start: from,
    period_end: today,
    legacy_value: legacy,
    canonical_value: canonical,
    absolute_diff: absDiff,
    legacy_formula: "transactions.expense.confirmed.sum(amount)",
    canonical_formula: "financial_daily_facts.behavioral_consumption.sum",
  });
  return true;
}
