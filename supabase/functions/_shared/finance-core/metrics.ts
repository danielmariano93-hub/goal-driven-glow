// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// FinancialMetricsService (frontend). Núcleo puro que compõe helpers existentes
// e adiciona metas de categoria. Consumido por `useFinancialSnapshot` e por
// componentes da Home. Não faz I/O — só cálculo determinístico.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  computeAvailableUntil,
  computeBehavioralExpense,
  computeNetWorth,
  computeTotalCash,
  computeActiveDebtsTotal,
  computeCategoryBreakdown,
  computeGoalProgressFacts,
  computeInvestmentsTotal,
  computeInvestedPrincipal,
  computeMonthlyTotals,
  computeUpcomingCommitments,
  isRealMonthlyMovement,
  round2,
  reportingCompetenceDate,
  todayISO,

  type AccountRow,
  type AccountBalanceSnapshotRow,
  type CategoryRow,
  type DebtRow,
  type GoalContributionRow,
  type GoalRow,
  type InvestmentRow,
  type RecurringRow,
  type TransactionRow,
} from "./facts.ts";
import {
  computeCategoryProjection,
  type CategoryProjection,
  type CategoryProjectionConfidence,
  type CategoryProjectionMethod,
} from "./categoryProjection.ts";
import {
  computeCashBridge,
  computeNetWorthBridge,
  computePeriodPerformance,
  explainBalanceChange,
  type BalanceExplanation,
  type CashBridge,
  type NetWorthBridge,
  type PeriodPerformance,
} from "./bridges.ts";
import {
  computeCardExposure,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardCycleConfig,
  type CardExposure,
  type CardInstallmentRow,
  type CardStatementRow,
} from "./cardExposure.ts";
import { computeCanonicalCategoryTotal } from "./canonicalFacts.ts";
import { computeCardSpendingComparison, daysInclusive, type DateRange } from "./dailyAverage.ts";
import {
  computeCommitmentAgenda,
  COMMITMENT_AGENDA_VERSION,
  type CommitmentAgenda,
} from "./commitmentAgenda.ts";
import {
  clampRangeToToday,
  computeRhythm,
  computeRhythmComparison,
  type RhythmComparison,
  type RhythmTx,
} from "./spendingRhythm.ts";
import {
  computeFutureIncomeProjection,
  FUTURE_INCOME_FORMULA_VERSION,
  type FinancialIncomeSettings,
  type FutureIncomeEvent,
} from "./incomeProjection.ts";


export type CategoryGoalMode = "percent_reduction" | "fixed_limit";
export type CategoryGoalBaselineKind = "prev_month" | "avg_3m" | "custom";
export type CategoryGoalPeriodType =
  | "this_month"
  | "next_month"
  | "next_30_days"
  | "custom"
  | "monthly_recurring";

/**
 * Status priorizado (ordem de precedência descendente):
 *   paused/cancelled > scheduled > exceeded > limit_reached >
 *   completed_ok/completed_over > at_risk > attention > on_track
 * Uma meta cuja soma real já ultrapassou o limite jamais pode aparecer como
 * "on_track" ou "attention".
 */
export type CategoryGoalStatus =
  | "on_track"
  | "attention"
  | "at_risk"
  | "exceeded"
  | "scheduled"
  | "limit_reached"
  | "completed_ok"
  | "completed_over"
  | "paused"
  | "cancelled";

export interface CategorySpendingGoalRow {
  id: string;
  user_id: string;
  category_id: string;
  mode: CategoryGoalMode;
  reduction_pct: number | null;
  fixed_limit: number | null;
  baseline_kind: CategoryGoalBaselineKind;
  baseline_value: number | null;
  computed_limit: number;
  frequency: "once" | "monthly" | "custom";
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "cancelled";
  period_type?: CategoryGoalPeriodType;
  recurrence_end_date?: string | null;
  timezone?: string;
  alerts?: unknown;
}

export interface CategoryGoalEvaluation {
  goal: CategorySpendingGoalRow;
  period: DateRange;
  periodType: CategoryGoalPeriodType;
  categoryName?: string;

  // Contrato oficial (nomes canônicos)
  baselineAmount: number;
  targetAmount: number;
  actualSpend: number;
  remainingAmount: number;
  percentageUsed: number; // 0..1 (utilização real, sem clamp)
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  currentDailyRate: number;
  projectedFinalSpend: number;
  projectedDifference: number; // target - projected
  projectedOverage: number; // max(0, projected - target)
  currentOverage: number; // max(0, actual - target)
  dailyAllowance: number;
  requiredDailyReduction: number;
  status: CategoryGoalStatus;
  message: string;
  calculationReferenceDate: string;
  includedTransactionCount: number;
  projectionMethod: "linear" | "weekday_weighted" | CategoryProjectionMethod;
  /** Projeção decomposta e auditável (`category_projection.v1`). */
  projection: CategoryProjection;
  projectionConfidence: CategoryProjectionConfidence;
  /** R$/dia e "corte por dia" só são válidos quando true. */
  supportsDailyBudget: boolean;
  /** Cobranças recorrentes conhecidas que ainda caem no período. */
  remainingKnownCommitments: number;

  // Aliases legados (mantidos para não quebrar consumidores existentes)
  spent: number;
  limit: number;
  utilizationPct: number; // clampado 0..1 para barra
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  projectedSpend: number;
  projectedOverspend: number;
}

/** Versão do contrato financeiro único (App × Edge × Nino × MCP). */
export const FINANCE_CONTRACT_VERSION = "financial_snapshot_contract.v8";

export type SnapshotCompleteness = "complete" | "partial" | "unavailable";
export type SnapshotPeriodStatus = "open" | "closed";
export type SnapshotSourceFreshness = Record<string, { status: "fresh" | "stale" | "missing"; checkedAt: string }>;

