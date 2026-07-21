// Service-role Supabase client used by AgentCore and adapters.
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
