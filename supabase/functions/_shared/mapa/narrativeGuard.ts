// Guarda determinística do texto do Mapa (E12). Nada sai daqui citando número, causa, emoção, diagnóstico, juízo, promessa
// ou "nota" que não esteja permitido pelo MapaEvidencePack. Reprovou ⇒ o chamador usa o texto determinístico.
import { BANNED_WORDS } from "../copy/ninoVoice.ts";
import { checkNotificationVoice } from "../copy/notificationVoice.ts";
import { citedNumbers, matchesEvidence } from "../agent/narrative/NarrativeGuard.ts";
import type { MapaEvidencePack } from "../finance-core/mapaEvidencePack.ts";

export type MapaGuardViolation =
  | "empty_text" | "too_long" | "number_not_in_evidence" | "unit_number_not_in_evidence" | "banned_word" | "cause_claim"
  | "emotion_or_diagnosis" | "moral_judgement" | "promise" | "score_or_grade" | "spend_less_on_structural" | "internal_reference"
  | "provider_mentioned" | "wrong_voice" | "inference" | "voice";

export interface MapaGuardResult { ok: boolean; violations: MapaGuardViolation[]; detail: string[] }

const CAUSE = [/\bpor causa d/i, /\bporque\b/i, /\bmotivo (disso|foi)\b/i, /\bculpa d/i, /\bisso acontece\b/i, /\bpor isso você\b/i];
const EMOTION = [
  /\bvocê (está|anda|parece|deve estar|se sente|sente) (muito |bem |meio )?(ansios|estressad|preocupad|angustiad|deprimid|culpad|frustrad|desanimad|sobrecarregad)/i,
  /\b(ansiedade|compuls[aã]o|compulsiv|v[ií]cio|viciad|depress[aã]o|transtorno|doen[çc]a)\b/i,
  /\bgasta (para|pra) (aliviar|compensar|esquecer)\b/i,
];
const MORAL = [/\bgastou demais\b/i, /\birresponsáve/i, /\bfalta de (disciplina|controle|foco)\b/i, /\bdevia ter\b/i, /\bvocê (torrou|desperdiçou)\b/i, /\bdescontrol/i];
const PROMISE = [/\bvocê vai (conseguir|ficar|juntar|sair|chegar)\b/i, /\bgarant(o|e|ido|imos)\b/i, /\bcom certeza\b/i, /\bsem dúvida\b/i, /\bé só (fazer|seguir)\b/i];
const SCORE = [/\bnotas?\b/i, /\bscores?\b/i, /\bpontua[çc][aã]o\b/i, /\b\d+(?:[.,]\d+)?\s*\/\s*10\b/, /\bde 0 a 10\b/i];
const SPEND_LESS = [/\b(gaste|gastar|corte|cortar|reduza|reduzir|diminua|diminuir) (menos|gastos|despesas|o lazer|com lazer|o supérfluo|supérfluos)/i, /\bapert(e|ar) o cinto\b/i];
const INTERNAL = [/\b(seguranca|equilibrio|dividas|futuro|execucao|planejamento|acompanhamento)\.[a-z_]+/i, /\bformula\b/i, /\bmapa_[a-z]+/i, /\bconfian[çc]a (alta|moderada|insuficiente)\b/i, /\bindicador\b/i];
// O Nino fala COM a pessoa: nunca "como a pessoa" nem sobre si mesmo.
const WRONG_VOICE = [/\b(meu|minha|meus|minhas)\b/i, /\b(eu|tive|tenho|consigo|aproveitei|quero|preciso)\b/i, /\b(vou|continuarei|conferirei|verei)\b/i];
// Inferência que os fatos não dizem ("indicando tranquilidade", "mostra que você...").
const INFERENCE = [/\bindicand[oa]\b/i, /\b(isso )?(indica|significa|mostra|revela|sugere|demonstra) que\b/i, /\b(tranquilidade|seguran[çc]a) financeira\b/i, /\btudo (foi pago|est[aá] (bem|ok|certo))\b/i, /\bboa (sa[úu]de|situa[çc][aã]o) financeira\b/i];
const PROVIDER = [/\bgpt\b/i, /\bgemini\b/i, /\bopenai\b/i, /\bllm\b/i, /modelo de linguagem/i, /\bprompt\b/i, /\bintelig[êe]ncia artificial\b/i];

/** "2 meses", "30 dias", "3 vezes": números com unidade escrita que o citedNumbers (R$ e %) não pega. */
function unitNumbers(text: string): Array<{ value: number; raw: string }> {
  return Array.from(text.matchAll(/(\d+(?:[.,]\d+)?)\s*(m[eê]s(?:es)?|dias?|vezes|parcelas?|contas?|d[ií]vidas?)\b/gi))
    .map((m) => ({ value: Number(m[1].replace(/\./g, "").replace(",", ".")), raw: m[0] }))
    .filter((x) => Number.isFinite(x.value));
}

export function guardMapaText(args: { title?: string; body: string; question?: string | null; pack: MapaEvidencePack }): MapaGuardResult {
  const violations: MapaGuardViolation[] = [];
  const detail: string[] = [];
  const push = (v: MapaGuardViolation, d: string) => { if (!violations.includes(v)) violations.push(v); detail.push(d); };
  const body = String(args.body ?? "").trim();
  const text = [args.title, body, args.question].filter(Boolean).join(" ").trim();
  if (!body) return { ok: false, violations: ["empty_text"], detail: ["texto vazio"] };
  if (text.length > 700) push("too_long", `${text.length} caracteres`);

  for (const c of citedNumbers(text)) if (!matchesEvidence(c.value, args.pack.allowed_numbers)) push("number_not_in_evidence", c.raw);
  for (const u of unitNumbers(text)) {
    // "3 meses" no texto fixo ("com 3 meses fechados") faz parte do modelo; o resto precisa estar na evidência.
    const inTemplate = args.pack.deterministic.body.includes(u.raw) || args.pack.deterministic.title.includes(u.raw);
    const isMonths = /^m[eê]s/i.test(u.raw.replace(/^[\d.,]+\s*/, ""));
    // meses só valem se vierem de um indicador em meses (nunca de qualquer outro número do pacote)
    const ok = isMonths ? args.pack.allowed_months.some((m) => Math.abs(m - u.value) < 0.011) : matchesEvidence(u.value, args.pack.allowed_numbers);
    if (!ok && !inTemplate) push("unit_number_not_in_evidence", u.raw);
  }
  const lower = text.toLowerCase();
  for (const w of BANNED_WORDS) if (lower.includes(w.toLowerCase())) push("banned_word", w);
  const test = (list: RegExp[], v: MapaGuardViolation) => { for (const p of list) { const m = text.match(p); if (m) { push(v, m[0]); break; } } };
  test(CAUSE, "cause_claim");
  test(EMOTION, "emotion_or_diagnosis");
  test(MORAL, "moral_judgement");
  test(PROMISE, "promise");
  test(SCORE, "score_or_grade");
  test(INTERNAL, "internal_reference");
  test(PROVIDER, "provider_mentioned");
  test(WRONG_VOICE, "wrong_voice");
  test(INFERENCE, "inference");
  if (args.pack.mode === "recomendacao_estrutural") test(SPEND_LESS, "spend_less_on_structural");

  const voice = checkNotificationVoice({ body: [body, args.question].filter(Boolean).join(" ") });
  if (!voice.ok) push("voice", voice.issues.join(","));
  return { ok: violations.length === 0, violations, detail };
}