export interface SnapshotAuditMetadata {
  generatedAt: string;
  asOf: string;
  periodStatus: SnapshotPeriodStatus;
  completeness: SnapshotCompleteness;
  missingSources: string[];
  sourceFreshness: SnapshotSourceFreshness;
  confidence: ProjectionConfidence;
  formulaVersions: Record<string, string>;
  /** Identificador estável da fotografia usada por UI e agentes. */
  reconciliationId: string;
}

export interface SnapshotMetricEvidence {
  source: string;
  formula: string;
  observedDays?: number;
  transactionCount?: number;
}

export interface FinancialSnapshotInput {
  accounts: AccountRow[];
  txs: TransactionRow[];
  recurring: RecurringRow[];
  snapshots: AccountBalanceSnapshotRow[];
  investments: InvestmentRow[];
  debts: DebtRow[];
  categoryGoals: CategorySpendingGoalRow[];
  categoryNameById?: Record<string, string>;
  period: DateRange;
  today?: Date;
  /** Faturas oficiais — quando presentes, têm precedência absoluta. */
  cardStatements?: CardStatementRow[];
  cardInstallments?: CardInstallmentRow[];
  cardIds?: string[];
  /** Ciclo real por cartão (closing_day/due_day) — habilita fatura em formação. */
  cards?: CardCycleConfig[];
  /** Metas individuais + contribuições (progresso canônico no snapshot). */
  goals?: GoalRow[];
  goalContributions?: GoalContributionRow[];
  /** Categorias para o breakdown canônico do mês. */
  categories?: CategoryRow[];
  /** Movimentos de investimento do período (habilita ponte patrimonial precisa). */
  investmentMovements?: Array<{ type: string; amount: number; occurred_at: string }>;
  /** Renda aproximada declarada; usada somente em projeções, nunca no caixa real. */
  incomeSettings?: FinancialIncomeSettings | null;
  audit?: Partial<Pick<SnapshotAuditMetadata, "generatedAt" | "completeness" | "missingSources" | "sourceFreshness">>;
}

export interface SnapshotGoalProgress {
  id: string;
  name: string;
  target: number;
  contributed: number;
  investedLinked: number;
  total: number;
  remaining: number;
  pct: number;
}

/** Nível de confiança da projeção — função apenas dos dias já observados. */
export type ProjectionConfidence = "insufficient" | "low" | "medium" | "high";

export const SPENDING_PROJECTION_VERSION = "financial_snapshot_contract.v8";

/**
 * FONTE ÚNICA de ritmo e projeção do mês (`financial_snapshot_contract.v8`).
 *
 * Regras invioláveis:
 *  - "Ritmo atual" tem UMA definição: consumo realizado do mês ÷ dias corridos.
 *  - "Ritmo típico" tem UMA definição: ritmo da janela móvel de 90 dias, sem
 *    fixas e sem atípicos.
 *  - Gasto projetado e saldo projetado são números DISTINTOS e nunca aparecem
 *    na mesma frase sem rótulo próprio.
 *  - O saldo projetado desconta somente a fatura com vencimento no mês, nunca
 *    a dívida total do cartão (que inclui competências futuras).
 */
export interface SpendingProjection {
  formulaVersion: string;
  monthStart: string;
  monthEnd: string;
  daysElapsed: number;
  daysRemaining: number;
  /** Consumo comportamental líquido do mês até hoje. */
  realizedConsumption: number;
  /** R$/dia realizado no mês (dias sem gasto contam). */
  currentDailyPace: number;
  /** R$/dia VARIÁVEL do mês (sem fixas, recorrentes e atípicos). */
  currentVariablePace: number;
  /** R$/dia típico dos últimos 90 dias, sem fixas nem atípicos. */
  typicalDailyPace: number;
  /** Peso do ritmo atual no blend (0..1), cresce com os dias observados. */
  paceWeight: number;
  /**
   * Gasto variável esperado até o fim do mês. Projetado SOMENTE a partir do
   * ritmo variável (fixas e recorrentes ficam em `upcomingConfirmedCommitments`,
   * nunca nos dois lugares).
   */
  projectedVariableSpending: number;
  /** Compromissos já conhecidos (recorrências e planejados) até o fim do mês. */
  upcomingConfirmedCommitments: number;
  /** Gasto total esperado no mês = realizado + variável + compromissos. */
  projectedTotalSpending: number;
  /** Entradas futuras confirmadas até o fim do mês. */
  confirmedFutureInflows: number;
  /** Renda fixa futura estimada, separada das entradas confirmadas. */
  estimatedFixedInflows: number;
  /** Agenda auditável das entradas estimadas. */
  estimatedIncomeEvents: FutureIncomeEvent[];
  /** Saldo disponível hoje. */
  currentAvailableBalance: number;
  /** Fatura com vencimento dentro do mês corrente. */
  cardDueThisMonth: number;
  /** Saldo esperado no último dia do mês. */
  projectedEndBalance: number;
  /** Livre após entradas e compromissos confirmados; não inclui gasto variável. */
  freeAfterKnownCommitments: number;
  /**
   * Composição auditável do saldo projetado. A soma algébrica das parcelas
   * abaixo é exatamente `projectedEndBalance` — nenhuma UI recalcula.
   */
  composition: {
    availableToday: number;
    confirmedFutureInflows: number;
    estimatedFixedInflows: number;
    knownCommitments: number;
    cardDueThisMonth: number;
    projectedVariableSpending: number;
    /** compromissos do mês por origem (fatura, parcela, recorrência, dívida, doação) */
    commitmentsBySource: Record<string, number>;
    /** quantidade de compromissos de saída considerados */
    commitmentsCount: number;
    /** true quando a fatura do mês é reconstrução, não documento oficial */
    cardDueIsEstimated: boolean;
    /** último dia coberto pela agenda que alimentou a projeção */
    agendaHorizonEnd: string;
  };
  confidence: ProjectionConfidence;
}

