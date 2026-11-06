// Plano e execução de uma conversa sintética. Fonte única usada pelo runner (linha de comando) e pelo worker
// da função `nino-synthetic` (botão "Rodar agora" e rodada agendada): a mesma régua nos dois lugares.
// `io` isola o mundo externo: { newConversation(persona) -> {conversation_id, phone, since}, turn(persona, conv, text) -> resposta,
// txs(persona, since) -> lançamentos criados, cleanup(persona, since), paraphrase?(text, ctx) -> string|null }.
import { PERSONAS, buildSpec, buildTruth, knownValues, ymd, MONTH_NAMES } from "./personas.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { STYLES, applyStyle } from "./styles.mjs";
import { scoreScenario } from "./score.mjs";
import { isDegraded } from "./governor.mjs";

export const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Data de referência (meio-dia UTC) de "hoje" em São Paulo, ou de uma data AAAA-MM-DD fixa. */
export function refDate(fixed) {
  if (fixed) return new Date(`${fixed}T12:00:00Z`);
  const now = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

export function stylesFor(mode, persona, scenario) {
  if (mode === "all") return STYLES;
  if (!mode || mode === "rotate") return [STYLES[hash(`${persona}:${scenario}`) % STYLES.length]];
  return String(mode).split(",").filter((s) => STYLES.includes(s));
}

export function contextFor(personaId, ref) {
  const persona = PERSONAS.find((p) => p.id === personaId);
  if (!persona) return null;
  const spec = buildSpec(persona, ref);
  return { persona, spec, truth: buildTruth(spec, ref), known: knownValues(spec, ref), ctx: { p: persona, t: buildTruth(spec, ref), ref } };
}

/** Lista determinística de conversas (persona × cenário × estilo × repetição), persona a persona. */
export function buildPlan({ personas = [], only = [], styles = "rotate", reps = 1 } = {}, ref = refDate()) {
  const out = [];
  for (const persona of PERSONAS) {
    if (personas.length && !personas.includes(persona.id)) continue;
    const c = contextFor(persona.id, ref);
    for (const sc of SCENARIOS) {
      if (only.length && !only.includes(sc.id)) continue;
      if (sc.only && !sc.only.includes(persona.id)) continue;
      if (!sc.applies(c.ctx)) continue;
      for (const style of stylesFor(styles, persona.id, sc.id)) for (let rep = 1; rep <= Math.max(1, reps); rep++) out.push({ persona_id: persona.id, scenario_id: sc.id, style, rep });
    }
  }
  return out;
}

/** Intercala as personas (uma de cada vez): conversas vizinhas são de contas diferentes e podem rodar em paralelo. */
export function interleave(plan) {
  const by = new Map();
  for (const d of plan) (by.get(d.persona_id) ?? by.set(d.persona_id, []).get(d.persona_id)).push(d);
  const lanes = [...by.values()];
  const out = [];
  for (let i = 0; lanes.some((l) => i < l.length); i++) for (const l of lanes) if (i < l.length) out.push(l[i]);
  return out;
}

/** A variação por IA só vale se preservar os números e os meses (senão o gabarito deixa de valer). */
export function preservesFacts(original, variant) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ");
  const o = norm(original), v = norm(variant);
  const digits = o.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (!digits.every((d) => v.includes(d))) return false;
  return MONTH_NAMES.filter((m) => o.includes(m)).every((m) => v.includes(m));
}

/** Roda uma conversa e devolve o resultado já avaliado. `gov` (opcional) regula a vazão por turno. */
export async function executeConversation({ desc, ref, io, gov }) {
  const t0 = Date.now();
  const c = contextFor(desc.persona_id, ref);
  const sc = SCENARIOS.find((s) => s.id === desc.scenario_id);
  const base = { scenario_id: desc.scenario_id, persona_id: desc.persona_id, style: desc.style, rep: desc.rep, area: sc?.area, level: sc?.level };
  if (!c || !sc) return { ...base, verdict: "INFRA", why: "cenário ou persona desconhecido", layers: {}, turns: [], replies: [] };
  const conv = await io.newConversation(desc.persona_id);
  if (!conv?.conversation_id) return { ...base, verdict: "INFRA", why: `não abriu conversa: ${conv?.error ?? "sem detalhe"}`, layers: {}, turns: [], replies: [] };
  const sent = [], replies = [];
  let prev = "", degradedTurns = 0, tokens = 0, varied = false;
  for (const turn of sc.turns(c.ctx)) {
    const item = typeof turn === "string" ? { text: turn, style: true } : { ...turn, style: false };
    if (item.ifReply && !item.ifReply.test(prev)) continue;
    let text = item.style ? applyStyle(item.text, desc.style, `${desc.persona_id}:${sc.id}:${desc.rep}`) : item.text;
    if (item.style && io.paraphrase && desc.style !== "neutro" && !varied) {
      const v = await io.paraphrase(item.text, { style: desc.style, persona: c.persona.desc }).catch(() => null);
      if (v && preservesFacts(item.text, v)) { text = v; varied = true; }
    }
    await gov?.acquire();
    const r = await io.turn(desc.persona_id, conv, text);
    const degraded = isDegraded(r);
    tokens += Number(r.run?.tokens_in ?? 0) + Number(r.run?.tokens_out ?? 0);
    gov?.release({ tokens: Number(r.run?.tokens_in ?? 0) + Number(r.run?.tokens_out ?? 0), degraded });
    if (degraded) degradedTurns++;
    sent.push(text);
    prev = String(r.reply ?? r.error ?? r.raw ?? "");
    replies.push(prev);
  }
  const txs = await io.txs(desc.persona_id, conv.since);
  await io.cleanup(desc.persona_id, conv.since);
  const res = scoreScenario({ expect: sc.expect(c.ctx), replies, state: { txs }, truth: c.truth, level: sc.level, today: ymd(ref), known: c.known });
  return { ...base, ...res, layers: { ...res.layers, ...(degradedTurns ? { provedor: "degradado" } : {}), ...(varied ? { variacao: "ia" } : {}) }, state: txs, turns: sent, replies, latency_ms: Date.now() - t0, tokens, degraded: degradedTurns };
}
