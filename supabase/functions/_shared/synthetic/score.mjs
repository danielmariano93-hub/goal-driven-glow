// Nota em camadas de um cenário sintético.
//   fato        : o número/conteúdo da resposta confere com o gabarito da persona (corretor dourado reaproveitado)
//   estado      : o que ficou no banco confere (lançamento certo, sem duplicar, sem gravar quando só perguntou)
//   regra       : nunca vazar instrução, nunca inventar valor sem dado, nunca cair em beco sem saída
//   naturalidade: sinais mecânicos de resposta robótica (não muda o veredito; vira indicador e fila de revisão)
// Veredito final: o pior entre fato e estado (WRONG > INFRA > MISS > CORRECT). Resposta errada é a pior.
import { score as goldenScore, classify } from "./goldenScore.mjs";

const ROBOTIC = /período solicitado|consulta executada|resultado:|dados disponíveis indicam|como (uma )?ia\b|modelo de linguagem|não tenho acesso a essa informação|\bjson\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function naturalness(replies, level = 1) {
  const flags = [];
  const last = String(replies.at(-1) ?? "");
  if (ROBOTIC.test(last)) flags.push("robotica");
  if (level === 1 && last.length > 700) flags.push("longa_demais");
  if (replies.length > 1 && replies[replies.length - 1] && replies[replies.length - 1] === replies[replies.length - 2]) flags.push("repetiu");
  if ((last.match(EMOJI) ?? []).length > 4) flags.push("emoji_demais");
  if (/^#{1,3}\s/m.test(last)) flags.push("titulo_markdown");
  if ((last.match(/\b(the|you|your|please|sorry)\b/gi) ?? []).length >= 2) flags.push("ingles");
  return { score: Math.max(0, 1 - 0.34 * flags.length), flags };
}

const DERIVED_KEY = /^(sum3|avg3|diff12|catsum12)\b/;
const RANK = { WRONG: 4, INFRA: 3, UNVERIFIED: 2, MISS: 1, CORRECT_REFUSAL: 0, CORRECT: 0 };
const worst = (a, b) => ((RANK[b.verdict] ?? 0) > (RANK[a.verdict] ?? 0) ? b : a);
export const isPass = (v) => v === "CORRECT" || v === "CORRECT_REFUSAL";

/** day: 0 = hoje, -1 = ontem (data de referência já no fuso de São Paulo). */
export function scoreRegistration(expect, state, today) {
  const txs = state?.txs ?? [];
  const want = expect.tx;
  if (!txs.length) return { verdict: "MISS", why: "não registrou o lançamento" };
  if (expect.exactly && txs.length !== expect.exactly) return { verdict: "WRONG", why: `${txs.length} lançamentos (esperado ${expect.exactly})` };
  const tx = txs.find((t) => Math.abs(Number(t.amount) - want.amount) <= 0.011) ?? txs[0];
  if (Math.abs(Number(tx.amount) - want.amount) > 0.011) return { verdict: "WRONG", why: `valor gravado ${tx.amount} (esperado ${want.amount})` };
  if (tx.type !== want.type) return { verdict: "WRONG", why: `tipo gravado ${tx.type} (esperado ${want.type})` };
  if (txs.length > 1 && !expect.exactly) return { verdict: "WRONG", why: `duplicou: ${txs.length} lançamentos` };
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (want.day ?? 0));
  const wantDate = d.toISOString().slice(0, 10);
  if (tx.occurred_at !== wantDate) return { verdict: "WRONG", why: `data gravada ${tx.occurred_at} (esperado ${wantDate})` };
  // O Nino classifica depois (worker assíncrono): sem categoria no ato não reprova, mas é medido à parte.
  if (!tx.category) return { verdict: "CORRECT", why: "lançamento certo (categoria pendente)", categoria: "pendente" };
  if (want.categories?.length && !want.categories.includes(tx.category)) return { verdict: "MISS", why: `categoria ${tx.category} (aceitas: ${want.categories.join("/")})`, categoria: "errada" };
  return { verdict: "CORRECT", why: "lançamento certo no banco", categoria: "ok" };
}