function projectionConfidenceOf(daysElapsed: number): ProjectionConfidence {
  if (daysElapsed < 3) return "insufficient";
  if (daysElapsed < 7) return "low";
  if (daysElapsed < 14) return "medium";
  return "high";
}



export interface FinancialSnapshot {
  contractVersion: string;
  today: string;
  period: DateRange;
  availableToday: number;
  netWorth: ReturnType<typeof computeNetWorth>;
  /** @deprecated use `projection.currentDailyPace` — proibido em componentes/páginas. */
  currentAverageDailyConsumption: number;
  previousAverageDailyConsumption: number;
  averageDailyVariationPct: number | null;
  /** Fonte canônica de ritmo (média total + ritmo típico + série acumulada). */
  rhythm: RhythmComparison;
  currentCardSpend: number;
  previousCardSpend: number;
  cardSpendVariationPct: number | null;
  daysRemainingInMonth: number;
  /** @deprecated use `projection.currentDailyPace`. */
  monthToDateAverageConsumption: number;
  /** @deprecated use `projection.projectedVariableSpending`. */
  projectedRemainingConsumption: number;
  confirmedFutureIncome: number;
  knownFutureCommitments: number;
  /** @deprecated use `projection.projectedEndBalance`. */
  projectedMonthEndAvailable: number;
  activeCategoryGoals: CategoryGoalEvaluation[];
  topCategoryGoal: CategoryGoalEvaluation | null;
  /** Exposição de cartão por cartão (fonte canônica única). */
  cardExposures: Record<string, CardExposure>;
  /** Dívida de cartão hoje — faturas abertas/parciais/atrasadas. */
  cardDebtToday: number;
  /** Parcelas de competências futuras — compromisso, não dívida atual. */
  cardFutureInstallments: number;
  /** true quando algum número de cartão veio de estimativa (sem fatura oficial). */
  cardDebtIsEstimated: boolean;
  /**
   * Patrimônio líquido já descontando as parcelas de competências futuras.
   * Responde "quanto sobra depois de honrar o que já comprometi?".
   */
  committedNetWorth: number;
  /** Totais comportamentais do mês corrente (mesma regra de Relatórios/MCP). */
  monthlyTotals: { month: string; income: number; expense: number; net: number };
  /** Breakdown de despesa do mês corrente por categoria. */
  categoryBreakdown: ReturnType<typeof computeCategoryBreakdown>;
  /** Saldo devedor das dívidas ativas (fora do cartão). */
  activeDebtTotal: number;
  activeDebts: Array<{
    id: string;
    name: string;
    outstandingBalance: number;
    installmentAmount: number | null;
    dueDay: number | null;
  }>;
  /** Valor atual da carteira e principal aportado. */
  investmentsTotal: number;
  investedPrincipal: number;
  /** Progresso canônico das metas individuais. */
  goalProgress: SnapshotGoalProgress[];
  /** Compromissos conhecidos nos próximos 30 dias (agenda canônica). */
  upcomingCommitments: CommitmentAgenda;
  /** Agenda canônica completa (faturas, parcelas, recorrências, planejados, dívidas). */
  commitmentAgenda: CommitmentAgenda;
  /** BLOCO B — resultado da rotina financeira do período. */
  periodPerformance: PeriodPerformance;
  /** BLOCO C — formação do saldo em conta (equação fechada). */
  cashBridge: CashBridge;
  /** BLOCO D — variação patrimonial do período. */
  netWorthBridge: NetWorthBridge;
  /** Explicação determinística de como o saldo se formou. */
  balanceExplanation: BalanceExplanation;
  /** Contrato v5 — ritmo e projeção do mês (fonte única para toda a UI). */
  projection: SpendingProjection;
  audit: SnapshotAuditMetadata;
  evidence: {
    availableToday: SnapshotMetricEvidence;
    currentDailyPace: SnapshotMetricEvidence;
    projectedEndBalance: SnapshotMetricEvidence;
  };

}


function monthRangeOf(d: Date): DateRange {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: todayISO(start), end: todayISO(end) };
}

/**
 * Resolve o período efetivo da meta considerando `period_type` e a data atual.
 * Para `monthly_recurring`, retorna o ciclo do mês corrente (ou próximo, se a
 * meta ainda não começou), respeitando `recurrence_end_date`.
 */
export function resolveGoalPeriod(goal: CategorySpendingGoalRow, today: Date): DateRange {
  const type: CategoryGoalPeriodType = (goal.period_type as CategoryGoalPeriodType | undefined) ??
    (goal.end_date ? "custom" : "monthly_recurring");

  const todayIso = todayISO(today);

  if (type === "monthly_recurring") {
    // Datas financeiras são civis em America/Sao_Paulo. Construir meia-noite
    // local fazia o runtime UTC deslocar o ciclo para o mês anterior.
    const anchorIso = todayIso < goal.start_date ? goal.start_date : todayIso;
    const [anchorYear, anchorMonth] = anchorIso.split("-").map(Number);
    const monthStart = `${anchorYear}-${String(anchorMonth).padStart(2, "0")}-01`;
    const monthEnd = todayISO(new Date(Date.UTC(anchorYear, anchorMonth, 0, 12)));
    // Se o mês de hoje é anterior ao start_date da meta, usa o próprio mês do start.
    if (todayIso < goal.start_date) {
      const [goalYear, goalMonth] = goal.start_date.split("-").map(Number);
      return {
        start: `${goalYear}-${String(goalMonth).padStart(2, "0")}-01`,
        end: todayISO(new Date(Date.UTC(goalYear, goalMonth, 0, 12))),
      };
    }
    return { start: monthStart, end: monthEnd };
  }

  // Casos com datas explícitas (this_month, next_month, next_30_days, custom):
  // usa exatamente o que veio persistido em start_date/end_date.
  return {
    start: goal.start_date,
    end: goal.end_date ?? goal.start_date,
  };
}

