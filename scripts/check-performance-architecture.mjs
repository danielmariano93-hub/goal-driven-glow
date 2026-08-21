import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const home = read("src/pages/Index.tsx");
assert(!home.includes("processCategoryQueue"), "Home não pode processar fila de categorização na abertura.");

const realtime = read("src/components/finance/FinancialRealtimeSync.tsx");
assert(realtime.includes('table: "financial_ledger_versions"'), "Realtime deve reagir à versão financeira semântica.");
assert(!realtime.includes('table: "transactions"'), "Realtime não deve invalidar a Home por todo UPDATE técnico de transactions.");

const snapshotHook = read("src/lib/hooks/useFinancialSnapshot.ts");
assert(!snapshotHook.includes("!ledgerVersion.isLoading"), "Snapshot não pode esperar RPC de ledger-version antes do request principal.");
assert(snapshotHook.includes("stale_recomputing"), "Snapshot deve suportar stale-while-revalidate.");

const homeSnapshot = read("supabase/functions/home-snapshot/index.ts");
assert(homeSnapshot.includes("aheadMonths: 3"), "Home não pode reabrir a janela de 24 meses futuros do ledger.");
assert(fs.existsSync(path.join(root, "supabase/functions/finance-current-snapshot-worker/index.ts")), "Worker proativo do snapshot precisa existir.");
assert(read("supabase/functions/finance-facts-worker/index.ts").includes("finance_facts_claim_v2"), "Worker de fatos precisa usar claim versionado contra corrida de escrita.");
assert(homeSnapshot.includes("financial_current_snapshots"), "Home deve usar a visão materializada corrente.");

const pages = [
  "src/pages/Metas.tsx",
  "src/pages/MetaDetalhe.tsx",
  "src/pages/MetaCategoriaDetalhe.tsx",
  "src/pages/Cartoes.tsx",
];

for (const file of pages) {
  const source = read(file);
  assert(!/useLedgerWindow\(\s*\)/.test(source), `${file}: useLedgerWindow precisa declarar horizonte explícito.`);
}

const finance = read("src/lib/db/finance.ts");
assert(finance.includes("params.monthsBack ?? 3"), "Default de ledger window deve permanecer limitado a 3 meses de lookback.");
assert(finance.includes("params.monthsAhead ?? 1"), "Default de ledger window deve permanecer limitado a 1 mês futuro.");

const migration = read("supabase/migrations/20260821160000_nino_performance_arch_v2.sql");
assert(migration.includes("financial_snapshot_refresh_queue"), "Migration precisa criar a fila de refresh do snapshot.");
assert(migration.includes("TG_TABLE_NAME = 'transactions' AND TG_OP = 'UPDATE'"), "Invalidação deve ignorar updates puramente técnicos de transactions.");

if (failures.length) {
  console.error("\\nPerformance architecture guard falhou:\\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Performance architecture guard: OK");
