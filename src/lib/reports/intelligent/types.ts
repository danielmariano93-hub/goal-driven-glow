// Contratos dos Relatórios Financeiros Inteligentes (reports_catalog.v1).
// Puro: nenhuma dependência de browser/Deno — espelhado para as Edge Functions
// por scripts/sync-finance-core.mjs.
import type { TransactionRow, AccountRow, AccountBalanceSnapshotRow, GoalRow } from "@/lib/engine/facts";

export const REPORTS_CATALOG_VERSION = "reports_catalog.v1";
export const REPORT_TEMPLATE_VERSION = "report_template.v3";

/**
 * `monthly_partial` = mês corrente, ainda aberto (números reais + projeção).
 * `custom` = intervalo livre escolhido pelo usuário (fechado e arbitrário).
 */
export type ReportType = "weekly" | "monthly" | "monthly_partial" | "custom";
export type MetricUnit = "BRL" | "pct" | "count" | "days" | "score" | "text";
export type Confidence = "low" | "medium" | "high";
export type DataQualityStatus = "ok" | "attention" | "insufficient";

export interface ReportPeriod {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number | null;
  text?: string;
  comparison?: number | null;
  comparisonPct?: number | null;
  unit: MetricUnit;
  evidence?: Record<string, unknown>;
  order: number;
}

export interface ReportHighlight {
  detectorKey: string;
  type: "risk" | "win" | "info" | "opportunity";
  title: string;
  body: string;
  priority: number;
  confidence: Confidence;
  category?: string | null;
  evidence: Record<string, unknown>;
  ctaLabel?: string | null;
  ctaRoute?: string | null;
  dedupKey: string;
  selectionReason: string;
  /** Família usada para deduplicar leituras equivalentes. */
  family?: string;
  /** Origem do destaque: motor do período ou catálogo de insights. */
  source?: "period" | "catalog";
}


export interface HealthComponent {
  key: string;
  label: string;
  score: number;   // pontos obtidos
  max: number;     // pontos possíveis
  detail: string;
}

export interface DataQualityFlag {
  key: string;
  label: string;
  severity: "info" | "attention" | "blocking";
  detail: string;
}

export interface CategorySlice {
  category: string;
  total: number;
  count: number;
  share: number;      // 0..1
  previous: number;
  deltaPct: number | null;
}

export interface SeriesPoint {
  label: string;      // DD/MM
  date: string;       // YYYY-MM-DD
  expense: number;
  income: number;
  cumulativeExpense: number;
}

export interface ReportPayload {
  version: string;
  reportType: ReportType;
  period: ReportPeriod;
  previousPeriod: ReportPeriod;
  totals: {
    income: number;
    expense: number;
    net: number;
    savingsRate: number | null;
    previousExpense: number;
    previousIncome: number;
    expenseDeltaPct: number | null;
    dailyAvgExpense: number;
    daysWithExpense: number;
    transactionCount: number;
    biggestExpense: { description: string; amount: number; date: string; category: string } | null;
    essentialTotal: number;
    flexibleTotal: number;
    cardOutstanding: number;
    cashTotal: number;
  };
  categories: CategorySlice[];
  series: SeriesPoint[];
  goals: Array<{ name: string; current: number; target: number; progress: number }>;
  /**
   * Presente apenas em relatórios do mês corrente (parciais). O mês ainda não
   * fechou: os números são reais até `period.end` e a projeção é explícita.
   */
  partial?: {
    daysElapsed: number;
    daysInMonth: number;
    /** Gasto projetado para o mês inteiro no ritmo atual. */
    projectedExpense: number;
    /** Receita projetada para o mês inteiro no ritmo atual. */
    projectedIncome: number;
    /** Comparação usa o mesmo número de dias do mês anterior. */
    comparableWindow: true;
  };
}


export interface IntelligentReport {
  reportType: ReportType;
  period: ReportPeriod;
  previousPeriod: ReportPeriod;
  metrics: ReportMetric[];
  highlights: ReportHighlight[];
  healthScore: number;
  healthBreakdown: HealthComponent[];
  dataQualityStatus: DataQualityStatus;
  dataQualityFlags: DataQualityFlag[];
  payload: ReportPayload;
  catalogVersion: string;
  templateVersion: string;
}

export interface ReportEngineInput {
  reportType: ReportType;
  /** Data de referência (dia da geração) no fuso do usuário. */
  referenceDate: Date;
  transactions: TransactionRow[];
  categoryNames?: Record<string, string>;
  accounts?: AccountRow[];
  balanceSnapshots?: AccountBalanceSnapshotRow[];
  goals?: GoalRow[];
  goalContributions?: Array<{ goal_id: string; amount: number }>;
  /** Destaques vindos do catálogo de insights (insights_catalog.v1). */
  extraHighlights?: ReportHighlight[];
  timezone?: string;

}
