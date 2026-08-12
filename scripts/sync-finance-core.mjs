#!/usr/bin/env node
/**
 * Sincroniza o pacote canônico `finance-core` para as Edge Functions.
 *
 * FONTE: src/lib/engine/{facts,bridges,spendingRhythm,dailyAverage,cardExposure,incomeProjection,metrics}.ts
 * ESPELHO: supabase/functions/_shared/finance-core/*
 *
 * Contrato: `finance_contract.v3` — App, Edge Functions, Nino e MCP consomem
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
  "engineEnvelope",
  "merchant",
  "merchantIntelligence",
  "behaviorChange",
  "recurringDiscovery",
  "costStructure",
  "anomalies",
  "savingsOpportunities",
  "financialEvolution",
  "bridges",
  "spendingRhythm",
  "dailyAverage",
  "cardExposure",
  "incomeProjection",
  "commitmentAgenda",
  "metrics",
];

export const REPORT_MODULES = [
  "types",
  "periods",
  "engine",
  "highlights",
  "numericGuard",
  "narrative",
  "index",
];

export const COPY_MODULES = ["resultWording"];


export const FINANCE_CONTRACT_VERSION = "finance_contract.v4";

const HEADER = `// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.\n` +
  `// Fonte canônica: src/lib/engine/<module>.ts (${FINANCE_CONTRACT_VERSION})\n`;

const PRIVACY_SHIM = `// shim determinístico do formatador (Deno não tem contexto de privacidade da UI)
const formatPrivateBRL = (n: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
`;

export function toEdgeSource(source) {
  const relative = new RegExp(`from "\\./(${FINANCE_CORE_MODULES.join("|")})"`, "g");
  let out = source
    .replace(relative, 'from "./$1.ts"')
    .replace(/import \{ formatPrivateBRL \} from "\.\.\/privacy";\n/g, PRIVACY_SHIM);
  return HEADER + out;
}

export function toEdgeReportSource(source) {
  const out = source
    .replace(new RegExp(`from "@/lib/engine/(${FINANCE_CORE_MODULES.join("|")})"`, "g"), 'from "../finance-core/$1.ts"')
    .replace(/from "@\/lib\/copy\/(resultWording)"/g, 'from "../copy/$1.ts"')
    .replace(/from "\.\/(types|periods|engine|highlights|numericGuard|narrative)"/g, 'from "./$1.ts"');
  return HEADER + out;
}

export function toEdgeCopySource(source) {
  return HEADER + source;
}

export function readCopySource(mod) {
  return readFileSync(resolve(`src/lib/copy/${mod}.ts`), "utf8");
}

export function copyEdgePath(mod) {
  return resolve(`supabase/functions/_shared/copy/${mod}.ts`);
}

export function readReportSource(mod) {
  return readFileSync(resolve(`src/lib/reports/intelligent/${mod}.ts`), "utf8");
}

export function reportEdgePath(mod) {
  return resolve(`supabase/functions/_shared/reports-core/${mod}.ts`);
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

  mkdirSync(resolve("supabase/functions/_shared/copy"), { recursive: true });
  for (const mod of COPY_MODULES) {
    writeFileSync(copyEdgePath(mod), toEdgeCopySource(readCopySource(mod)));
    console.log(`copy: ${mod}.ts sincronizado`);
  }

  mkdirSync(resolve("supabase/functions/_shared/reports-core"), { recursive: true });
  for (const mod of REPORT_MODULES) {
    writeFileSync(reportEdgePath(mod), toEdgeReportSource(readReportSource(mod)));
    console.log(`reports-core: ${mod}.ts sincronizado`);
  }

}

if (import.meta.url === `file://${process.argv[1]}`) main();
