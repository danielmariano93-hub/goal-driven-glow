#!/usr/bin/env node
/**
 * Sincroniza o pacote canônico `finance-core` para as Edge Functions.
 *
 * FONTE: src/lib/engine/{facts,spendingRhythm,dailyAverage,cardExposure,metrics}.ts
 * ESPELHO: supabase/functions/_shared/finance-core/*
 *
 * Contrato: `finance_contract.v2` — App, Edge Functions, Nino e MCP consomem
 * exatamente as mesmas fórmulas. As únicas transformações permitidas são
 * mecânicas e determinísticas:
 *  1. especificadores relativos ganham extensão `.ts` (exigência do Deno);
 *  2. o import de `../privacy` (que depende de contexto do browser) é
 *     substituído por um formatador BRL local equivalente.
 *
 * O teste de paridade `src/test/finance-core-parity.test.ts` falha se o espelho
 * divergir da fonte.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const FINANCE_CORE_MODULES = [
  "facts",
  "spendingRhythm",
  "dailyAverage",
  "cardExposure",
  "metrics",
];

export const FINANCE_CONTRACT_VERSION = "finance_contract.v2";

const HEADER = `// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.\n` +
  `// Fonte canônica: src/lib/engine/<module>.ts (${FINANCE_CONTRACT_VERSION})\n`;

const PRIVACY_SHIM = `// shim determinístico do formatador (Deno não tem contexto de privacidade da UI)
const formatPrivateBRL = (n: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
`;

export function toEdgeSource(source) {
  let out = source
    .replace(/from "\.\/(facts|spendingRhythm|dailyAverage|cardExposure|metrics)"/g, 'from "./$1.ts"')
    .replace(/import \{ formatPrivateBRL \} from "\.\.\/privacy";\n/g, PRIVACY_SHIM);
  return HEADER + out;
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
    HEADER +
      `export const FINANCE_CONTRACT_VERSION = "${FINANCE_CONTRACT_VERSION}";\n` +
      FINANCE_CORE_MODULES.map((m) => `export * from "./${m}.ts";`).join("\n") +
      // Nomes presentes em mais de um módulo: a fonte é sempre spendingRhythm.
      `\nexport type { DateRange, Trend } from "./spendingRhythm.ts";\n` +
      `export { daysInclusive, formatRangeShort } from "./spendingRhythm.ts";\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
