// FeatureFlags — leitura server-side dos flags em public.financial_feature_flags.
// Cache curto em memória (60s) para evitar hit por turno. Fail-open com defaults.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type FlagName =
  | "artifacts_v2_strict"
  | "commit_movement_rpc"
  | "channel_guard"
  | "shared_goals"
  | "split_v2"
  | "outbound_dlq";

const DEFAULTS: Record<FlagName, boolean> = {
  artifacts_v2_strict: false,
  commit_movement_rpc: false,
  channel_guard: true,
  shared_goals: false,
  split_v2: true,
  outbound_dlq: true,
};

let cache: { at: number; map: Record<string, boolean> } | null = null;
const TTL_MS = 60_000;

async function load(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.from("financial_feature_flags").select("flag_name,enabled");
    const map: Record<string, boolean> = {};
    for (const row of (data ?? []) as Array<{ flag_name: string; enabled: boolean }>) {
      map[row.flag_name] = Boolean(row.enabled);
    }
    cache = { at: Date.now(), map };
    return map;
  } catch (_e) {
    return {};
  }
}

export async function isEnabled(name: FlagName, userId?: string): Promise<boolean> {
  const map = await load();
  if (name in map) return map[name];
  return DEFAULTS[name] ?? false;
  // userId reservado para rollout gradual — aplicar hash % 100 quando habilitado.
}

export function resetFlagCacheForTests() {
  cache = null;
}
