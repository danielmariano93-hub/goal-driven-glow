// nino_habit_context.v1 — catálogo FECHADO de perguntas de contexto e como a resposta muda a recomendação.
//
// Regra de ouro: só se pergunta quando a resposta muda o que o Nino diz ou recomenda. A resposta nunca
// vira diagnóstico nem é inferida do silêncio. Tudo determinístico (sem LLM), com chaves fechadas que o
// banco valida (`habit_context_answer`).
export const HABIT_CONTEXT_VERSION = "nino_habit_context.v1";
/** Uma resposta vale por este tempo; depois disso o Nino pode perguntar de novo. */
export const CONTEXT_ANSWER_VALID_DAYS = 45;

export type PatternAnswerKey = "planned" | "spontaneous" | "for_others" | "depends";

export const PATTERN_QUESTION = {
  key: "planned_vs_spontaneous" as const,
  options: [
    { key: "planned" as const, label: "Já estavam planejados" },
    { key: "spontaneous" as const, label: "Decido na hora" },
    { key: "for_others" as const, label: "Envolvem outras pessoas" },
    { key: "depends" as const, label: "Depende" },
  ],
};

/** Texto da pergunta (a mesma para um grupo de categorias). */
export function patternQuestionText(categories: string[]): string {
  const list = categories.length <= 1 ? categories[0] : `${categories.slice(0, -1).join(", ")} e ${categories[categories.length - 1]}`;
  return `Esses gastos de fim de semana com ${list} costumam ser…`;
}

/** O que a resposta significa (sem juízo e sem causa inventada). */
export const ANSWER_INTERPRETATION: Record<PatternAnswerKey, string> = {
  planned: "Se já estavam planejados, o ajuste mais útil costuma ser na meta, não no seu comportamento.",
  spontaneous: "Se costumam surgir na hora, um limite combinado antes do fim de semana pode ajudar — se você quiser.",
  for_others: "Gastos com outras pessoas nem sempre dependem só de você; vale separar o que é seu do que é compartilhado.",
  depends: "Então esse padrão mistura situações diferentes; o Nino continua observando antes de sugerir algo.",
};

export type DimensionAnswerKey = string;
export const DIMENSION_WEIGHS: Record<string, Array<{ key: DimensionAnswerKey; label: string }>> = {
  awareness: [
    { key: "aw_dont_look", label: "Não olho meus gastos com frequência" },
    { key: "aw_dont_understand", label: "Olho, mas não entendo o porquê" },
    { key: "aw_forget_review", label: "Registro, mas esqueço de revisar" },
    { key: "other", label: "Outro motivo" },
  ],
  planning: [
    { key: "pl_no_plan", label: "Gasto sem planejar antes" },
    { key: "pl_cant_follow", label: "Planejo, mas não consigo seguir" },
    { key: "pl_variable_income", label: "Minha renda varia" },
    { key: "other", label: "Outro motivo" },
  ],
  control: [
    { key: "co_impulse", label: "Compras por vontade na hora" },
    { key: "co_others", label: "Gastos com outras pessoas" },
    { key: "co_unrealistic_goals", label: "Metas pouco realistas" },
    { key: "other", label: "Outro motivo" },
  ],
  consistency: [
    { key: "cs_variable_routine", label: "Minha rotina muda muito" },
    { key: "cs_forget_register", label: "Esqueço de registrar" },
    { key: "cs_busy_weeks", label: "Semanas corridas quebram o hábito" },
    { key: "other", label: "Outro motivo" },
  ],
  security: [
    { key: "se_low_reserve", label: "Reserva baixa" },
    { key: "se_debts", label: "Dívidas" },
    { key: "se_irregular_income", label: "Renda irregular" },
    { key: "se_recent_surprise", label: "Imprevisto recente" },
    { key: "se_fixed_costs", label: "Contas fixas altas" },
    { key: "other", label: "Outro motivo" },
  ],
  wealth: [
    { key: "we_little_left", label: "Sobra pouco no fim do mês" },
    { key: "we_dont_know_start", label: "Não sei por onde começar" },
    { key: "we_pay_debts_first", label: "Prioridade é pagar dívidas" },
    { key: "other", label: "Outro motivo" },
  ],
  calm: [
    { key: "ca_bills", label: "Contas a pagar" },
    { key: "ca_income_uncertainty", label: "Incerteza da renda" },
    { key: "ca_debts", label: "Dívidas" },
    { key: "ca_others_pressure", label: "Pressão de gastos de outras pessoas" },
    { key: "other", label: "Outro motivo" },
  ],
  debt: [
    { key: "de_high_interest", label: "Juros altos" },
    { key: "de_heavy_installments", label: "Parcelas pesadas" },
    { key: "de_dont_know_total", label: "Não sei quanto devo" },
    { key: "other", label: "Outro motivo" },
  ],
};

export type ContextAnswerRow = { subject: string; question: string; answer_keys: string[]; updated_at: string };

/** Respostas ainda válidas em `today` (YYYY-MM-DD), por subject+pergunta. */
export function validAnswers(rows: ContextAnswerRow[], today: string): Map<string, string[]> {
  const t = new Date(`${today}T12:00:00Z`).getTime();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const at = new Date(r.updated_at).getTime();
    if (!Number.isFinite(at) || (t - at) / 86_400_000 > CONTEXT_ANSWER_VALID_DAYS) continue;
    out.set(`${r.subject}|${r.question}`, r.answer_keys);
  }
  return out;
}

export const patternSubject = (category: string) => `weekend:${category}`;
export const dimensionSubject = (key: string) => `dimension:${key}`;
