#!/usr/bin/env node
/**
 * Sincroniza o motor de hábitos (`habits-core`) para as Edge Functions.
 *
 * FONTE: src/lib/habits/engine/*.ts      ESPELHO: supabase/functions/_shared/habits-core/*
 * Única transformação permitida (mecânica): especificadores relativos ganham extensão `.ts` (exigência do Deno).
 * O teste `src/test/habits-core-parity.test.ts` falha se o espelho divergir da fonte.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const HABITS_CORE_MODULES = ["types", "dates", "outcomes", "metrics"];
export const HABITS_CONTRACT_VERSION = "habits_contract.v1";

const HEADER = `// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.\n` +
  `// Fonte canônica: src/lib/habits/engine/<module>.ts (${HABITS_CONTRACT_VERSION})\n`;

export function toEdgeSource(source) {
  const relative = new RegExp(`from "\\./(${HABITS_CORE_MODULES.join("|")})"`, "g");
  return HEADER + source.replace(relative, 'from "./$1.ts"');
}

export const readAppSource = (mod) => readFileSync(resolve(`src/lib/habits/engine/${mod}.ts`), "utf8");
export const edgePath = (mod) => resolve(`supabase/functions/_shared/habits-core/${mod}.ts`);
export const edgeIndexPath = () => resolve("supabase/functions/_shared/habits-core/index.ts");
export const edgeIndexSource = () =>
  HEADER + HABITS_CORE_MODULES.map((m) => `export * from "./${m}.ts";`).join("\n") + "\n";

function main() {
  mkdirSync(resolve("supabase/functions/_shared/habits-core"), { recursive: true });
  for (const mod of HABITS_CORE_MODULES) {
    writeFileSync(edgePath(mod), toEdgeSource(readAppSource(mod)));
    console.log(`habits-core: ${mod}.ts sincronizado`);
  }
  writeFileSync(edgeIndexPath(), edgeIndexSource());
}

if (import.meta.url === `file://${process.argv[1]}`) main();