function statusPriority(
  goal: CategorySpendingGoalRow,
  today: Date,
  period: DateRange,
  actualSpend: number,
  limit: number,
  projected: number,
): CategoryGoalStatus {
  if (goal.status === "cancelled") return "cancelled";
  if (goal.status === "paused") return "paused";
  const todayIso = todayISO(today);
  if (todayIso < period.start) return "scheduled";
  // Prioridade absoluta: ultrapassada mata qualquer projeção
  if (actualSpend > limit) {
    return todayIso > period.end ? "completed_over" : "exceeded";
  }
  if (todayIso > period.end) return actualSpend <= limit ? "completed_ok" : "completed_over";
  if (actualSpend === limit) return "limit_reached";
  // Ainda dentro do período e abaixo do limite: olha projeção
  const overage = Math.max(0, projected - limit);
  if (overage > limit * 0.1) return "at_risk";
  if (overage > 0) return "attention";
  return "on_track";
}

function statusMessage(
  status: CategoryGoalStatus,
  name: string,
  currentOverage: number,
  projectedOverage: number,
  projected: number,
  dailyAllowance: number,
  requiredDailyReduction: number,
  daysRemaining: number,
  periodStart: string,
  periodEnd: string,
): string {
  const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  switch (status) {
    case "scheduled":
      return `Começa em ${new Date(periodStart + "T00:00:00").toLocaleDateString("pt-BR")}.`;

    case "paused":
      return `Meta de ${name} está pausada.`;
    case "cancelled":
      return `Meta de ${name} foi cancelada.`;
    case "exceeded":
      return `Você ultrapassou o limite em ${brl(currentOverage)}. Novos gastos aumentarão o excesso.`;
    case "limit_reached":
      return `Você atingiu o limite e ainda faltam ${daysRemaining} dia(s).`;
    case "completed_ok":
      return `Você encerrou o período dentro do limite em ${name}.`;
    case "completed_over":
      return `O período terminou ${brl(currentOverage)} acima da meta.`;
    case "at_risk":
      // Sem R$/dia válido (categoria de compromisso), a ação é evitar/reduzir
      // o valor previsto — nunca pedir corte de "R$ 0,00 por dia".
      return requiredDailyReduction > 0
        ? `Para ficar dentro da meta, reduza aprox. ${brl(requiredDailyReduction)} por dia.`
        : `Ainda está dentro do teto, mas a projeção indica ${brl(projectedOverage)} de excesso no fechamento.`;
    case "attention":
      return `No ritmo atual, você pode ultrapassar a meta em ${brl(projectedOverage)}.`;
    case "on_track":
    default:
      return `No ritmo atual, você deve terminar em ${brl(projected)}.`;
  }
}

