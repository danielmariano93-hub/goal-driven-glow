// Shared heartbeat helper for admin operational visibility.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Contadores por estágio do funil de comunicação. Cada job soma apenas o que
 * realmente executou, então o admin lê o funil sem inferir nada.
 */
export type JobStages = Partial<Record<
  | "generated"
  | "scheduled"
  | "claimed"
  | "enqueued"
  | "app_delivered"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped"
  | "request_enqueued",
  number
>>;

export async function writeJobHeartbeat(opts: {
  jobKey: string;
  ok: boolean;
  processed?: number;
  failed?: number;
  errorCode?: string | null;
  nextRunAt?: string | null;
  stages?: JobStages;
  sb?: SupabaseClient;
}) {
  const sb = opts.sb ?? createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Com estágios, a soma acumulada acontece no banco (record_job_stages) para
  // evitar corrida entre ticks concorrentes.
  if (opts.stages && Object.keys(opts.stages).length > 0) {
    const { error } = await sb.rpc("record_job_stages", {
      p_job_key: opts.jobKey,
      p_stages: opts.stages,
      p_ok: opts.ok,
      p_processed: opts.processed ?? 0,
      p_failed: opts.failed ?? 0,
      p_error_code: opts.errorCode ?? null,
      p_next_run_at: opts.nextRunAt ?? null,
    });
    if (!error) return;
  }

  await sb.from("job_heartbeats").upsert({
    job_key: opts.jobKey,
    last_run_at: new Date().toISOString(),
    last_ok: opts.ok,
    last_error_code: opts.errorCode ?? null,
    processed: opts.processed ?? 0,
    failed: opts.failed ?? 0,
    next_run_at: opts.nextRunAt ?? null,
    updated_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}
