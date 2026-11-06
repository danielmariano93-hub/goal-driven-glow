#!/usr/bin/env node
// Runner dos usuários sintéticos do Nino.
//
//   NINO_SYN_URL=https://<ref>.supabase.co/functions/v1/nino-synthetic NINO_SYN_TOKEN=<segredo> \
//   node scripts/synthetic/run.mjs [--label=baseline] [--sha=<git>] [--personas=a,b] [--only=Q01,R01]
//        [--styles=rotate|all|neutro,informal] [--reps=1] [--llm] [--record] [--out=resultado.json] [--no-seed]
//
// Cada persona é uma conta sandbox própria: personas rodam em paralelo (memória é por pessoa), os cenários de
// uma persona rodam em fila. Registros criados durante o cenário são conferidos no banco e apagados no fim.
import { writeFileSync } from "node:fs";
import { PERSONAS, buildSpec, buildTruth, ymd } from "./personas.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { STYLES, applyStyle } from "./styles.mjs";
import { scoreScenario, summarizeRun, consistency, isPass } from "./score.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
const URL_ = process.env.NINO_SYN_URL;
const TOKEN = process.env.NINO_SYN_TOKEN;
if (!URL_ || !TOKEN) { console.error("defina NINO_SYN_URL e NINO_SYN_TOKEN"); process.exit(2); }

const list = (v) => String(v ?? "").split(",").filter(Boolean);
const onlyPersonas = new Set(list(args.personas));
const onlyScenarios = new Set(list(args.only));
const reps = Math.max(1, Number(args.reps ?? 1));
const styleMode = args.styles ?? "rotate";
const now = new Date(Date.now() - 3 * 3600e3); // São Paulo
const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const today = ymd(ref);

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

const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const stylesFor = (p, s) => (styleMode === "all" ? STYLES : styleMode === "rotate" ? [STYLES[hash(`${p}:${s}`) % STYLES.length]] : list(styleMode));

function buildJobs() {
  const jobs = [];
  for (const persona of PERSONAS) {
    if (onlyPersonas.size && !onlyPersonas.has(persona.id)) continue;
    const spec = buildSpec(persona, ref);
    const truth = buildTruth(spec, ref);
    const ctx = { p: persona, t: truth, ref };
    for (const sc of SCENARIOS) {
      if (onlyScenarios.size && !onlyScenarios.has(sc.id)) continue;
      if (sc.only && !sc.only.includes(persona.id)) continue;
      if (!sc.applies(ctx)) continue;
      for (const style of stylesFor(persona.id, sc.id)) for (let rep = 1; rep <= reps; rep++) jobs.push({ persona, spec, truth, ctx, sc, style, rep });
    }
  }
  return jobs;
}

async function runJob(job) {
  const { persona, truth, ctx, sc, style, rep } = job;
  const t0 = Date.now();
  const conv = await call({ action: "new", persona: persona.id });
  if (!conv.conversation_id) return fail(job, `não abriu conversa: ${conv.error ?? conv.raw ?? conv.status}`);
  const sent = [], replies = [];
  let prev = "";
  for (const turn of sc.turns(ctx)) {
    const item = typeof turn === "string" ? { text: turn, style: true } : { ...turn, style: false };
    if (item.ifReply && !item.ifReply.test(prev)) continue;
    const text = item.style ? applyStyle(item.text, style, `${persona.id}:${sc.id}:${rep}`) : item.text;
    const r = await call({ action: "turn", persona: persona.id, conversation_id: conv.conversation_id, phone: conv.phone, text });
    sent.push(text);
    prev = String(r.reply ?? r.error ?? r.raw ?? "");
    replies.push(prev);
  }
  let st = await call({ action: "txs", persona: persona.id, since: conv.since });
  await call({ action: "cleanup", persona: persona.id, since: conv.since });
  const res = scoreScenario({ expect: sc.expect(ctx), replies, state: { txs: st.txs ?? [] }, truth, level: sc.level, today });
  return { scenario_id: sc.id, persona_id: persona.id, style, rep, area: sc.area, level: sc.level, ...res, state: st.txs ?? [], turns: sent, replies, latency_ms: Date.now() - t0 };
}
const fail = (job, why) => ({ scenario_id: job.sc.id, persona_id: job.persona.id, style: job.style, rep: job.rep, area: job.sc.area, level: job.sc.level, verdict: "INFRA", why, layers: {}, turns: [], replies: [] });

async function main() {
  const jobs = buildJobs();
  console.log(`${jobs.length} conversas · ${new Set(jobs.map((j) => j.persona.id)).size} personas · estilos=${styleMode} · reps=${reps}`);
  if (args["no-seed"] !== "true") {
    for (const persona of new Set(jobs.map((j) => j.persona))) {
      const job = jobs.find((j) => j.persona === persona);
      const r = await call({ action: "seed", persona: persona.id, spec: job.spec });
      console.log("seed", persona.id.padEnd(20), r.error ? `ERRO ${r.error}` : `${r.transactions} lançamentos`);
      if (r.error) process.exit(3);
    }
  }
  let runId = null;
  if (args.record === "true") {
    const r = await call({ action: "run_start", label: args.label ?? "rodada", suite: "synthetic", git_sha: args.sha ?? null, config: { personas: [...new Set(jobs.map((j) => j.persona.id))], styles: styleMode, reps, total: jobs.length } });
    runId = r.run_id; console.log("run_id", runId);
  }
  const byPersona = new Map();
  for (const j of jobs) (byPersona.get(j.persona.id) ?? byPersona.set(j.persona.id, []).get(j.persona.id)).push(j);
  const results = [], pending = [];
  const flush = async (force) => { if (runId && pending.length && (force || pending.length >= 20)) await call({ action: "run_results", run_id: runId, results: pending.splice(0) }); };
  await Promise.all([...byPersona.values()].map(async (lane) => {
    for (const job of lane) {
      let r; try { r = await runJob(job); } catch (e) { r = fail(job, String(e).slice(0, 100)); }
      results.push(r); pending.push(r);
      console.log(`${r.persona_id.padEnd(18)} ${r.scenario_id.padEnd(4)} ${String(r.style).padEnd(11)} ${r.verdict.padEnd(15)} ${r.why}`);
      await flush(false);
    }
  }));
  await flush(true);
  const summary = summarizeRun(results);
  summary.consistency = consistency(results);
  console.log(JSON.stringify({ total: summary.total, ok_rate: +summary.ok_rate.toFixed(3), wrong: summary.wrong, infra: summary.infra, by: summary.by, natural_avg: summary.natural_avg && +summary.natural_avg.toFixed(2), consistency: summary.consistency }));
  if (runId) await call({ action: "run_finish", run_id: runId, summary });
  if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 1));
  process.exit(summary.wrong > 0 && args["allow-wrong"] !== "true" ? 2 : 0);
}
main();
