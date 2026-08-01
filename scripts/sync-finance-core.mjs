#!/usr/bin/env node
/**
 * Sincroniza o pacote canônico `finance-core` para as Edge Functions.
 *
 * FONTE: src/lib/engine/{spendingRhythm,cardExposure}.ts
 * ESPELHO: supabase/functions/_shared/finance-core/*
 *
 * A única transformação permitida é a reescrita de especificadores relativos
 * (Deno exige extensão `.ts`). O teste de paridade
 * `src/test/finance-core-parity.test.ts` falha se o espelho divergir.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const FINANCE_CORE_MODULES = ["spendingRhythm", "cardExposure"];

const HEADER = `// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.\n` +
  `// Fonte canônica: src/lib/engine/<module>.ts\n`;

export function toEdgeSource(source) {
  return HEADER + source.replace(/from "\.\/facts"/g, 'from "../engine/facts.ts"');
}

export function readAppSource(mod) {
  return readFileSync(resolve(`src/lib/engine/${mod}.ts`), "utf8");
}

export function edgePath(mod) {
  return resolve(`supabase/functions/_shared/finance-core/${mod}.ts`);
}

function main() {
  mkdirSync(resolve("supabase/functions/_shared/finance-core"), { recursive: true });
  for (const mod of FINANCE_CORE_MODULES) {
    writeFileSync(edgePath(mod), toEdgeSource(readAppSource(mod)));
    console.log(`finance-core: ${mod}.ts sincronizado`);
  }
  writeFileSync(
    resolve("supabase/functions/_shared/finance-core/index.ts"),
    HEADER + FINANCE_CORE_MODULES.map((m) => `export * from "./${m}.ts";`).join("\n") + "\n",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