export function evaluateCategoryGoal(
  goal: CategorySpendingGoalRow,
  txs: TransactionRow[],
  today: Date,
  categoryName?: string,
): CategoryGoalEvaluation {
  const period = resolveGoalPeriod(goal, today);
  const todayIso = todayISO(today);
  const totalDays = Math.max(1, daysInclusive(period.start, period.end));

  // Data de referência: menor entre hoje e fim do período
  const referenceIso = todayIso < period.end ? todayIso : period.end;
  const elapsedDays = todayIso < period.start
    ? 0
    : Math.min(totalDays, daysInclusive(period.start, referenceIso));
  const remainingDays = todayIso < period.start
    ? totalDays
    : todayIso >= period.end
      ? 0
      : Math.max(0, totalDays - elapsedDays);

  // Soma real de despesas comportamentais da categoria no período, já líquida
  // dos estornos vinculados à despesa original (finance_contract.v9).
  let actualSpend = 0;
  let includedTransactionCount = 0;
  const goalAttribution = buildRefundAttribution(txs);
  for (const t of txs) {
    if (effectiveCategoryId(t, goalAttribution) !== goal.category_id) continue;
    // `reporting_competence.v1`: fatura define o mês do gasto de cartão.
    const competenceDay = reportingCompetenceDate(t);
    if (competenceDay < period.start || competenceDay > period.end) continue;

    const refundCredit = behavioralMetricAmount(t, "expense");
    if (String(t.movement_kind ?? "") === "refund") {
      if (refundCredit === 0) continue;
      actualSpend += refundCredit; // negativo: abate a categoria original
      continue;
    }
    if (t.type !== "expense") continue;
    if (!isRealMonthlyMovement(t)) continue;
    actualSpend += Number(t.amount || 0);
    includedTransactionCount += 1;
  }
  actualSpend = round2(Math.max(0, actualSpend));


  const limit = round2(Number(goal.computed_limit || 0));
  const baselineAmount = round2(Number(goal.baseline_value ?? 0));
  const remainingAmount = round2(limit - actualSpend);
  const percentageUsed = limit > 0 ? round2(actualSpend / limit) : 0;

  const currentDailyRate = elapsedDays > 0 ? round2(actualSpend / elapsedDays) : 0;

  // Projeção por NATUREZA da categoria (`category_projection.v1`): consumo
  // contínuo projeta por ritmo; compromisso projeta por cobranças conhecidas.
  const projection = computeCategoryProjection({
    txs,
    categoryId: goal.category_id,
    period: { start: period.start, end: period.end },
    confirmedSpend: actualSpend,
    elapsedDays,
    remainingDays,
    todayIso,
  });
  const projectedFinalSpend = Math.max(actualSpend, projection.components.projectedTotal);
  const projectedDifference = round2(limit - projectedFinalSpend);
  const projectedOverage = round2(Math.max(0, projectedFinalSpend - limit));
  const currentOverage = round2(Math.max(0, actualSpend - limit));

  const remainingBudget = Math.max(0, limit - actualSpend);
  // R$/dia só existe onde o comportamento da categoria é de fluxo contínuo.
  const dailyAllowance = !projection.supportsDailyBudget || actualSpend >= limit || remainingDays === 0
    ? 0
    : round2(remainingBudget / remainingDays);

  const allowedRemainingRate = remainingDays > 0 ? remainingBudget / remainingDays : 0;
  const requiredDailyReduction = projection.supportsDailyBudget && projectedOverage > 0 && remainingDays > 0
    ? round2(Math.max(0, currentDailyRate - allowedRemainingRate))
    : 0;

  const status = statusPriority(goal, today, period, actualSpend, limit, projectedFinalSpend);
  const message = statusMessage(
    status,
    categoryName ?? "categoria",
    currentOverage,
    projectedOverage,
    projectedFinalSpend,
    dailyAllowance,
    requiredDailyReduction,
    remainingDays,
    period.start,
    period.end,
  );


  const utilClamped = Math.min(1, Math.max(0, percentageUsed));

  return {
    goal,
    period,
    periodType: (goal.period_type as CategoryGoalPeriodType | undefined) ?? "monthly_recurring",
    categoryName,
    baselineAmount,
    targetAmount: limit,
    actualSpend,
    remainingAmount,
    percentageUsed,
    elapsedDays,
    totalDays,
    remainingDays,
    currentDailyRate,
    projectedFinalSpend,
    projectedDifference,
    projectedOverage,
    currentOverage,
    dailyAllowance,
    requiredDailyReduction,
    status,
    message,
    calculationReferenceDate: referenceIso,
    includedTransactionCount,
    projectionMethod: projection.method,
    projection,
    projectionConfidence: projection.confidence,
    supportsDailyBudget: projection.supportsDailyBudget,
    remainingKnownCommitments: projection.components.remainingKnownCommitments,
    // Aliases legados
    spent: actualSpend,
    limit,
    utilizationPct: utilClamped,
    daysElapsed: elapsedDays,
    daysTotal: totalDays,
    daysRemaining: remainingDays,
    projectedSpend: projectedFinalSpend,
    projectedOverspend: projectedOverage,
  };
}

