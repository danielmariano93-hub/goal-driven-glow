#!/usr/bin/env node
// Varre textos que a pessoa lê (strings/templates em PT-BR) e lista problemas de clareza.
// Uso: node scripts/audit-copy.mjs [--json] [--fail]   (--fail sai com 1 se achar erro de severidade "erro")
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "supabase/functions"];
const SKIP = /(\/admin\/|\/agent\/tools\.ts|\/agent\/v3\/|\/test\/|\.test\.|\/finance-core\/|\/node_modules\/|\/integrations\/supabase\/types|\.d\.ts$|\/copy\/ninoVoice\.ts$)/;
const STOP = /\b(você|voce|seu|sua|seus|suas|não|nao|que|para|com|uma|um|está|esta|foi|mês|meta|gasto|gastos|conta|nino|dia|dias)\b/i;
const CODEY = /(=>|\bfunction\b|\bconst\b|\bimport\b|className|\bselect\b.*\bfrom\b|https?:\/\/|\.\w+\(|^[\w./@-]+$)/;

const RULES = [
  // erro = palavra que não existe em português ou quebra de concordância
  { id: "plural-por-sufixo", sev: "erro", rx: /(terminou|foi|mediu|fez|veio|esteve|teve|viu|pôde|pode|vai|é|está|ficou)\$\{[^}]*\?\s*""\s*:\s*"(aram|ram|m|ão|em|s)"\}/, msg: "plural verbal montado colando sufixo (ex.: terminouaram, foiram)" },
  { id: "pt-erro-comum", sev: "erro", rx: /\b(afim de|a nível de|houveram|fazem \d+ (dias|meses) que|mais\s+melhor|menas|trousse|à \d|ha \d+ (dias|meses))\b/i, msg: "erro comum de português" },
  // jargão interno
  { id: "jargao", sev: "aviso", rx: /\b(ciclos? de meta|indicadores?|snapshot|dimens(ão|ões)|base parcial|janela:|cobertura:|baseline|payload|pipeline|runtime|evidência suficiente|saldo devedor|score interno|heurística|determinístic[oa]|telemetria|outliers?|cluster|feature flag|fallback|template)\b/i, msg: "jargão interno" },
  { id: "confianca", sev: "aviso", rx: /\bconfiança (alta|média|baixa|geral)\b/i, msg: "‘confiança’ como rótulo técnico" },
  { id: "sem-acento", sev: "erro", rx: /\b(voce|nao|tambem|ate|ja|so|esta[o]?|mes|conta[s]?|ultimo|ultima|proximo|proxima|saude|credito|debito|educacao|alimentacao|transacao|transacoes|informacao|informacoes|usuario)\b(?=[^`]*[\wá-ú] )/, msg: "palavra sem acento" , only: /\b(voce|nao|tambem|alimentacao|transacao|transacoes|informacao|informacoes|usuario|educacao|saude|proximo|proxima|ultimo|ultima)\b/i },
];

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (n === "node_modules" || n === ".git") continue; yield* walk(p); }
    else if (/\.(ts|tsx)$/.test(n) && !SKIP.test(p)) yield p;
  }
}

const out = [];
for (const root of ROOTS) for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // strings "..." e templates `...` e texto JSX entre > <
    const lits = [...line.matchAll(/"([^"\\]{18,})"|`([^`\\]{18,})`|>([^<>{}]{18,})</g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const lit of lits) {
      if (!STOP.test(lit) || CODEY.test(lit) || /^[a-z0-9_:.\-/ ]+$/.test(lit)) continue;
      for (const r of RULES) {
        if (r.rx.test(lit) || (r.id === "plural-por-sufixo" && r.rx.test(line))) {
          if (r.only && !r.only.test(lit)) continue;
          out.push({ file: relative(".", file), line: i + 1, rule: r.id, sev: r.sev, msg: r.msg, text: lit.slice(0, 140) });
        }
      }
      const words = lit.replace(/\$\{[^}]*\}/g, "X").split(/(?<=[.!?])\s+/);
      for (const sent of words) {
        const n = sent.trim().split(/\s+/).length;
        if (n > 32) out.push({ file: relative(".", file), line: i + 1, rule: "frase-longa", sev: "aviso", msg: `${n} palavras numa frase`, text: sent.slice(0, 140) });
      }
    }
  });
}
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
else {
  const by = {};
  for (const o of out) (by[o.rule] ??= []).push(o);
  for (const [rule, arr] of Object.entries(by)) {
    console.log(`\n## ${rule} (${arr[0].sev}) — ${arr.length}`);
    for (const o of arr.slice(0, Number(process.env.N ?? 12))) console.log(`${o.file}:${o.line}  ${o.text}`);
  }
}
if (process.argv.includes("--fail") && out.some((o) => o.sev === "erro")) process.exit(1);
