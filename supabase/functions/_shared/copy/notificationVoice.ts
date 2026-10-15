// notification_voice.v1 — régua de VOZ das mensagens que o Nino inicia (push, app e WhatsApp).
//
// Referência de qualidade (notificação de um app de hábitos que a pessoa admira):
//   "Eu fico de olho 👀 / Mas o hábito é seu. / Já deixei tudo preparado. Vamos revisar juntos?"
// O que a faz funcionar, em critérios verificáveis:
//   1. curta: poucas frases, cada uma com poucas palavras (lê-se na tela de bloqueio);
//   2. uma ideia por frase, sem número solto e sem jargão;
//   3. primeira pessoa e calor humano (parceiro que acompanha, não relatório);
//   4. deixa claro de quem é a decisão (a pessoa);
//   5. reduz esforço: o convite vem com o trabalho já adiantado (SÓ quando é verdade);
//   6. termina em UM convite para agir junto.
// O Nino soma a isso o que a referência não faz na tela de bloqueio: dizer DO QUE se trata (assunto).
// Pura e sem dependências: usada em testes e disponível para evals e para o redator.

export type VoiceIssue =
  | "too_many_sentences"
  | "long_sentence"
  | "too_many_numbers"
  | "jargon"
  | "multiple_questions"
  | "question_not_last"
  | "missing_subject"
  | "raw_decimal";

export type VoiceCheck = { ok: boolean; issues: VoiceIssue[]; detail: string[] };

export const VOICE_LIMITS = { maxSentences: 3, maxWordsPerSentence: 18, maxNumbers: 2 } as const;

const JARGON = [
  /\bocorr[eê]ncias?\b/i, /\bperiodicamente\b/i, /\bpadr[aã]o\b/i, /\bcomportamento\b/i, /\bamostras?\b/i,
  /\bscores?\b/i, /\bdiagn[óo]stico\b/i, /\bconfian[çc]a de\b/i, /\bdetector\b/i, /\bn[ií]vel de\b/i,
];
const RAW_DECIMAL = /(?<![\d.,])\d+\.\d{1,2}(?!\d|\.\d)/;

const fold = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function sentencesOf(text: string): string[] {
  return String(text ?? "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function numbersIn(text: string): number {
  return (String(text ?? "").match(/R\$\s?[\d.,]+|\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
}

/** Confere a VOZ de uma mensagem (corpo; o título entra à parte só no assunto). */
export function checkNotificationVoice(args: { body: string; title?: string; subject?: string | null }): VoiceCheck {
  const issues: VoiceIssue[] = [];
  const detail: string[] = [];
  const add = (i: VoiceIssue, d: string) => { if (!issues.includes(i)) issues.push(i); detail.push(d); };
  const body = String(args.body ?? "").trim();
  const parts = sentencesOf(body);

  if (parts.length > VOICE_LIMITS.maxSentences) add("too_many_sentences", `${parts.length} frases (máx. ${VOICE_LIMITS.maxSentences})`);
  for (const s of parts) {
    const words = s.split(/\s+/).filter(Boolean).length;
    if (words > VOICE_LIMITS.maxWordsPerSentence) add("long_sentence", `${words} palavras: “${s.slice(0, 40)}…”`);
  }
  const nums = numbersIn(body);
  if (nums > VOICE_LIMITS.maxNumbers) add("too_many_numbers", `${nums} números (máx. ${VOICE_LIMITS.maxNumbers})`);
  for (const rx of JARGON) {
    const hit = body.match(rx);
    if (hit) add("jargon", hit[0]);
  }
  const raw = body.match(RAW_DECIMAL);
  if (raw) add("raw_decimal", raw[0]);

  const questions = (body.match(/\?/g) ?? []).length;
  if (questions > 1) add("multiple_questions", `${questions} perguntas`);
  if (questions === 1 && !/\?\s*[\p{Extended_Pictographic}️]*$/u.test(body)) add("question_not_last", "a pergunta deve fechar a mensagem");

  const subject = String(args.subject ?? "").trim();
  if (subject && !fold(`${args.title ?? ""} ${body}`).includes(fold(subject))) add("missing_subject", `não cita “${subject}”`);

  return { ok: issues.length === 0, issues, detail };
}
