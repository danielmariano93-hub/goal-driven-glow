// Provenance helpers — todo número que sai do motor analítico deve carregar
// origem, período e nível de confiança. Nunca deixe uma tool devolver métrica
// nua para a LLM: sem provenance, sem número.

export type Confidence = "high" | "medium" | "low" | "insufficient_data";

export type Provenance = {
  period: { from: string; to: string; tz: "America/Sao_Paulo" };
  as_of: string;
  row_count: number;
  confidence: Confidence;
  formula_version: string;
  maturity?: { days_observed: number; days_in_month: number };
  notes?: string[];
};

export function makeProvenance(input: {
  from: string;
  to: string;
  row_count: number;
  formula_version: string;
  confidence: Confidence;
  maturity?: { days_observed: number; days_in_month: number };
  notes?: string[];
}): Provenance {
  return {
    period: { from: input.from, to: input.to, tz: "America/Sao_Paulo" },
    as_of: new Date().toISOString(),
    row_count: input.row_count,
    confidence: input.confidence,
    formula_version: input.formula_version,
    maturity: input.maturity,
    notes: input.notes,
  };
}

/** Regra unificada de confiança a partir do tamanho da amostra. */
export function confidenceFromSample(rowCount: number, daysObserved: number): Confidence {
  if (rowCount < 3 || daysObserved < 3) return "insufficient_data";
  if (rowCount < 15 || daysObserved < 7) return "low";
  if (rowCount < 60 || daysObserved < 15) return "medium";
  return "high";
}

export const TZ = "America/Sao_Paulo";
