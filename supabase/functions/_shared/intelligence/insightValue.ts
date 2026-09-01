// insight_value.v1 — valor de um insight para o usuário.
// A cota diária/semanal de comunicação é escassa: quem fala com o usuário deve
// ser o item de maior valor financeiro, não o que foi criado primeiro (FIFO).
// Função pura, sem I/O, para poder ser testada e reusada no app e no Edge.

export type InsightValueInput = {
  kind: string;
  severity: string;
  /** 0..1 */
  confidence?: number | null;
  /** Impacto monetário em R$ (sempre positivo). */
  impactAmount?: number | null;
  /** Renda operacional mensal do usuário, quando conhecida. */
  monthlyIncome?: number | null;
  /** Dias até o evento (0 = hoje, negativo = já venceu). */
  daysUntilEvent?: number | null;
  /** O item traz uma ação executável. */
  actionable?: boolean;
  /** Histórico de aprendizado por tipo, para este usuário. */
  dismissals?: number;
  actions?: number;
  falsePositives?: number;
};

export type InsightValue = {
  score: number;
  muted: boolean;
  reasons: string[];
};

/**
 * Ordem editorial do produto: o que realmente muda a vida financeira primeiro.
 * Tipos ausentes caem no piso (30) e disputam apenas por impacto e urgência.
 */
export const KIND_PRIORITY: Record<string, number> = {
  debt_overdue: 100,
  forgotten_bill: 96,
  debt_installment_due: 93,
  debt_due_soon: 92,
  card_bill_pressure: 90,
  card_cycle_acceleration: 86,
  upcoming_cash_pressure: 85,
  expected_recurring_payment: 84,
  recurring_commitment_pressure: 82,
  cash_flow_imbalance: 80,
  investment_drawdown: 74,
  wealth_building_action: 68,
  wealth_progress: 45,
  goal_feasibility: 70,
  goal_at_risk: 70,
  growing_category: 64,
  spending_pace_change: 62,
  concentration_risk: 58,
  emotional_spending: 50,
  debt_progress: 42,
  goal_progress: 40,
  advisor_review_weekly: 40,
  advisor_review_monthly: 40,
  engagement_drop: 34,
  emotional_checkin_due: 30,
  recurring_pattern: 22,
  categorize_transaction: 16,
  duplicate_expense: 14,
};

/** Tipos que são tarefa de revisão no app — nunca mensagem proativa. */
export const APP_TASK_KINDS = new Set([
  "duplicate_expense",
  "categorize_transaction",
  "uncategorized_transactions",
  "data_quality",
  "recurring_pattern",
]);

/**
 * Conteúdo financeiro que agora nasce no diagnóstico canônico. O motor legado
 * deixa de gerar esses tipos para não duplicar leitura nem consumir cota.
 */
export const DIAGNOSIS_OWNED_KINDS = new Set([
  "duplicate_expense",
  "cash_flow_imbalance",
  "financial_risk",
  "growing_category",
  "category_growth",
  "spending_spike",
  "concentration_risk",
  "goal_at_risk",
  "goal_feasibility",
  "forgotten_bill",
  "debt_overdue",
  "debt_due_soon",
  "debt_installment_due",
  "amount_anomaly",
  "recurring_commitment_pressure",
  "investment_drawdown",
  "uncategorized_transactions",
  "categorize_transaction",
]);

const SEVERITY_BOOST: Record<string, number> = { info: 0, attention: 9, critical: 18 };

export function kindPriority(kind: string): number {
  return KIND_PRIORITY[kind] ?? 30;
}

export function isAppTaskKind(kind: string): boolean {
  return APP_TASK_KINDS.has(kind);
}

/**
 * Piso de materialidade: 2% da renda mensal, com mínimo absoluto de R$ 50.
 * Sem renda conhecida, usa o mínimo absoluto.
 */
export function materialityFloor(monthlyIncome?: number | null): number {
  const income = Number(monthlyIncome ?? 0);
  if (!Number.isFinite(income) || income <= 0) return 50;
  return Math.max(50, income * 0.02);
}

/** Itens críticos e vencimentos sempre passam: o risco não é o valor. */
export function meetsMateriality(input: InsightValueInput): boolean {
  if (String(input.severity) === "critical") return true;
  if ((input.daysUntilEvent ?? 99) <= 3) return true;
  const impact = Math.abs(Number(input.impactAmount ?? 0));
  if (impact <= 0) return false;
  return impact >= materialityFloor(input.monthlyIncome);
}

export function insightValue(input: InsightValueInput): InsightValue {
  const reasons: string[] = [];
  let score = kindPriority(input.kind);
  reasons.push(`kind_priority:${score}`);

  const severityBoost = SEVERITY_BOOST[String(input.severity)] ?? 0;
  score += severityBoost;

  const impact = Math.abs(Number(input.impactAmount ?? 0));
  const income = Number(input.monthlyIncome ?? 0);
  if (impact > 0) {
    const ratio = income > 0 ? Math.min(impact / income, 0.5) : Math.min(impact / 5000, 0.5);
    const impactPoints = ratio * 80;
    score += impactPoints;
    reasons.push(`impact_ratio:${ratio.toFixed(3)}`);
  }

  const days = input.daysUntilEvent;
  if (days != null && Number.isFinite(days)) {
    const urgency = days <= 0 ? 22 : days <= 3 ? 15 : days <= 7 ? 9 : days <= 15 ? 4 : 0;
    score += urgency;
    if (urgency > 0) reasons.push(`urgency:${urgency}`);
  }

  const confidence = Number(input.confidence ?? 0.7);
  score += Math.max(0, Math.min(1, confidence)) * 10;
  if (input.actionable) score += 5;

  const dismissals = Math.max(0, Number(input.dismissals ?? 0));
  const falsePositives = Math.max(0, Number(input.falsePositives ?? 0));
  const actions = Math.max(0, Number(input.actions ?? 0));
  const penalty = dismissals * 14 + falsePositives * 30;
  if (penalty > 0) reasons.push(`learning_penalty:${penalty}`);
  score += actions * 8 - penalty;

  const muted = falsePositives >= 1 || dismissals >= 2;
  if (muted) reasons.push("muted_by_learning");

  return { score: Math.max(0, Number(score.toFixed(2))), muted, reasons };
}

export type RankedInsight<T> = { item: T; value: InsightValue };

/** Ordena por valor decrescente e devolve o score usado (auditável). */
export function rankInsights<T>(
  items: T[],
  toInput: (item: T) => InsightValueInput,
): Array<RankedInsight<T>> {
  return items
    .map((item) => ({ item, value: insightValue(toInput(item)) }))
    .sort((a, b) => b.value.score - a.value.score);
}
