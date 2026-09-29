#!/usr/bin/env node
// Nino human-conversation E2E runner.
//
// Drives scripted, human-sounding WhatsApp conversations through the harness
// Edge Function (scripts/e2e/nino-human-harness.template.ts) and records the
// transcript with per-turn diagnostics plus automatic rubric checks.
//
// Usage:
//   NINO_E2E_URL=https://<ref>.supabase.co/functions/v1/<harness> \
//   NINO_E2E_ANON=<anon key> NINO_E2E_TOKEN=<harness token> \
//   node scripts/e2e/nino-human-conversation.mjs --label candidate [--only A,B] [--gap 12]
//
// The rubric is intentionally about conversation quality signals that can be
// checked mechanically (answered, grounded, not robotic, continuity, no
// technical failure). Human judgement of tone is done on the saved transcript.
import { writeFileSync, mkdirSync } from "node:fs";

const URL_ = process.env.NINO_E2E_URL;
const ANON = process.env.NINO_E2E_ANON;
const TOKEN = process.env.NINO_E2E_TOKEN;
if (!URL_ || !ANON || !TOKEN) {
  console.error("NINO_E2E_URL, NINO_E2E_ANON and NINO_E2E_TOKEN are required");
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const LABEL = opt("label", "run");
const ONLY = (opt("only", "") || "").split(",").filter(Boolean);
const GAP_MS = Number(opt("gap", "12")) * 1000;
const PHONE_BASE = Number(opt("phone-base", "200"));
const OUT_DIR = opt("out", "e2e-results");

const MONEY = /R\$\s?\d/;
const TECH_FAILURE = /não consegui (?:processar|interpretar|executar|fechar)|tente de novo em instantes|tenta de novo em instantes|reformular o pedido/i;
const ROBOTIC = /\b(?:período solicitado|consulta executada|resultado:|dados disponíveis indicam)\b/i;

// expect: rubric per turn. answer=money expected; noMoney=must not cite money;
// warm=must acknowledge feeling; offer=optional; plan=min plan steps; kind=expected composition kind.
export const SCENARIOS = [
  {
    id: "A", title: "Conversa aberta, sentimento, dado e continuidade", turns: [
      { text: "Oi Nino! tudo bem? to meio preocupado com dinheiro esse mês", expect: { noMoney: true, warm: true } },
      { text: "É que em dezembro eu vou viajar pro nordeste com minha esposa e queria chegar lá tranquilo", expect: { noMoney: true, memory: true } },
      { text: "quanto eu já gastei esse mês?", expect: { answer: true } },
      { text: "e com lazer?", expect: { answer: true } },
      { text: "isso é muito comparado com o mês passado?", expect: { answer: true } },
      { text: "Valeu, ajudou bastante", expect: { noMoney: true } },
    ],
  },
  {
    id: "B", title: "Pedidos compostos e projeção de meta", turns: [
      { text: "quanto gastei com delivery em agosto e o que você me sugere fazer?", expect: { answer: true, plan: 2 } },
      { text: "e quando eu vou conseguir bater a meta da viagem?", expect: { answer: true } },
      { text: "anota 45 reais de ifood hoje e me diz quanto já foi de delivery esse mês", expect: { draft: true, answer: true, plan: 2 } },
      { text: "pode cancelar, não registra", expect: { noTechFailure: true } },
    ],
  },
  {
    id: "C", title: "Assessor com raciocínio: cenários e decisões", turns: [
      { text: "e se eu cortar metade do delivery, quanto eu economizo por mês?", expect: { answer: true } },
      { text: "e se eu guardar 300 a mais por mês pra viagem, muda muito?", expect: { answer: true } },
      { text: "to pensando em comprar um celular de 3 mil, será que dá?", expect: { answer: true } },
      { text: "vale mais a pena quitar o empréstimo do Lucas ou colocar esse dinheiro na viagem?", expect: { answer: true } },
    ],
  },
  {
    id: "D", title: "Memória de relacionamento em nova conversa", turns: [
      { text: "oi nino, voltei", expect: { noMoney: true } },
      { text: "lembra do que eu te falei de dezembro? como eu to em relação a isso?", expect: { recall: /viag|nordeste|dezembro/i } },
    ],
  },
];

async function call(body) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "x-e2e-token": TOKEN,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; } catch { return { status: res.status, raw: text.slice(0, 500) }; }
}

