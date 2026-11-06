#!/usr/bin/env node
// Runner dos usuários sintéticos do Nino (linha de comando). A lógica de cada conversa fica em
// supabase/functions/_shared/synthetic/plan.mjs (a mesma do botão "Rodar agora" do painel).
//
//   NINO_SYN_URL=https://<ref>.supabase.co/functions/v1/nino-synthetic NINO_SYN_TOKEN=<segredo> \
//   node scripts/synthetic/run.mjs [--label=baseline] [--sha=<git>] [--personas=a,b] [--only=Q01,R01]
//        [--styles=rotate|all|neutro,informal] [--reps=1] [--tpm=150000] [--lanes=3] [--max-lanes=6] [--llm] [--record]
//        [--out=resultado.json] [--no-seed] [--allow-wrong]
//
// Cada persona é uma conta sandbox própria: personas rodam em paralelo (memória é por pessoa), os cenários de
// uma persona rodam em fila. Registros criados durante o cenário são conferidos no banco e apagados no fim.
import { writeFileSync } from "node:fs";
import { buildPlan, contextFor, executeConversation, refDate } from "./plan.mjs";
import { summarizeRun, consistency } from "./score.mjs";
import { createGovernor } from "./governor.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
const URL_ = process.env.NINO_SYN_URL;
const TOKEN = process.env.NINO_SYN_TOKEN;
if (!URL_ || !TOKEN) { console.error("defina NINO_SYN_URL e NINO_SYN_TOKEN"); process.exit(2); }

const list = (v) => String(v ?? "").split(",").filter(Boolean);
const ref = refDate();
const gov = createGovernor({ tokensPerMin: Number(args.tpm ?? 150000), startLimit: Number(args.lanes ?? 3), maxLimit: Number(args["max-lanes"] ?? 6) });

async function call(body, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "x-synthetic-token": TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      const text = await res.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
      if (res.status >= 500 && i + 1 < tries) { await new Promise((r) => setTimeout(r, 4000)); continue; }
      return { status: res.status, ...j };
    } catch (e) { if (i + 1 >= tries) return { status: 0, error: String(e).slice(0, 120) }; }
  }
}
const io = {
  newConversation: (persona) => call({ action: "new", persona }),
  turn: (persona, conv, text) => call({ action: "turn", persona, conversation_id: conv.conversation_id, phone: conv.phone, text }),
  txs: async (persona, since) => (await call({ action: "txs", persona, since })).txs ?? [],
  cleanup: (persona, since) => call({ action: "cleanup", persona, since }),
  paraphrase: args.llm === "true" ? async (text, c) => ((await call({ action: "paraphrase", text, style: `${c.style}; ${c.persona}`, count: 1 })).variants ?? [])[0] ?? null : undefined,
};

async function main() {
  const plan = buildPlan({ personas: list(args.personas), only: list(args.only), styles: args.styles ?? "rotate", reps: Number(args.reps ?? 1) }, ref);
  const personas = [...new Set(plan.map((d) => d.persona_id))];
  console.log(`${plan.length} conversas · ${personas.length} personas · estilos=${args.styles ?? "rotate"} · reps=${args.reps ?? 1}`);
  if (args["no-seed"] !== "true") {
    for (const id of personas) {
      const r = await call({ action: "seed", persona: id, spec: contextFor(id, ref).spec });
      console.log("seed", id.padEnd(20), r.error ? `ERRO ${r.error}` : `${r.transactions} lançamentos`);
      if (r.error) process.exit(3);
    }
  }
  let runId = null;
  if (args.record === "true") {
    const r = await call({ action: "run_start", label: args.label ?? "rodada", suite: "synthetic", git_sha: args.sha ?? null, config: { personas, styles: args.styles ?? "rotate", reps: Number(args.reps ?? 1), total: plan.length } });
    runId = r.run_id; console.log("run_id", runId);
  }
  const lanes = new Map();
  for (const d of plan) (lanes.get(d.persona_id) ?? lanes.set(d.persona_id, []).get(d.persona_id)).push(d);
  const results = [], pending = [];
  const flush = async (force) => { if (runId && pending.length && (force || pending.length >= 20)) await call({ action: "run_results", run_id: runId, results: pending.splice(0) }); };
  await Promise.all([...lanes.values()].map(async (lane) => {
    for (const desc of lane) {
      let r; try { r = await executeConversation({ desc, ref, io, gov }); } catch (e) { r = { ...desc, verdict: "INFRA", why: String(e).slice(0, 100), layers: {}, turns: [], replies: [] }; }
      results.push(r); pending.push(r);
      console.log(`${String(r.persona_id).padEnd(18)} ${String(r.scenario_id).padEnd(4)} ${String(r.style).padEnd(11)} ${String(r.verdict).padEnd(15)} ${r.why}`);
      await flush(false);
    }
  }));
  await flush(true);
  const summary = summarizeRun(results);
  summary.consistency = consistency(results);
  summary.governor = gov.snapshot();
  console.log(JSON.stringify({ total: summary.total, ok_rate: +summary.ok_rate.toFixed(3), wrong: summary.wrong, infra: summary.infra, by: summary.by, natural_avg: summary.natural_avg && +summary.natural_avg.toFixed(2), consistency: summary.consistency, degradadas: summary.degraded, vazao: summary.governor }));
  if (runId) await call({ action: "run_finish", run_id: runId, summary });
  if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 1));
  process.exit(summary.wrong > 0 && args["allow-wrong"] !== "true" ? 2 : 0);
}
main();
