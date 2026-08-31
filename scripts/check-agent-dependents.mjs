#!/usr/bin/env node
/**
 * check-agent-dependents (`nino_analytical.v2`)
 *
 * Causa-raiz que este script fecha: cada Edge Function embute sua própria cópia
 * de `_shared`. Mudar `_shared/agent` e redeployar só o webhook deixa runtime
 * antigo respondendo em produção (drift invisível).
 *
 * O script varre os imports reais das funções e compara com a lista declarada
 * em `supabase/functions/_shared/agent/DEPENDENTS.md`. Divergência = erro.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";
const DEPENDENTS_DOC = join(FUNCTIONS_DIR, "_shared/agent/DEPENDENTS.md");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const functionDirs = readdirSync(FUNCTIONS_DIR).filter((name) =>
  !name.startsWith("_") && statSync(join(FUNCTIONS_DIR, name)).isDirectory()
);

const actual = functionDirs.filter((name) =>
  walk(join(FUNCTIONS_DIR, name)).some((file) =>
    /_shared\/agent/.test(readFileSync(file, "utf8"))
  )
).sort();

const doc = readFileSync(DEPENDENTS_DOC, "utf8");
const declared = [...doc.matchAll(/^- `([a-z0-9-]+)`$/gm)].map((m) => m[1]).sort();

const missing = actual.filter((f) => !declared.includes(f));
const stale = declared.filter((f) => !actual.includes(f));

if (missing.length || stale.length) {
  if (missing.length) console.error("Funções dependentes NÃO declaradas em DEPENDENTS.md:", missing.join(", "));
  if (stale.length) console.error("Funções declaradas que já não dependem de _shared/agent:", stale.join(", "));
  console.error("Corrija DEPENDENTS.md — a lista guia o redeploy atômico.");
  process.exit(1);
}

console.log(`check-agent-dependents OK — ${actual.length} funções dependentes declaradas:`);
console.log("  " + actual.join(", "));
