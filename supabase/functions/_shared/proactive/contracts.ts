// proactive_multifinance.v1 — contratos do motor de proatividade multi-financeira.
// ==========================================================================
// Nada aqui calcula dinheiro: os valores chegam prontos do snapshot canônico
// (financial_snapshot_contract.v9) e do diagnóstico. Este módulo apenas
// estrutura sinais, compõe situações e explica decisões de forma auditável.

export const PROACTIVE_MULTIFINANCE_VERSION = "proactive_multifinance.v1";

export type ProactiveDomain =
  | "cash"
  | "performance"
  | "cards"
  | "goals"
  | "commitments"
  | "debts"
  | "investments"
  | "patterns"
  | "emotions";

export type SignalDirection = "risk" | "opportunity" | "achievement" | "context";

/** Fato financeiro isolado, já materializado por um motor determinístico. */
export interface FinancialSignal {
  key: string;
  domain: ProactiveDomain;
  label: string;
  /** Impacto monetário absoluto em R$ (0 quando o sinal é apenas contexto). */
  amount: number;
  direction: SignalDirection;
  /** Data do evento, quando existe. */
  date: string | null;
  /** Dias até o evento (negativo = já ocorreu). */
  days_until: number | null;
  /** 0..1 — herdada da fonte, nunca inventada. */
  confidence: number;
  actionable: boolean;
  route: string | null;
  evidence: Record<string, unknown>;
}

export interface CashHorizonPoint {
  date: string;
  /** Saldo projetado ao fim do dia. */
  balance: number;
  inflow: number;
  outflow: number;
  labels: string[];
}

/** Contexto consolidado do usuário: uma leitura, todos os domínios. */
export interface MultiFinanceProactiveContext {
  version: string;
  user_id: string;
  as_of: string;
  monthly_income: number;
  materiality_floor: number;
  available_today: number;
  projected_month_end_available: number;
  daily_pace: number;
  typical_daily_pace: number;
  cash_horizon: CashHorizonPoint[];
  /** Primeiro dia em que o caixa projetado fica negativo (se houver). */
  first_negative_day: CashHorizonPoint | null;
  snapshot_ref: { reconciliation_id: string; formula_version: string };
  domains: {
    cash: Record<string, unknown>;
    cards: Record<string, unknown>;
    goals: unknown[];
    commitments: unknown[];
    debts: unknown[];
    patterns: unknown[];
  };
  learning: Record<string, { dismissals: number; actions: number; false_positives: number }>;
  /**
   * Highlights JÁ calculados por `financial_performance.v1` (lidos do snapshot
   * vigente). O motor proativo nunca recalcula — apenas reaproveita.
   */
  performance_highlights?: PerformanceHighlightInput[];
  /** Afinidade aprendida por tópico (-1..+1). Só ordena, nunca suprime risco. */
  affinity?: Record<string, number>;
}

/** Recorte mínimo de um highlight de performance consumido como sinal. */
export interface PerformanceHighlightInput {
  id: string;
  topic_key: string;
  title: string;
  body: string;
  /** Valor material em R$ (já determinístico). */
  materiality: number;
  sentiment: "positive" | "negative" | "neutral";
  severity: "info" | "attention" | "critical";
  nature: string | null;
  confidence: string;
  actionable: boolean;
  recommended_action: string | null;
  methodology: string | null;
}

export type SituationSeverity = "info" | "attention" | "critical";

/** Situação financeira: um ou mais sinais que juntos mudam uma decisão. */
export interface FinancialSituation {
  fingerprint: string;
  type: string;
  /** Tipo de comunicação do catálogo (reaproveita a política existente). */
  communication_kind: string;
  severity: SituationSeverity;
  title: string;
  body: string;
  primary_domain: ProactiveDomain;
  domains: ProactiveDomain[];
  signals: FinancialSignal[];
  impact_amount: number;
  days_until: number | null;
  confidence: number;
  actionable: boolean;
  route: string | null;
  priority_score: number;
  score_reasons: string[];
  evidence: Record<string, unknown>;
}

export type ProactiveDecisionKind = "deliver" | "suppress";

export interface ProactiveDecision {
  fingerprint: string;
  channel: "app" | "whatsapp";
  decision: ProactiveDecisionKind;
  reason: string;
  priority_score: number;
}

export interface AttentionBudget {
  /** Interrupções máximas por canal nesta rodada. */
  app: number;
  whatsapp: number;
}

export const DEFAULT_ATTENTION_BUDGET: AttentionBudget = { app: 3, whatsapp: 1 };
