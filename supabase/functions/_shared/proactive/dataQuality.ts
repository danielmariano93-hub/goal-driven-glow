// proactive_data_quality.v1 — quão completo é o dado do usuário (função pura).
// ============================================================================
// Um alerta só é verdadeiro se o dado que o sustenta está completo. Sem isso,
// "você gastou R$ 508 contra R$ 21 de entrada" é, na prática, "não vi o seu
// salário". Este módulo mede a completude e decide quais situações perdem
// confiança e qual pedido de dado substitui um falso alarme.
import type { FinancialSituation } from "./contracts.ts";

export const PROACTIVE_DATA_QUALITY_VERSION = "proactive_data_quality.v1";

export type IncomeStatus = "complete" | "partial" | "missing" | "unknown";

export type DataQualityInput = {
  today: string;
  /** Renda operacional já registrada no mês corrente. */
  current_month_income: number;
  /** Entradas ainda previstas no mês (recorrências/estimativas confirmadas). */
  expected_income_rest_of_month: number;
  /** Renda operacional dos meses completos anteriores, mais recente primeiro. */
  previous_months_income: number[];
  /** Primeiro e último lançamento confirmados (YYYY-MM-DD). */
  first_entry_date: string | null;
  last_entry_date: string | null;
};

export type DataQuality = {
  version: string;
  income_status: IncomeStatus;
  typical_monthly_income: number;
  income_coverage: number | null;
  history_months: number;
  days_since_last_entry: number | null;
  /** Ritmo "típico" só é comparável com pelo menos 2 meses de histórico e registro recente. */
  pace_reliable: boolean;
  /** Comparações com renda (sobra, déficit, folga) só valem com renda completa. */
  income_reliable: boolean;
  reasons: string[];
};

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function assessDataQuality(input: DataQualityInput): DataQuality {
  const reasons: string[] = [];
  const typical = Math.round(median(input.previous_months_income) * 100) / 100;
  const current = Math.max(0, Number(input.current_month_income) || 0);
  const expected = Math.max(0, Number(input.expected_income_rest_of_month) || 0);
  const covered = current + expected;

  let status: IncomeStatus;
  let coverage: number | null = null;
  if (typical > 0) {
    coverage = Math.round((covered / typical) * 100) / 100;
    status = current <= 0 && expected <= 0 ? "missing" : coverage < 0.5 ? "partial" : "complete";
  } else {
    status = current > 0 ? "complete" : "unknown";
  }
  if (status !== "complete") reasons.push(`income_${status}`);

  const historyMonths = input.first_entry_date
    ? Math.max(0, Math.floor(daysBetween(input.first_entry_date, input.today) / 30))
    : 0;
  const daysSinceLast = input.last_entry_date ? daysBetween(input.last_entry_date, input.today) : null;
  const paceReliable = historyMonths >= 2 && daysSinceLast != null && daysSinceLast <= 7;
  if (historyMonths < 2) reasons.push("short_history");
  if (daysSinceLast == null || daysSinceLast > 7) reasons.push("stale_entries");

  return {
    version: PROACTIVE_DATA_QUALITY_VERSION,
    income_status: status,
    typical_monthly_income: typical,
    income_coverage: coverage,
    history_months: historyMonths,
    days_since_last_entry: daysSinceLast,
    pace_reliable: paceReliable,
    income_reliable: status === "complete",
    reasons,
  };
}

/** Situações cuja verdade depende de a renda do mês estar registrada. */
const INCOME_DEPENDENT_TYPES = new Set(["month_end_shortfall"]);
const INCOME_DEPENDENT_KINDS = new Set(["cash_flow_imbalance", "goal_feasibility", "wealth_building_action"]);
/** Situações cuja verdade depende de um "típico" com histórico suficiente. */
const PACE_DEPENDENT_KINDS = new Set(["spending_pace_change", "growing_category", "performance_deterioration"]);

/** Confiança abaixo do piso do alocador (0,6): a situação não interrompe ninguém. */
const UNRELIABLE_CONFIDENCE = 0.4;

/**
 * Rebaixa a confiança de situações que dependem de dado incompleto e registra
 * o motivo. Nunca rebaixa situações críticas de caixa/dívida: essas se apoiam
 * em saldo e vencimento reais, não em renda estimada.
 */
export function applyDataQuality(situations: FinancialSituation[], dq: DataQuality): FinancialSituation[] {
  return situations.map((situation) => {
    const incomeDependent = INCOME_DEPENDENT_TYPES.has(situation.type)
      || INCOME_DEPENDENT_KINDS.has(situation.communication_kind);
    const paceDependent = PACE_DEPENDENT_KINDS.has(situation.communication_kind);
    const blockers: string[] = [];
    if (incomeDependent && !dq.income_reliable) blockers.push(`income_${dq.income_status}`);
    if (paceDependent && !dq.pace_reliable) blockers.push("pace_unreliable");
    if (!blockers.length) return situation;
    return {
      ...situation,
      confidence: Math.min(situation.confidence, UNRELIABLE_CONFIDENCE),
      score_reasons: [...situation.score_reasons, ...blockers.map((b) => `data_quality:${b}`)],
      evidence: { ...situation.evidence, data_quality_blockers: blockers, data_quality: dq },
    };
  });
}

/**
 * Pedido de dado que substitui o falso alarme: quando a renda do mês não foi
 * registrada, a coisa mais útil que o Nino pode dizer é pedir essa informação.
 * Só é criado se alguma situação foi rebaixada por renda incompleta.
 */
export function incomeDataRequest(
  dq: DataQuality,
  blocked: FinancialSituation[],
  asOf: string,
): FinancialSituation | null {
  if (dq.income_reliable || !blocked.some((s) => (s.evidence as any)?.data_quality_blockers?.some((b: string) => b.startsWith("income_")))) {
    return null;
  }
  const month = asOf.slice(0, 7);
  const typical = dq.typical_monthly_income;
  const body = dq.income_status === "partial"
    ? "Registrei só uma parte da sua renda deste mês. Com o restante lançado, minhas leituras de sobra e de metas ficam certas."
    : "Ainda não vi sua renda deste mês. Com ela registrada, consigo dizer de verdade quanto sobra e como estão suas metas.";
  return {
    fingerprint: `${PROACTIVE_DATA_QUALITY_VERSION}:income_request:${month}`,
    type: "income_data_request",
    communication_kind: "data_quality",
    severity: "info",
    title: dq.income_status === "partial" ? "Falta parte da sua renda do mês" : "Sua renda do mês ainda não apareceu",
    body,
    primary_domain: "cash",
    domains: ["cash"],
    signals: [],
    impact_amount: typical,
    days_until: null,
    confidence: 0.9,
    actionable: true,
    route: "/app/lancamentos",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: PROACTIVE_DATA_QUALITY_VERSION,
      data_quality: dq,
      replaces: blocked.map((s) => s.fingerprint),
    },
  };
}
