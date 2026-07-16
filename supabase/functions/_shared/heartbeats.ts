// Shared heartbeat helper for admin operational visibility.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export async function writeJobHeartbeat(opts: {
  jobKey: string;
  ok: boolean;
  processed?: number;
  failed?: number;
  errorCode?: string | null;
  nextRunAt?: string | null;
  sb?: SupabaseClient;
}) {
  const sb = opts.sb ?? createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
