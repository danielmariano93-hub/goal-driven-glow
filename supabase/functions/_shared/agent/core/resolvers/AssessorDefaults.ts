// AssessorDefaults (`nino_assessor_defaults.v1`)
//
// Rigor sem hesitação. Fail closed vale para o que MUDA o número (qual cartão,
// qual meta, qual categoria). Para escolhas de método que um assessor tomaria
// sozinho, o default é declarado aqui — e sempre acompanhado da premissa que
// vai no texto. O Nino assume e diz o que assumiu; não pergunta o óbvio.
export type AssessorDefault<T> = {
  key: string;
  value: T;
  /** Frase curta que precisa aparecer na resposta. */
  assumption: string;
  risk: "low" | "medium";
};

export const HABITUAL_WINDOW: AssessorDefault<number> = {
  key: "habitual_window_months",
  value: 6,
  assumption: "Considerei os últimos 6 meses completos.",
  risk: "low",
};

export const HABITUAL_STATISTIC: AssessorDefault<"typical" | "mean"> = {
  key: "habitual_statistic",
  value: "typical",
  assumption: "Usei o valor típico (mediana) para não deixar um mês fora do padrão distorcer.",
  risk: "low",
};

export const MIN_MONTHS_FOR_HABIT: AssessorDefault<number> = {
  key: "habitual_min_months",
  value: 3,
  assumption: "Com menos de 3 meses completos eu marco a leitura como pouco firme.",
  risk: "low",
};

export const EXPENSE_SCOPE: AssessorDefault<"all_expenses"> = {
  key: "expense_scope",
  value: "all_expenses",
  assumption: "Somei todas as despesas do recorte, incluindo cartão pela competência da fatura.",
  risk: "low",
};

export const DIVERGENCE_ALERT_PCT: AssessorDefault<number> = {
  key: "divergence_alert_pct",
  value: 20,
  assumption: "",
  risk: "low",
};

/**
 * Ambiguidade que PRECISA de pergunta: mais de uma entidade real plausível.
 * Qualquer outra coisa o assessor resolve com default declarado.
 */
export function mustAskUser(args: {
  candidates: Array<{ id: string; label: string }>;
  slot: string;
}): boolean {
  return args.candidates.length > 1;
}

export function assumptionsFor(keys: string[]): string[] {
  const all: Array<AssessorDefault<unknown>> = [
    HABITUAL_WINDOW, HABITUAL_STATISTIC, MIN_MONTHS_FOR_HABIT, EXPENSE_SCOPE,
  ];
  return all.filter((d) => keys.includes(d.key) && d.assumption).map((d) => d.assumption);
}
