// TonePolicy (`nino_narrative.v1`)
//
// Decide QUANDO o Nino pode falar como assessor (leitura interpretativa) e
// QUANDO precisa continuar operacional e determinístico (parcela vence amanhã,
// confirmação, recibo, divisão do rolê). Nenhum fato nasce aqui.

export type NarrativeTone =
  | "risk"
  | "attention"
  | "achievement"
  | "behavior"
  | "goal"
  | "opportunity"
  | "report";

/**
 * Tipos OPERACIONAIS: aviso com data, valor e ação. Texto fixo é melhor que
 * texto bonito — nunca passam pela camada de linguagem.
 */
export const OPERATIONAL_KINDS = new Set<string>([
  "debt_due_soon",
  "debt_installment_due",
  "debt_overdue",
  "split_payment_pending",
  "expected_recurring_payment",
  "forgotten_bill",
  "categorize_transaction",
  "emotional_checkin_due",
  "duplicate_expense",
]);

/** Tipos INTERPRETATIVOS: leitura, causa, comparação, comportamento, meta. */
export const NARRATIVE_TONES: Record<string, NarrativeTone> = {
  spending_pace_change: "attention",
  spending_spike: "attention",
  growing_category: "attention",
  small_spend_acceleration: "behavior",
  weekday_spending_risk: "behavior",
  weekend_spending_risk: "behavior",
  month_phase_spending_risk: "behavior",
  emotional_spending: "behavior",
  impulsive_spending: "behavior",
  financial_procrastination: "behavior",
  relapse_risk: "risk",
  concentration_risk: "risk",
  cash_flow_imbalance: "risk",
  upcoming_cash_pressure: "risk",
  card_bill_pressure: "risk",
  card_cycle_acceleration: "risk",
  recurring_commitment_pressure: "risk",
  investment_drawdown: "risk",
  goal_at_risk: "goal",
  goal_feasibility: "goal",
  goal_progress: "goal",
  debt_progress: "achievement",
  financial_discipline: "achievement",
  saving_opportunity: "opportunity",
  underused_subscription: "opportunity",
  recurring_pattern: "behavior",
  engagement_drop: "behavior",
  advisor_review_weekly: "report",
  advisor_review_monthly: "report",
};

export type ToneRules = {
  tone: NarrativeTone;
  guidance: string;
  question: string;
  maxSentences: number;
  maxNumbers: number;
};

const TONE_RULES: Record<NarrativeTone, Omit<ToneRules, "tone">> = {
  risk: {
    guidance: "Direto e sem alarme. Diga o que está apertando e o que muda se nada for feito, sem dramatizar.",
    question: "Quer que eu te mostre onde dá pra aliviar isso?",
    maxSentences: 4,
    maxNumbers: 3,
  },
  attention: {
    guidance: "Curioso, não acusatório. Aponte a mudança de ritmo e convide a explicar o motivo.",
    question: "Isso foi planejado ou te pegou de surpresa?",
    maxSentences: 4,
    maxNumbers: 3,
  },
  achievement: {
    guidance: "Reconhecimento concreto, sem exagero e sem elogio genérico.",
    question: "Quer manter esse ritmo no próximo mês?",
    maxSentences: 3,
    maxNumbers: 2,
  },
  behavior: {
    guidance: "Observação de padrão, na primeira pessoa, sem julgamento moral.",
    question: "Faz sentido pra você esse padrão?",
    maxSentences: 4,
    maxNumbers: 2,
  },
  goal: {
    guidance: "Foco na viabilidade: onde a meta está e o que falta, sem cobrança.",
    question: "Quer que eu ajuste o plano da meta?",
    maxSentences: 4,
    maxNumbers: 3,
  },
  opportunity: {
    guidance: "Objetivo e prático: onde existe espaço e quanto ele vale.",
    question: "Quer que eu detalhe essa oportunidade?",
    maxSentences: 3,
    maxNumbers: 2,
  },
  report: {
    guidance: "Abra com a leitura do período (o que mudou e por quê) e só depois os números de prova.",
    question: "Quer que eu detalhe algum ponto do período?",
    maxSentences: 4,
    maxNumbers: 3,
  },
};

export type NarrativeEligibility =
  | { eligible: true; rules: ToneRules }
  | { eligible: false; reason: "operational_kind" | "unknown_kind" };

export function narrativeEligibility(kind: string): NarrativeEligibility {
  const k = String(kind ?? "").trim();
  if (!k || OPERATIONAL_KINDS.has(k)) return { eligible: false, reason: "operational_kind" };
  const tone = NARRATIVE_TONES[k];
  if (!tone) return { eligible: false, reason: "unknown_kind" };
  return { eligible: true, rules: { tone, ...TONE_RULES[tone] } };
}

export function toneRulesFor(tone: NarrativeTone): ToneRules {
  return { tone, ...TONE_RULES[tone] };
}
