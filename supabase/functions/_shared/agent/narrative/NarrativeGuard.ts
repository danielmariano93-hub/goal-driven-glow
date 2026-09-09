// NarrativeGuard (`nino_narrative.v1`)
//
// Guarda de verdade: nenhum texto sai daqui citando número, percentual, data,
// causa, risco ou projeção que não esteja no pacote de evidência. Falhou →
// o dispatcher envia o corpo determinístico do motor.
import { BANNED_WORDS } from "../../copy/ninoVoice.ts";
import type { NarrativeEvidencePack } from "./NarrativeEvidencePack.ts";
import type { ToneRules } from "./TonePolicy.ts";

export type GuardViolation =
  | "empty_text"
  | "truncated_text"
  | "too_long"
  | "too_many_sentences"
  | "too_many_numbers"
  | "number_not_in_evidence"
  | "date_not_in_evidence"
  | "banned_word"
  | "forbidden_term"
  | "multiple_questions"
  | "cause_not_allowed"
  | "forecast_not_allowed"
  | "risk_not_allowed"
  | "provider_mentioned"
  | "moral_judgement";

export type GuardResult = {
  ok: boolean;
  violations: GuardViolation[];
  detail: string[];
};

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^mil$/i, 1_000],
  [/^milh(ão|ões|oes|ao)$/i, 1_000_000],
];

export type CitedNumber = { value: number; raw: string; kind: "money" | "percentage" };

export function citedNumbers(text: string): CitedNumber[] {
  const out: CitedNumber[] = [];
  const src = String(text ?? "");
  for (const m of src.matchAll(/R\$\s?([\d.]+(?:,\d{1,2})?)\s?([\p{L}ãõç]+)?/gu)) {
    let value = Number(m[1].replace(/\./g, "").replace(",", "."));
    const suffix = (m[2] ?? "").trim();
    for (const [pattern, factor] of MULTIPLIERS) {
      if (pattern.test(suffix)) value *= factor;
    }
    if (Number.isFinite(value)) out.push({ value, raw: m[0].trim(), kind: "money" });
  }
  for (const m of src.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) {
    const value = Number(m[1].replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, raw: m[0].trim(), kind: "percentage" });
  }
  return out;
}

/**
 * Um valor é canônico quando bate com a evidência exatamente, arredondado ou
 * comprimido (R$ 1,2 mil para R$ 1.234,00). Nunca há tolerância "por perto".
 */
export function matchesEvidence(value: number, allowed: number[]): boolean {
  return allowed.some((a) => {
    const abs = Math.abs(a);
    if (Math.abs(abs - Math.abs(value)) < 0.011) return true;
    if (Math.abs(Math.round(abs) - Math.abs(value)) < 0.011) return true;
    // compacto: 1 casa decimal em milhares/milhões
    for (const factor of [1_000, 1_000_000]) {
      if (abs >= factor) {
        const compact = Math.round((abs / factor) * 10) / 10 * factor;
        if (Math.abs(compact - Math.abs(value)) < factor / 20) return true;
      }
    }
    return false;
  });
}

function citedDates(text: string): string[] {
  return Array.from(String(text ?? "").matchAll(/\b(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/g))
    .map((m) => (m[3] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[2]}-${m[1]}`));
}

const CAUSE_PATTERNS = [/\bpor causa d/i, /\bporque\b/i, /\bmotivo (disso|foi)\b/i, /\bculpa d/i];
const FORECAST_PATTERNS = [
  /\bvai (fechar|estourar|faltar|sobrar|acabar)\b/i,
  /\bdeve (fechar|faltar|sobrar)\b/i,
  /\bproje(ção|to) de fechamento\b/i,
  /\baté o fim do mês você (vai|deve)\b/i,
];
const RISK_PATTERNS = [/\brisco de\b/i, /\bvocê pode ficar sem\b/i, /\bperigo\b/i];
const MORAL_PATTERNS = [
  /\bvocê (gastou|torrou) demais\b/i,
  /\bisso (é|foi) irresponsáve/i,
  /\bfalta de (disciplina|controle)\b/i,
  /\bdevia ter\b/i,
];
const PROVIDER_PATTERNS = [/\bgpt\b/i, /\bgemini\b/i, /\bopenai\b/i, /\bllm\b/i, /modelo de linguagem/i, /\bprompt\b/i];

export function guardNarrative(args: {
  text: string;
  pack: NarrativeEvidencePack;
  rules: ToneRules;
  forbiddenTerms?: string[];
}): GuardResult {
  const violations: GuardViolation[] = [];
  const detail: string[] = [];
  const text = String(args.text ?? "").trim();
  const push = (v: GuardViolation, d: string) => {
    if (!violations.includes(v)) violations.push(v);
    detail.push(d);
  };

  if (!text) return { ok: false, violations: ["empty_text"], detail: ["texto vazio"] };
  if (text.length > 900) push("too_long", `${text.length} caracteres`);
  // Texto cortado no meio (limite de tokens do modelo) nunca vai ao usuário.
  if (!/[.!?*)\]"'\u201d]$/.test(text) && !/[.!?]\s*[\p{Extended_Pictographic}\uFE0F]+$/u.test(text)) {
    push("truncated_text", "texto sem fecho de frase");
  }

  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > args.rules.maxSentences) {
    push("too_many_sentences", `${sentences.length} frases (limite ${args.rules.maxSentences})`);
  }

  const numbers = citedNumbers(text);
  if (numbers.length > args.rules.maxNumbers) {
    push("too_many_numbers", `${numbers.length} números (limite ${args.rules.maxNumbers})`);
  }
  for (const cited of numbers) {
    if (!matchesEvidence(cited.value, args.pack.allowed_numbers)) {
      push("number_not_in_evidence", cited.raw);
    }
  }

  for (const date of citedDates(text)) {
    const ok = args.pack.allowed_dates.some((a) => a === date || a.endsWith(date) || a.slice(5) === date);
    if (!ok) push("date_not_in_evidence", date);
  }

  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (lower.includes(word.toLowerCase())) push("banned_word", word);
  }
  for (const term of args.forbiddenTerms ?? []) {
    const t = String(term ?? "").trim().toLowerCase();
    if (t && lower.includes(t)) push("forbidden_term", t);
  }

  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > 1) push("multiple_questions", `${questions} perguntas`);

  const allowed = new Set(args.pack.allowed_claims);
  if (!allowed.has("cause") && CAUSE_PATTERNS.some((p) => p.test(text))) push("cause_not_allowed", "causa afirmada sem evidência");
  if (!allowed.has("forecast") && FORECAST_PATTERNS.some((p) => p.test(text))) push("forecast_not_allowed", "projeção afirmada sem evidência");
  if (!allowed.has("risk") && RISK_PATTERNS.some((p) => p.test(text))) push("risk_not_allowed", "risco afirmado sem evidência");
  if (MORAL_PATTERNS.some((p) => p.test(text))) push("moral_judgement", "julgamento moral");
  if (PROVIDER_PATTERNS.some((p) => p.test(text))) push("provider_mentioned", "menção a modelo/provedor");

  return { ok: violations.length === 0, violations, detail };
}