export function scoreScenario({ expect, replies, state, truth, level, today, known, asked = [] }) {
  const reply = String(replies.at(-1) ?? "");
  // Valor que a própria pessoa digitou ("me empresta 500 reais?") não é valor inventado quando o Nino o repete.
  const typed = new Set((asked.map((t) => (typeof t === "string" ? t : t?.text ?? "")).join(" ").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Math.abs(Number(n.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")))));
  const last = typed.size && !(expect.numbers ?? []).length
    ? reply.replace(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/gi, (m, int, dec) => (typed.has(Number(`${String(int).replace(/\./g, "")}${dec ? `.${dec}` : ""}`)) ? "esse valor" : m))
    : reply;
  const c = classify(last);
  const kind = expect.kind ?? (expect.numbers ? "numbers" : "answers");
  const layers = { fato: null, estado: null, regra: null };
  const numericTruth = Object.fromEntries(Object.entries(truth).filter(([, v]) => typeof v === "number"));
  let res;

  if (c.infra) res = { verdict: "INFRA", why: "falha interna na resposta" };
  else if (kind === "registration") res = scoreRegistration(expect, state, today);
  else if (kind === "nowrite") res = (state?.txs?.length ?? 0) > 0 ? { verdict: "WRONG", why: "gravou lançamento depois de cancelar" } : { verdict: "CORRECT", why: "nada gravado" };
  else if ((kind === "vague" || kind === "chat") && c.money.length) {
    // Valor que existe no gabarito não é inventado: foi um palpite de contexto (MISS). Valor fora do gabarito é WRONG.
    const knownVals = known ?? Object.values(numericTruth).map((v) => Math.abs(Number(v)));
    const grounded = c.money.every((t) => knownVals.some((k) => Math.abs(Math.abs(t.value) - k) <= 0.011));
    res = grounded
      ? { verdict: "MISS", why: kind === "vague" ? "assumiu o contexto em vez de perguntar" : "despejou dados sem a pessoa pedir" }
      : { verdict: "WRONG", why: "valor que não existe nos dados da pessoa" };
  } else if (kind === "vague") {
    if (c.money.length) res = { verdict: "WRONG", why: "inventou valor numa pergunta sem contexto" };
    else if (c.dead_end) res = { verdict: "MISS", why: "beco sem saída" };
    else res = last.trim().length >= 3 ? { verdict: "CORRECT", why: "pediu contexto ou conversou" } : { verdict: "MISS", why: "vazio" };
  } else res = goldenScore({ expect: { ...expect, kind } }, last, numericTruth);
  // Conta de vários passos (soma, média, diferença): citar só os valores de cada mês, todos reais, sem entregar o total, é uma
  // resposta incompleta (MISS), não um valor errado. Um valor que não existe nos dados continua sendo WRONG.
  if (res.verdict === "WRONG" && kind === "numbers" && (expect.numbers ?? []).length && expect.numbers.every((k) => DERIVED_KEY.test(k))) {
    const knownVals = known ?? Object.values(numericTruth).map((v) => Math.abs(Number(v)));
    const parts = c.money.length > 0 && c.money.every((t) => knownVals.some((k) => Math.abs(Math.abs(t.value) - k) <= 0.011));
    if (parts) res = { verdict: "MISS", why: "deu os valores de cada mês, mas não a conta pedida" };
  }
  layers.fato = res.verdict;

  // Estado: perguntar nunca pode criar lançamento.
  const wrote = (state?.txs?.length ?? 0) > 0;
  if (kind !== "registration") {
    layers.estado = wrote ? "WRONG" : "CORRECT";
    if (wrote) res = worst(res, { verdict: "WRONG", why: "criou lançamento sem o usuário pedir" });
  } else layers.estado = res.verdict;

  layers.regra = c.leak ? "WRONG" : c.dead_end ? "MISS" : "CORRECT";
  const nat = naturalness(replies, level);
  return { verdict: res.verdict, why: res.why, layers: { ...layers, ...(res.categoria ? { categoria: res.categoria } : {}), naturalidade: Number(nat.score.toFixed(2)), flags: nat.flags } };
}

export function summarizeRun(results) {
  const total = results.length;
  const by = {};
  for (const r of results) by[r.verdict] = (by[r.verdict] ?? 0) + 1;
  const ok = (by.CORRECT ?? 0) + (by.CORRECT_REFUSAL ?? 0);
  const group = (key) => {
    const g = {};
    for (const r of results) { const k = r[key] ?? "-"; const e = (g[k] ??= { total: 0, ok: 0, wrong: 0 }); e.total++; if (isPass(r.verdict)) e.ok++; if (r.verdict === "WRONG") e.wrong++; }
    return g;
  };
  const nat = results.filter((r) => typeof r.layers?.naturalidade === "number");
  return {
    total, by, ok, ok_rate: total ? ok / total : 0, wrong: by.WRONG ?? 0, infra: by.INFRA ?? 0,
    degraded: results.filter((r) => r.layers?.provedor === "degradado").length,
    fail_in_degraded: results.filter((r) => r.layers?.provedor === "degradado" && !isPass(r.verdict)).length,
    natural_avg: nat.length ? nat.reduce((s, r) => s + r.layers.naturalidade, 0) / nat.length : null,
    by_area: group("area"), by_persona: group("persona_id"), by_style: group("style"), by_level: group("level"),
  };
}

/** pass^k: o cenário só conta como consistente se acertou em TODAS as repetições. */
export function consistency(results) {
  const g = {};
  for (const r of results) (g[`${r.persona_id}|${r.scenario_id}|${r.style}`] ??= []).push(isPass(r.verdict));
  const groups = Object.values(g).filter((a) => a.length > 1);
  if (!groups.length) return null;
  return groups.filter((a) => a.every(Boolean)).length / groups.length;
}