/** Baseline de referência para propor um limite: média dos últimos 3 meses ou mês anterior. */
export function computeCategoryBaseline(
  txs: TransactionRow[],
  categoryId: string,
  kind: CategoryGoalBaselineKind,
  today: Date,
): number {
  if (kind === "custom") return 0;
  const months = kind === "avg_3m" ? 3 : 1;
  let total = 0;
  let counted = 0;
  for (let i = 1; i <= months; i++) {
    const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = todayISO(new Date(ref.getFullYear(), ref.getMonth(), 1));
    const end = todayISO(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
    // finance_truth.v1: baseline usa a MESMA verdade do ranking — categoria
    // econômica efetiva e estorno abatendo a despesa original.
    const fact = computeCanonicalCategoryTotal(txs, categoryId, { start, end }, "expense");
    const monthTotal = Math.max(0, fact.net);
    total += monthTotal;
    counted += 1;
  }
  return round2(counted > 0 ? total / counted : 0);
}

/**
 * Identifica a fotografia financeira sem depender da ordem em que o PostgREST
 * devolveu as linhas. Não é um hash de segurança: serve para provar, em logs e
 * respostas, que App e agentes calcularam sobre o mesmo conjunto de fatos.
 */
function financialFingerprint(input: FinancialSnapshotInput): string {
  const facts = [
    ...input.accounts.map((row) => `a:${row.id}:${row.opening_balance}:${row.active}`),
    ...input.txs.map((row) => `t:${row.id}:${row.status}:${row.type}:${row.amount}:${row.occurred_at}:${row.posted_at ?? ""}:${row.movement_kind ?? ""}:${row.account_id ?? ""}:${row.credit_card_id ?? ""}:${row.investment_id ?? ""}`),
    ...input.snapshots.map((row) => `s:${row.account_id}:${row.balance_date}:${row.balance}:${row.status ?? ""}`),
    ...input.investments.map((row) => `i:${row.id}:${row.invested_amount}:${row.current_value}:${row.goal_id ?? ""}`),
    ...input.debts.map((row) => `d:${row.id}:${row.status}:${row.outstanding_balance}:${row.installment_amount ?? ""}:${row.due_day ?? ""}`),
    ...(input.cardStatements ?? []).map((row) => `cs:${row.id ?? ""}:${row.credit_card_id}:${row.competence_month}:${row.status ?? ""}:${row.stated_total ?? ""}:${row.paid_amount ?? ""}:${row.outstanding_amount ?? ""}`),
    ...(input.cardInstallments ?? []).map((row) => `ci:${row.id ?? ""}:${row.credit_card_id}:${row.competence_month}:${row.status ?? ""}:${row.amount}:${row.absorbed_by_statement_id ?? ""}`),
    ...(input.goals ?? []).map((row) => `g:${row.id}:${row.status}:${row.target_amount}`),
    ...input.categoryGoals.map((row) => `cg:${row.id}:${row.status}:${row.computed_limit}`),
  ].sort();
  let hash = 2_166_136_261;
  const serialized = facts.join("|");
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function computeFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const today = input.today ?? new Date();
  const todayIso = todayISO(today);

  const currentYM = todayIso.slice(0, 7);
  const monthlyTotalsForDonation = computeMonthlyTotals(input.txs, currentYM);
  const availableToday = computeTotalCash(input.accounts, input.txs, input.snapshots);
  const netWorthRaw = computeNetWorth(input.accounts, input.txs, input.investments, input.debts, input.snapshots);
  const cardExposures = computeCardExposure({
    cardIds: input.cardIds ?? [],
    statements: input.cardStatements ?? [],
    installments: input.cardInstallments ?? [],
    txs: input.txs as never,
    currentYM: todayIso.slice(0, 7),
    // Mesma configuração de ciclo usada na página Cartões — paridade obrigatória.
    cards: input.cards ?? [],
    todayISO: todayIso,
  });
  const hasCardSource = Object.keys(cardExposures).length > 0;
  const cardDebtToday = hasCardSource ? totalCardDebtOf(cardExposures) : round2(netWorthRaw.cardsOwed);
  const cardFutureInstallments = totalFutureInstallmentsOf(cardExposures);
  const cardDebtIsEstimated = Object.values(cardExposures).some((exposure) =>
    exposure.currentStatement.amount > 0 && exposure.currentStatement.source !== "official"
  );
  // Patrimônio usa a MESMA dívida de cartão exibida na página Cartões.
  const owed = round2(netWorthRaw.accountOverdraft + cardDebtToday + netWorthRaw.otherDebts);
  const netWorth = {
    ...netWorthRaw,
    cardsOwed: cardDebtToday,
    owed,
    net: round2(netWorthRaw.assets - owed),
  };
  const effectivePeriod = clampRangeToToday(input.period, todayIso);
  const rhythm = computeRhythmComparison(input.txs as RhythmTx[], effectivePeriod, {
    categoryNameById: input.categoryNameById ?? {},
  });
  const card = computeCardSpendingComparison(input.txs, effectivePeriod);

  const monthRange = monthRangeOf(today);
  const monthToDateRange: DateRange = { start: monthRange.start, end: todayIso };
  const mtdExpense = computeBehavioralExpense(input.txs, monthToDateRange);
  const daysElapsed = Math.max(1, daysInclusive(monthRange.start, todayIso));
  const daysTotal = daysInclusive(monthRange.start, monthRange.end);
  const daysRemainingInMonth = Math.max(0, daysTotal - daysElapsed);
  const mtdAvg = round2(mtdExpense / daysElapsed);

  // ── Ritmo típico (janela móvel de 90 dias, sem fixas nem atípicos) ─────────
  const typicalWindowStart = todayISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89));
  const typicalRhythm = computeRhythm(input.txs as RhythmTx[], { start: typicalWindowStart, end: todayIso }, {
    categoryNameById: input.categoryNameById ?? {},
  });
  const typicalDailyPace = typicalRhythm.typicalAverage;

  // Ritmo VARIÁVEL do mês: mesmo denominador do ritmo atual, mas sem fixas,
  // recorrentes e atípicos — são eles que já entram como compromissos conhecidos.
  const mtdRhythm = computeRhythm(input.txs as RhythmTx[], monthToDateRange, {
    categoryNameById: input.categoryNameById ?? {},
  });
  const currentVariablePace = mtdRhythm.typicalAverage;

  // Blend: o ritmo do mês só ganha peso pleno com 7 dias observados.
  const paceWeight = Math.min(1, daysElapsed / 7);
  const blendedPace = round2(currentVariablePace * paceWeight + typicalDailyPace * (1 - paceWeight));
  const projectedVariableSpending = round2(blendedPace * daysRemainingInMonth);
  const projectedRemainingConsumption = projectedVariableSpending;

  const availUntilEnd = computeAvailableUntil({
    accounts: input.accounts,
    txs: input.txs,
    recurring: input.recurring,
    snapshots: input.snapshots,
    endDate: monthRange.end,
    today,
    // Nunca reconstruir dívida de cartão por transações quando há exposição oficial.
    cardDebtOverride: hasCardSource ? cardDebtToday : null,
  });

  // ── Metas de doação viram compromisso do mês (valor fixo ou % da receita) ──
  const donationCommitments = (input.goals ?? [])
    .filter((g) => String(g.kind ?? "savings") === "donation" && g.status === "active" && (!g.donation_end_date || g.donation_end_date >= todayIso))
    .map((g) => {
      const selectedIncomeCategories = new Set(g.donation_income_category_ids ?? []);
      const scopedTxs = g.donation_income_scope === "selected_categories"
        ? input.txs.filter((tx) => tx.type !== "income" || (tx.category_id != null && selectedIncomeCategories.has(tx.category_id)))
        : input.txs;
      const monthIncome = computeMonthlyTotals(scopedTxs, currentYM).income;
      const amount = String(g.donation_mode) === "income_percent"
        ? round2((monthIncome * Number(g.donation_percent ?? 0)) / 100)
        : round2(Number(g.monthly_target ?? 0));
      const dueDay = Math.max(1, Math.min(28, Number(g.donation_due_day ?? 25)));
      const due = todayISO(new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, daysInclusive(monthRange.start, monthRange.end))));
      const date = due < todayIso ? todayISO(new Date(today.getFullYear(), today.getMonth() + 1, dueDay)) : due;
      return { id: g.id, name: `Doação · ${g.name}`, amount: g.donation_end_date && date > g.donation_end_date ? 0 : amount, date };
    })
    .filter((d) => d.amount > 0);

  // ── AGENDA CANÔNICA: entrada obrigatória da projeção de fechamento ──────────
  // O horizonte cobre no mínimo 30 dias e sempre alcança o fim da competência,
  // para que nenhum vencimento do mês fique fora do saldo projetado.
  const agendaHorizonDays = Math.max(30, daysInclusive(todayIso, monthRange.end));
  const commitmentAgenda = computeCommitmentAgenda({
    donations: donationCommitments,
    recurring: input.recurring,
    txs: input.txs,
    statements: (input.cardStatements ?? []) as never,
    installments: (input.cardInstallments ?? []) as never,
    cards: (input.cards ?? []) as never,
    debts: input.debts as never,
    horizonDays: agendaHorizonDays,
    today,
  });

  // Recorte da agenda que pertence à competência corrente.
  const agendaThisMonth = commitmentAgenda.items.filter((i) => i.date <= monthRange.end);
  const CARD_SOURCES = new Set(["card_statement", "card_installment"]);
  const agendaCardDue = round2(
    agendaThisMonth.filter((i) => i.type === "expense" && CARD_SOURCES.has(i.source)).reduce((s, i) => s + i.amount, 0),
  );
  const agendaOtherCommitments = round2(
    agendaThisMonth.filter((i) => i.type === "expense" && !CARD_SOURCES.has(i.source)).reduce((s, i) => s + i.amount, 0),
  );
  const agendaCommitmentsBySource = agendaThisMonth.reduce((acc, item) => {
    if (item.type !== "expense") return acc;
    acc[item.source] = round2((acc[item.source] ?? 0) + item.amount);
    return acc;
  }, {} as Record<string, number>);

  const confirmedFutureIncome = round2(availUntilEnd.plannedIncome + availUntilEnd.recurringIn);
  const estimatedIncome = computeFutureIncomeProjection({
    settings: input.incomeSettings,
    txs: input.txs,
    recurring: input.recurring,
    today,
    periodEnd: monthRange.end,
  });
  // Compromissos conhecidos vêm da AGENDA (deduplicada), não mais de somas
  // paralelas de planejados + recorrências — origem das divergências anteriores.
  const knownFutureCommitments = agendaOtherCommitments;
  // Cartão do mês: fatura oficial tem precedência; sem fatura, parcelas e compras
  // do ciclo entram como estimativa — nunca zero silencioso.
  const exposureCardDue = round2(
    Object.values(cardExposures).reduce((sum, exposure) => sum + exposure.currentStatement.amount, 0),
  );
  // A agenda contém apenas datas a partir de hoje. Uma fatura da competência
  // ainda aberta não pode desaparecer no dia seguinte ao vencimento; por isso
  // a exposição da competência corrente é a base, e a agenda cobre legados
  // cuja competência esteja inconsistente mas cujo vencimento ainda seja do mês.
  const cardDueThisMonth = hasCardSource ? round2(Math.max(exposureCardDue, agendaCardDue)) : cardDebtToday;
  const cardDueIsEstimated = Object.values(cardExposures).some((exposure) =>
    exposure.currentStatement.amount > 0 && exposure.currentStatement.source !== "official"
  ) || agendaThisMonth.some((item) => CARD_SOURCES.has(item.source) && item.estimated);
  const projectedMonthEndAvailable = round2(
    availableToday + confirmedFutureIncome + estimatedIncome.total - knownFutureCommitments - cardDueThisMonth - projectedVariableSpending,
  );
  const freeAfterKnownCommitments = round2(
    availableToday + confirmedFutureIncome + estimatedIncome.total - knownFutureCommitments - cardDueThisMonth,
  );
  const projection: SpendingProjection = {
    formulaVersion: SPENDING_PROJECTION_VERSION,
    monthStart: monthRange.start,
    monthEnd: monthRange.end,
    daysElapsed,
    daysRemaining: daysRemainingInMonth,
    realizedConsumption: round2(mtdExpense),
    currentDailyPace: mtdAvg,
    currentVariablePace,
    typicalDailyPace,
    paceWeight: round2(paceWeight),
    projectedVariableSpending,
    upcomingConfirmedCommitments: knownFutureCommitments,
    // Consumo de caixa completo: realizado + variável previsto + contas + fatura.
    // A fatura fica separada na composição, mas não pode desaparecer do total.
    projectedTotalSpending: round2(mtdExpense + projectedVariableSpending + knownFutureCommitments + cardDueThisMonth),
    confirmedFutureInflows: confirmedFutureIncome,
    estimatedFixedInflows: estimatedIncome.total,
    estimatedIncomeEvents: estimatedIncome.events,
    currentAvailableBalance: availableToday,
    cardDueThisMonth,
    projectedEndBalance: projectedMonthEndAvailable,
    freeAfterKnownCommitments,
    composition: {
      availableToday,
      confirmedFutureInflows: confirmedFutureIncome,
      estimatedFixedInflows: estimatedIncome.total,
      knownCommitments: knownFutureCommitments,
      cardDueThisMonth,
      projectedVariableSpending,
      commitmentsBySource: agendaCommitmentsBySource,
      commitmentsCount: agendaThisMonth.filter((i) => i.type === "expense").length,
      cardDueIsEstimated,
      agendaHorizonEnd: commitmentAgenda.horizonEnd,
    },
    confidence: projectionConfidenceOf(daysElapsed),
  };


  const categoryNameById = input.categoryNameById ?? {};
  const activeCategoryGoals: CategoryGoalEvaluation[] = input.categoryGoals
    .filter((g) => g.status === "active")
    .map((g) => evaluateCategoryGoal(g, input.txs, today, categoryNameById[g.category_id]));

  const topCategoryGoal = pickTopGoal(activeCategoryGoals);

  const monthlyTotalsRaw = monthlyTotalsForDonation;
  const categories: CategoryRow[] = input.categories
    ?? Object.entries(categoryNameById).map(([id, name]) => ({ id, name, type: "expense" as const }));
  const categoryBreakdown = computeCategoryBreakdown(input.txs, categories, currentYM, "expense");
  const activeDebtTotal = computeActiveDebtsTotal(input.debts);
  const investmentsTotal = computeInvestmentsTotal(input.investments);
  const investedPrincipal = computeInvestedPrincipal(input.investments);
  const goalProgress: SnapshotGoalProgress[] = (input.goals ?? [])
    .filter((g) => g.status === "active")
    .map((g) => {
      const p = computeGoalProgressFacts(
        g.target_amount,
        g.id,
        input.goalContributions ?? [],
        input.investments,
      );
      return { id: g.id, name: g.name, target: Number(g.target_amount) || 0, ...p };
    });
  // A agenda canônica já foi calculada ANTES da projeção (ela é a entrada dela).
  const upcomingCommitments = commitmentAgenda;

  // BLOCOS B/C/D — pontes canônicas. Nenhum consumidor recalcula estes números.
  const bridgePeriod = { start: effectivePeriod.start, end: effectivePeriod.end };
  const periodPerformance = computePeriodPerformance(input.txs, bridgePeriod);
  const cashBridge = computeCashBridge({
    accounts: input.accounts,
    txs: input.txs,
    snapshots: input.snapshots,
    period: bridgePeriod,
  });
  const netWorthBridge = computeNetWorthBridge({
    accounts: input.accounts,
    txs: input.txs,
    snapshots: input.snapshots,
    period: bridgePeriod,
    investments: input.investments,
    debts: input.debts,
    investmentMovements: input.investmentMovements,
    cardDebtOverride: cardDebtToday,
  });
  const balanceExplanation = explainBalanceChange(cashBridge, periodPerformance);
  const periodStatus: SnapshotPeriodStatus = input.period.end < todayIso ? "closed" : "open";
  const audit: SnapshotAuditMetadata = {
    generatedAt: input.audit?.generatedAt ?? today.toISOString(),
    asOf: todayIso,
    periodStatus,
    completeness: input.audit?.completeness ?? "complete",
    missingSources: input.audit?.missingSources ?? [],
    sourceFreshness: input.audit?.sourceFreshness ?? {},
    confidence: projection.confidence,
    formulaVersions: {
      snapshot: FINANCE_CONTRACT_VERSION,
      projection: SPENDING_PROJECTION_VERSION,
      futureIncome: FUTURE_INCOME_FORMULA_VERSION,
      rhythm: rhythm.current.formulaVersion,
      commitmentAgenda: COMMITMENT_AGENDA_VERSION,
    },
    reconciliationId: `fs-v8:${todayIso}:${financialFingerprint(input)}`,
  };

  const activeDebts = input.debts
    .filter((debt) => debt.status === "active" && Number(debt.outstanding_balance || 0) > 0)
    .map((debt) => ({
      id: debt.id,
      name: debt.name,
      outstandingBalance: round2(Number(debt.outstanding_balance || 0)),
      installmentAmount: debt.installment_amount == null ? null : round2(Number(debt.installment_amount)),
      dueDay: debt.due_day == null ? null : Number(debt.due_day),
    }));

  return {
    audit,
    evidence: {
      availableToday: { source: "accounts+transactions+account_balance_snapshots", formula: "total_cash" },
      currentDailyPace: { source: "transactions", formula: "behavioral_consumption / observed_days", observedDays: daysElapsed },
      projectedEndBalance: { source: "financial_snapshot", formula: "available + confirmed_inflows + estimated_fixed_inflows - commitments - card_due - projected_variable_spending", observedDays: daysElapsed },
    },
    projection,
    periodPerformance,

    cashBridge,
    netWorthBridge,
    balanceExplanation,
    contractVersion: FINANCE_CONTRACT_VERSION,
    monthlyTotals: { month: currentYM, ...monthlyTotalsRaw },
    categoryBreakdown,
    activeDebtTotal,
    activeDebts,
    investmentsTotal,
    investedPrincipal,
    goalProgress,
    upcomingCommitments,
    commitmentAgenda,
    today: todayIso,
    period: input.period,
    availableToday,
    netWorth,
    currentAverageDailyConsumption: rhythm.current.average,
    previousAverageDailyConsumption: rhythm.previous.average,
    averageDailyVariationPct: rhythm.averageDeltaPct,
    rhythm,
    currentCardSpend: card.current,
    previousCardSpend: card.previous,
    cardSpendVariationPct: card.deltaPct,
    daysRemainingInMonth,
    monthToDateAverageConsumption: mtdAvg,
    projectedRemainingConsumption,
    confirmedFutureIncome,
    knownFutureCommitments,
    projectedMonthEndAvailable,
    activeCategoryGoals,
    topCategoryGoal,
    cardExposures,
    cardDebtToday,
    cardFutureInstallments,
    cardDebtIsEstimated,
    committedNetWorth: round2(netWorth.net - cardFutureInstallments),
  };
}

function pickTopGoal(list: CategoryGoalEvaluation[]): CategoryGoalEvaluation | null {
  if (list.length === 0) return null;
  const rank = (s: CategoryGoalStatus): number => {
    switch (s) {
      case "exceeded": return 5;
      case "at_risk": return 4;
      case "limit_reached": return 3;
      case "attention": return 2;
      case "on_track": return 1;
      case "scheduled":
      case "completed_ok":
      case "completed_over":
      case "paused":
      case "cancelled":
      default: return 0;
    }
  };
  return [...list].sort((a, b) => {
    const dr = rank(b.status) - rank(a.status);
    if (dr !== 0) return dr;
    return b.percentageUsed - a.percentageUsed;
  })[0];
}
