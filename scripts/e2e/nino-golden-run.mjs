// Runner do conjunto dourado ao vivo. Fala com a função temporária de teste (ver
// `nino-human-harness.template.ts`), que roda o orquestrador real para a conta de teste, no canal
// "simulador" (nada é enviado a ninguém).
//
//   NINO_E2E_URL=https://<projeto>.supabase.co/functions/v1/<funcao> \
//   NINO_E2E_TOKEN=<segredo da rodada> NINO_E2E_TRUTH=truth.json \
//   node scripts/e2e/nino-golden-run.mjs [--only=A01,B02] [--out=resultado.json] [--concurrency=3]
//
// O gabarito (`truth.json`: { "exp:2026-09": 18414.95, ... }) é gerado por `golden-truth.sql` com SQL
// independente do código do Nino. Nunca versionamos valores reais.
import { readFileSync, writeFileSync } from "node:fs";
import { GOLDEN } from "./nino-golden-cases.mjs";
import { score, summarize } from "./nino-golden-score.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const URL_ = process.env.NINO_E2E_URL;
const TOKEN = process.env.NINO_E2E_TOKEN;
if (!URL_ || !TOKEN) throw new Error("defina NINO_E2E_URL e NINO_E2E_TOKEN");
const truth = process.env.NINO_E2E_TRUTH ? JSON.parse(readFileSync(process.env.NINO_E2E_TRUTH, "utf8")) : {};
const only = new Set((args.only ?? "").split(",").filter(Boolean));
const concurrency = Number(args.concurrency ?? 3);

async function call(body) {
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "x-e2e-token": TOKEN }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; } catch { return { status: res.status, raw: text.slice(0, 300) }; }
}
// Telefone de teste único por conversa (a tabela exige): base aleatória e, se já existir, tenta o próximo.
let phoneSeq = Number(process.env.PHONE_BASE ?? 1000 + Math.floor(Math.random() * 8000));
async function newConversation() {
  let last = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const phone = `+55119999${String(phoneSeq++ % 10000).padStart(4, "0")}`;
    last = { ...(await call({ action: "new", phone })), phone };
    if (last.conversation_id || !String(last.error ?? "").includes("23505")) return last;
  }
  return last;
}

async function runCase(testCase) {
  // A função de teste pode estar aquecendo nas primeiras chamadas: tenta abrir a conversa algumas vezes.
  let conv = await newConversation();
  for (let attempt = 0; attempt < 3 && !conv.conversation_id; attempt++) {
    await new Promise((x) => setTimeout(x, 3000));
    conv = await newConversation();
  }
  let last = null;
  const replies = [];
  for (const text of testCase.turns) {
    let r = await call({ action: "turn", conversation_id: conv.conversation_id, phone: conv.phone, text });
    if (r.status >= 500) { await new Promise((x) => setTimeout(x, 5000)); r = await call({ action: "turn", conversation_id: conv.conversation_id, phone: conv.phone, text }); }
    last = r;
    replies.push(r.reply ?? r.error ?? r.raw ?? "");
  }
  const reply = String(last?.reply ?? last?.error ?? last?.raw ?? "");
  return { id: testCase.id, area: testCase.area, turns: testCase.turns, reply, replies, run_id: last?.run_id ?? null, run: last?.run ?? null, ...score(testCase, reply, truth) };
}

const queue = GOLDEN.filter((c) => !only.size || only.has(c.id));
const results = [];
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const c = queue.shift();
    try { results.push(await runCase(c)); } catch (e) { results.push({ id: c.id, area: c.area, verdict: "INFRA", why: String(e).slice(0, 120), reply: "" }); }
    const r = results[results.length - 1];
    console.log(r.id.padEnd(4), r.verdict.padEnd(16), r.why);
  }
}));
results.sort((a, b) => a.id.localeCompare(b.id));
const summary = summarize(results);
console.log(JSON.stringify(summary));
if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 1));
process.exit(summary.wrong > 0 ? 2 : 0);
