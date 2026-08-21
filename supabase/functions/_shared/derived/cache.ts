// perf_derived.v1 — cache de leitura derivada orientado a evento
// ==============================================================
// A verdade continua sendo o ledger + os motores canônicos. Aqui só existe
// MEMOIZAÇÃO: o resultado derivado é guardado junto da versão do ledger do
// usuário (`financial_ledger_versions`, incrementada por trigger a cada
// escrita financeira). Enquanto a versão não muda, ninguém recalcula nada —
// e quando muda, o cache é ignorado imediatamente (sem esperar tempo passar).
//
// Nada aqui escreve no ledger.

// deno-lint-ignore no-explicit-any
type Client = any;

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
  const { data, error } = await sb
    .from("financial_derived_cache")
    .select("payload, computed_at, ledger_version")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data) return null;
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
  await sb.from("financial_derived_cache").upsert({
    user_id: userId,
    cache_key: cacheKey,
    ledger_version: ledgerVersion,
    contract_version: "perf_derived.v1",
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
