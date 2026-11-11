// IA de Hábitos (F6): partes PURAS (prompts, validação, guarda de números, texto de reserva). Sem rede e sem banco, para testar.
// Princípios: a IA só escreve texto sobre números que o motor já calculou; nunca dá conselho clínico; nunca toca hábito sensível;
// toda resposta passa por guarda e, se reprovada, cai no texto fixo.
import { reviewText, type WeeklyReviewRow } from "../habits-core/index.ts";

/** Teto de gasto de IA por pessoa por mês, em dólares (≈ R$ 1). */
export const AI_MONTHLY_CAP_USD = 0.2;
/** Cada resposta da IA tem no máximo estes tamanhos. */
export const MAX_NARRATIVE_CHARS = 420;
export const MAX_FIELD_CHARS = 120;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Saúde, substâncias e linguagem clínica: a IA não opina nem sugere.
const CLINICAL_RX = /\b(diagnostic\w*|remedio\w*|medicament\w*|medicacao|dose\w*|tratamento|terapia|psicolog\w*|psiquiatr\w*|depress\w*|ansiedade|transtorno|sintoma\w*|receita medica|dieta|emagrec\w*|jejum|calorias?|cigarro|tabaco|nicotina|alcool|bebida alcoolica|cerveja|vinho|droga\w*|maconha|cocaina|vicio|dependencia|overdose|suicid\w*)\b/;
export const isClinicalText = (text: string): boolean => CLINICAL_RX.test(norm(text));

/** Todos os números do texto, normalizados (1.234,56 -> 1234.56). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const n = /\.\d{3}/.test(raw) && raw.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(raw) ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw.replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Aprova só se todo número citado existe nos fatos (com folga de arredondamento) e não há linguagem clínica. */
export function guardNarrative(text: string, allowed: Iterable<number>): { ok: boolean; reason?: string } {
  const t = String(text ?? "").trim();
  if (t.length < 10) return { ok: false, reason: "empty" };
  if (t.length > MAX_NARRATIVE_CHARS) return { ok: false, reason: "too_long" };
  if (isClinicalText(t)) return { ok: false, reason: "clinical" };
  if (/https?:\/\/|www\./i.test(t)) return { ok: false, reason: "link" };
  const set = [...allowed];
  for (const n of numbersIn(t)) {
    if (!set.some((a) => Math.abs(a - n) < 0.011)) return { ok: false, reason: `number_not_in_facts:${n}` };
  }
  return { ok: true };
}

export type ReviewFacts = { rows: Array<WeeklyReviewRow & { title: string }> };

export const factNumbers = (f: ReviewFacts): number[] => f.rows.flatMap((r) => [r.done, r.expected, r.prev_done, r.prev_expected, r.done - r.prev_done, Math.abs(r.done - r.prev_done)]);

export const NARRATIVE_SYSTEM =
  "Você escreve a revisão semanal de hábitos de um app de finanças pessoais, em português do Brasil, com tom acolhedor e direto. " +
  "Escreva de 2 a 3 frases curtas. Use SOMENTE os números fornecidos; não invente nenhum outro número, data ou porcentagem. " +
  "Nunca culpe, nunca compare com outras pessoas, não use pontos, ranking ou emojis. Não dê conselho de saúde, dieta, remédio ou tratamento. " +
  "Termine com uma sugestão pequena e concreta para a próxima semana, sem número novo.";

export function narrativeUser(f: ReviewFacts): string {
  return JSON.stringify({ semana: f.rows.map((r) => ({ habito: r.title, dias_feitos: r.done, dias_previstos: r.expected, semana_anterior_feitos: r.prev_done, semana_anterior_previstos: r.prev_expected })) });
}

export const NARRATIVE_TOOL = {
  name: "emit_habit_review",
  description: "Texto curto da revisão semanal de hábitos.",
  parameters: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", maxLength: MAX_NARRATIVE_CHARS } } },
  strict: true,
};

/** Texto de reserva: sempre disponível, sem IA. */
export const fallbackNarrative = (f: ReviewFacts): string => reviewText(f.rows, (id) => f.rows.find((r) => r.habit_id === id)?.title ?? "Hábito");

// ---------------------------------------------------------------- sugestão de plano

export type PlanSuggestion = { cue_text: string | null; minimum_text: string | null };

export const PLAN_SYSTEM =
  "Você ajuda a montar um hábito pequeno e fácil, em português do Brasil. Dado o nome do hábito, sugira: (1) cue_text: um momento do dia já existente " +
  "a que ele se liga, no formato 'Depois de ...' (até 80 caracteres); (2) minimum_text: a versão mínima para dias ruins, tão pequena que dê para fazer em 2 minutos (até 80 caracteres). " +
  "Não dê conselho de saúde, dieta, remédio ou tratamento; se o hábito envolver isso, devolva os dois campos nulos. Sem números além dos que já estão no nome do hábito.";

export const PLAN_TOOL = {
  name: "emit_habit_plan",
  description: "Sugestão de gatilho e versão mínima.",
  parameters: {
    type: "object", additionalProperties: false, required: ["cue_text", "minimum_text"],
    properties: { cue_text: { type: ["string", "null"], maxLength: MAX_FIELD_CHARS }, minimum_text: { type: ["string", "null"], maxLength: MAX_FIELD_CHARS } },
  },
  strict: true,
};

/** Hábitos de saúde, dieta e substâncias não recebem sugestão de IA. */
export const planRefused = (title: string): boolean => isClinicalText(title) || /\b(peso|remed|fumar|beber|bebida|parar de|largar)\b/.test(norm(title));

export function sanitizePlan(raw: unknown, title: string): PlanSuggestion {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed = numbersIn(title);
  const clean = (v: unknown, prefix?: RegExp): string | null => {
    if (typeof v !== "string") return null;
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length < 3 || t.length > MAX_FIELD_CHARS || isClinicalText(t) || /https?:\/\//i.test(t)) return null;
    // Números só os do nome do hábito ou pequenos (até 10, como "3 respirações"); nada de metas inventadas.
    if (numbersIn(t).some((n) => n > 10 && !allowed.some((a) => a === n))) return null;
    if (prefix && !prefix.test(t)) return null;
    return t;
  };
  return { cue_text: clean(o.cue_text, /^depois d[eoa]s?\b/i), minimum_text: clean(o.minimum_text) };
}
