#!/usr/bin/env node
// Reavalia um resultado salvo (`--out` do runner) com o corretor ATUAL e, opcionalmente, grava como rodada.
// Serve para comparar antes/depois com a mesma régua quando o corretor evolui, sem rodar o Nino de novo.
//   node scripts/synthetic/rescore.mjs --in=antes.json [--label="antes (régua atual)"] [--sha=...] [--record] [--out=novo.json]
import { readFileSync, writeFileSync } from "node:fs";
import { PERSONAS, buildSpec, buildTruth, knownValues, ymd } from "./personas.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { scoreScenario, summarizeRun, consistency } from "./score.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
const data = JSON.parse(readFileSync(args.in, "utf8"));
const ref = new Date(`${args.date ?? new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)}T12:00:00Z`);
const today = ymd(ref);
const results = data.results.map((r) => {
  const persona = PERSONAS.find((p) => p.id === r.persona_id);
  const sc = SCENARIOS.find((s) => s.id === r.scenario_id);
  if (!persona || !sc) return r;
  const spec = buildSpec(persona, ref);
  const ctx = { p: persona, t: buildTruth(spec, ref), ref };
  const res = scoreScenario({ expect: sc.expect(ctx), replies: r.replies, state: { txs: r.state ?? [] }, truth: ctx.t, level: sc.level, today, known: knownValues(spec, ref) });
  const provedor = r.layers?.provedor;
  return { ...r, verdict: res.verdict, why: res.why, layers: { ...res.layers, ...(provedor ? { provedor } : {}) } };
});
const summary = summarizeRun(results);
summary.consistency = consistency(results);
summary.governor = data.summary?.governor;
console.log(JSON.stringify({ total: summary.total, ok_rate: +summary.ok_rate.toFixed(3), wrong: summary.wrong, by: summary.by, degradadas: summary.degraded }));
if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 1));

if (args.record === "true") {
  const url = process.env.NINO_SYN_URL, token = process.env.NINO_SYN_TOKEN;
  const call = async (body) => (await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-synthetic-token": token }, body: JSON.stringify(body) })).json();
  const { run_id } = await call({ action: "run_start", label: args.label ?? "reavaliada", suite: "synthetic", git_sha: args.sha ?? null, config: { rescored: true, total: results.length } });
  for (let i = 0; i < results.length; i += 40) await call({ action: "run_results", run_id, results: results.slice(i, i + 40) });
  await call({ action: "run_finish", run_id, summary });
  console.log("run_id", run_id);
}
