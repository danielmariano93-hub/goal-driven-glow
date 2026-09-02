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

// Leitura tardia do ambiente: mantém o módulo importável fora do Deno
// (suítes de teste do app) sem afetar o comportamento em produção.
const env = (name: string): string =>
  ((globalThis as any).Deno?.env?.get(name) ?? "") as string;

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
  | "document_efficiency_v1"
  // Análise composta com escopo e completude (`nino_composite.v1`).
  | "composite_analysis_v1"
  // Semantic Compiler -> Financial Query IR. Rollout começa desligado.
  | "semantic_ir_v1"
  // `nino_semantic_ir.v3` — flags independentes, todas OFF no nascimento.
  | "semantic_ir_v3"
  | "semantic_ir_multiquery_v1"
  | "semantic_completeness_v1"
  | "semantic_allowed_claims_v1"
  | "semantic_topic_state_v1"
  | "semantic_investigation_loop_v1"
  | "semantic_capability_rescue_v1";

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
  composite_analysis_v1: true,
  semantic_ir_v1: false,
  semantic_ir_v3: false,
  semantic_ir_multiquery_v1: false,
  semantic_completeness_v1: false,
  semantic_allowed_claims_v1: false,
  semantic_topic_state_v1: false,
  semantic_investigation_loop_v1: false,
  semantic_capability_rescue_v1: false,
};

/**
 * Flags com rollout por usuário: fail-closed. Sem configuração de rollout na
 * tabela, NÃO liga globalmente por acidente.
 */
const ROLLOUT_FLAGS = new Set<FlagName>([
  "semantic_ir_v1",
  "semantic_ir_v3",
  "semantic_ir_multiquery_v1",
  "semantic_completeness_v1",
  "semantic_allowed_claims_v1",
  "semantic_topic_state_v1",
  "semantic_investigation_loop_v1",
  "semantic_capability_rescue_v1",
]);

let cache: { at: number; map: Record<string, boolean> } | null = null;
const TTL_MS = 60_000;

async function load(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
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

type RolloutConfig = {
  enabled: boolean;
  rollout_percent: number;
  pilot_user_ids: string[];
};

let rolloutCache: { at: number; map: Record<string, RolloutConfig> } | null = null;

function stableBucket(value: string): number {
  // FNV-1a 32-bit: estável entre instâncias, sem PII em log.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function rolloutDecision(
  flagName: string,
  userId: string,
  cfg: RolloutConfig,
): boolean {
  if (!cfg.enabled) return false;
  if (cfg.pilot_user_ids.includes(userId)) return true;
  const pct = Math.max(0, Math.min(100, Number(cfg.rollout_percent ?? 0)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return stableBucket(`${flagName}:${userId}`) < pct;
}

async function loadRollouts(): Promise<Record<string, RolloutConfig>> {
  if (rolloutCache && Date.now() - rolloutCache.at < TTL_MS) return rolloutCache.map;
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.from("agent_runtime_flags")
      .select("flag_name,enabled,rollout_percent,pilot_user_ids");
    if (error) throw error;
    const map: Record<string, RolloutConfig> = {};
    for (const row of (data ?? []) as Array<{
      flag_name: string; enabled: boolean; rollout_percent?: number | null; pilot_user_ids?: string[] | null;
    }>) {
      map[row.flag_name] = {
        enabled: Boolean(row.enabled),
        rollout_percent: Number(row.rollout_percent ?? 100),
        pilot_user_ids: Array.isArray(row.pilot_user_ids) ? row.pilot_user_ids.map(String) : [],
      };
    }
    rolloutCache = { at: Date.now(), map };
    return map;
  } catch {
    return {};
  }
}

export async function isEnabled(name: FlagName, userId?: string): Promise<boolean> {
  const map = await load();
  const enabled = name in map ? map[name] : (DEFAULTS[name] ?? false);
  if (!enabled || !userId || !ROLLOUT_FLAGS.has(name)) return enabled;

  // Fail-closed para o novo cérebro: se a migration de rollout ainda não
  // existe ou falhar, não ativa globalmente por acidente.
  const rollout = (await loadRollouts())[name];
  if (!rollout) return false;
  return rolloutDecision(name, userId, rollout);
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
  rolloutCache = null;
}
