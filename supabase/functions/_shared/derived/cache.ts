// perf_derived.v2 — cache derivado versionado por ledger E por deploy
// ================================================================
// A verdade continua sendo o ledger + os motores canônicos. O cache só é
// reutilizado quando DUAS versões coincidem:
//   1) financial_ledger_versions do usuário;
//   2) DENO_DEPLOYMENT_ID da Edge Function que está executando o código.
//
// Isso impede que um deploy com fórmula nova reaproveite silenciosamente um
// payload produzido por código antigo, mesmo quando nenhum lançamento mudou.
// Nada aqui escreve no ledger.

// deno-lint-ignore no-explicit-any
type Client = any;

const CACHE_CONTRACT = "perf_derived.v2";
const DEPLOYMENT_ID = Deno.env.get("DENO_DEPLOYMENT_ID") || "local";

/** Namespace de cache por versão real do código executado. */
export function deploymentScopedCacheKey(cacheKey: string): string {
  return `edge:${DEPLOYMENT_ID}|${cacheKey}`;
}

export async function getLedgerVersion(sb: Client, userId: string): Promise<number> {
  const { data } = await sb
    .from("financial_ledger_versions")
    .select("version")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.version ?? 0);
}

export async function readDerivedCache<T>(
  sb: Client,
  userId: string,
  cacheKey: string,
  ledgerVersion: number,
): Promise<{ payload: T; computed_at: string } | null> {
  const scopedKey = deploymentScopedCacheKey(cacheKey);
  const { data, error } = await sb
    .from("financial_derived_cache")
    .select("payload, computed_at, ledger_version, contract_version")
    .eq("user_id", userId)
    .eq("cache_key", scopedKey)
    .maybeSingle();
  if (error || !data) return null;
  if (data.contract_version !== CACHE_CONTRACT) return null;
  if (Number(data.ledger_version) !== ledgerVersion) return null;
  return { payload: data.payload as T, computed_at: data.computed_at as string };
}

export async function writeDerivedCache(
  sb: Client,
  userId: string,
  cacheKey: string,
  ledgerVersion: number,
  payload: unknown,
  computeMs: number,
): Promise<void> {
  const scopedKey = deploymentScopedCacheKey(cacheKey);
  await sb.from("financial_derived_cache").upsert({
    user_id: userId,
    cache_key: scopedKey,
    ledger_version: ledgerVersion,
    contract_version: CACHE_CONTRACT,
    payload: payload as never,
    computed_at: new Date().toISOString(),
    compute_ms: Math.round(computeMs),
  }, { onConflict: "user_id,cache_key" });
}

/** Marca como processados os meses sujos até o instante da leitura. */
export async function markDirtyProcessed(sb: Client, userId: string): Promise<void> {
  await sb
    .from("financial_dirty_periods")
    .update({ processed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("processed_at", null);
}
