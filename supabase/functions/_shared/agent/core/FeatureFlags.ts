// FeatureFlags — leitura server-side dos flags globais do agente em
// `public.agent_runtime_flags`. Cache curto em memória (60s) para evitar hit por
// turno. Fail-open com defaults.
//
// Antes este módulo lia `financial_feature_flags` (tabela por usuário, com uma
// coluna booleana por recurso) procurando colunas `flag_name/enabled` que nunca
// existiram: toda leitura caía silenciosamente no default e nenhum flag era
// realmente consultável em produção. `agent_runtime_flags` é a tabela chave/valor
// que o runtime consulta de fato (`nino_efficiency.v2`).
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
  | "outbound_dlq"
  // Eficiência de IA (`nino_efficiency.v2`) — rollback granular real.
  | "evidence_pack_v1"
  | "deterministic_first_v2"
  | "progressive_tools_v1"
  | "context_budget_v2"
  | "model_routing_v2"
  | "document_efficiency_v1";

const DEFAULTS: Record<FlagName, boolean> = {
  artifacts_v2_strict: false,
  commit_movement_rpc: false,
  channel_guard: true,
  shared_goals: false,
  split_v2: true,
  outbound_dlq: true,
  evidence_pack_v1: true,
  deterministic_first_v2: true,
  progressive_tools_v1: true,
  context_budget_v2: true,
  model_routing_v2: true,
  document_efficiency_v1: true,
};

let cache: { at: number; map: Record<string, boolean> } | null = null;
const TTL_MS = 60_000;

async function load(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.from("agent_runtime_flags").select("flag_name,enabled");
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

/** Lê vários flags de uma vez (uma única leitura/cache). */
export async function flagSnapshot<T extends FlagName>(names: readonly T[]): Promise<Record<T, boolean>> {
  const map = await load();
  const out = {} as Record<T, boolean>;
  for (const name of names) {
    out[name] = name in map ? map[name] : (DEFAULTS[name] ?? false);
  }
  return out;
}

export function resetFlagCacheForTests() {
  cache = null;
}