function rubric(turn, out) {
  const reply = String(out.reply ?? "");
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });
  const e = turn.expect ?? {};
  add("sem_falha_tecnica", !out.error && !TECH_FAILURE.test(reply), out.error ?? "");
  add("nao_robotico", !ROBOTIC.test(reply));
  if (e.answer) add("responde_com_dado", MONEY.test(reply));
  if (e.noMoney) add("nao_inventa_numero", !MONEY.test(reply));
  if (e.warm) add("acolhe_sentimento", /entendo|imagino|normal|calma|tranquil|junt|preocupa|compreens/i.test(reply));
  if (e.draft) add("rascunho_para_confirmar", /confirm/i.test(reply));
  if (e.recall) add("lembra_contexto", e.recall.test(reply));
  const diag = out.run?.diagnostics ?? {};
  if (e.plan) add(`plano_${e.plan}_etapas`, (diag.plan_steps ?? []).length >= e.plan, JSON.stringify(diag.plan_steps ?? []));
  const composition = diag.composition ?? null;
  add("voz_composta", composition?.mode === "composed", composition ? `${composition.mode}:${composition.reason ?? ""}` : "sem_compositor");
  return checks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const report = { label: LABEL, started_at: new Date().toISOString(), scenarios: [] };
  let phoneIndex = PHONE_BASE;
  for (const scenario of SCENARIOS) {
    if (ONLY.length && !ONLY.includes(scenario.id)) continue;
    const phone = `+55119999${String(phoneIndex++).padStart(4, "0")}`;
    const conv = await call({ action: "new", phone });
    if (!conv.conversation_id) {
      console.error("conversation failed", conv);
      process.exit(1);
    }
    console.log(`\n=== ${scenario.id}: ${scenario.title} (${conv.conversation_id}) ===`);
    const turns = [];
    for (const turn of scenario.turns) {
      const out = await call({ action: "turn", conversation_id: conv.conversation_id, phone, text: turn.text });
      const checks = rubric(turn, out);
      turns.push({ text: turn.text, out, checks });
      console.log(`\n👤 ${turn.text}\n🤖 ${String(out.reply ?? out.error ?? out.raw ?? "").trim()}`);
      const diag = out.run?.diagnostics ?? {};
      console.log(`   [${out.path} | ${out.run?.model ?? "-"} | llm_calls=${out.run?.llm_calls ?? "-"} | ${out.latency_ms ?? "-"}ms | voz=${diag.composition?.mode ?? "-"}${diag.composition?.reason ? `(${diag.composition.reason})` : ""} | steps=${(diag.plan_steps ?? []).map((s) => s.advisory_kind ?? s.domain).join("+") || "-"}${out.run?.error ? ` | erro=${out.run.error}` : ""}]`);
      console.log(`   ${checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}`).join("  ")}`);
      await sleep(GAP_MS);
    }
    report.scenarios.push({ id: scenario.id, title: scenario.title, conversation_id: conv.conversation_id, turns });
  }
  const memory = await call({ action: "memory" });
  report.memory = memory.memory ?? [];
  const all = report.scenarios.flatMap((s) => s.turns.flatMap((t) => t.checks));
  report.summary = {
    checks: all.length,
    passed: all.filter((c) => c.ok).length,
    by_check: Object.fromEntries([...new Set(all.map((c) => c.name))].map((name) => {
      const subset = all.filter((c) => c.name === name);
      return [name, `${subset.filter((c) => c.ok).length}/${subset.length}`];
    })),
  };
  const file = `${OUT_DIR}/nino-human-${LABEL}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nMemória de relacionamento: ${JSON.stringify(report.memory.map((m) => m.value?.note ?? m.key))}`);
  console.log(`Resumo: ${report.summary.passed}/${report.summary.checks} checks`, report.summary.by_check);
  console.log(`Relatório: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
