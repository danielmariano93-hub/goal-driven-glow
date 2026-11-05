// Catraca do ESLint: o número de erros não pode AUMENTAR em relação à linha de base (.github/eslint-baseline.json).
// Hoje há milhares de `any` explícito herdados; bloquear tudo é inviável, mas dá para impedir que piore.
// Uso: node scripts/eslint-ratchet.mjs            (compara e sai com 1 se piorou)
//      node scripts/eslint-ratchet.mjs --update   (grava a nova linha de base depois de MELHORAR)
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASELINE = ".github/eslint-baseline.json";
let raw = "[]";
try {
  raw = execFileSync("npx", ["eslint", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
} catch (error) {
  raw = String(error.stdout ?? "[]"); // eslint sai com 1 quando há erros; o JSON vem em stdout
}
const report = JSON.parse(raw);
const errors = report.reduce((n, f) => n + f.errorCount, 0);
const byRule = {};
for (const f of report) for (const m of f.messages) if (m.severity === 2) byRule[m.ruleId ?? "?"] = (byRule[m.ruleId ?? "?"] ?? 0) + 1;

if (process.argv.includes("--update")) {
  fs.writeFileSync(BASELINE, JSON.stringify({ errors, byRule, updated: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");
  console.log(`linha de base gravada: ${errors} erros`);
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const worse = Object.entries(byRule).filter(([rule, n]) => n > (base.byRule[rule] ?? 0));
console.log(`eslint: ${errors} erros (linha de base ${base.errors}).`);
if (errors > base.errors || worse.length) {
  for (const [rule, n] of worse) console.log(`  piorou: ${rule} ${base.byRule[rule] ?? 0} -> ${n}`);
  console.log("Piorou em relação à linha de base. Corrija os novos erros (ou, se melhorou em outra regra, rode com --update).");
  process.exit(1);
}
if (errors < base.errors) console.log("Melhorou! Rode `node scripts/eslint-ratchet.mjs --update` para travar o ganho.");
