// Insumos dos motores de saúde financeira do Mapa Financeiro. Puro: o servidor carrega, os motores só calculam.
import type { MapaMonthlyEntry } from "./mapaMonthly";

export type BridgeConfidenceIn = "high" | "medium" | "low";

export interface MapaNetWorthBridgeIn {
  openingDebts: number | null;
  closingDebts: number | null;
  netWorthChange: number | null;
  operationalResult: number | null;
  investmentReturn: number | null;
  investmentApplications: number | null;
  investmentRedemptions: number | null;
  debtPrincipalChange: number | null;
  valuationAdjustments: number | null;
  confidence: BridgeConfidenceIn | null;
}

export interface MapaSnapshotInput {
  availableToday: number | null;
  confirmedFutureInflows: number | null;
  estimatedFixedInflows: number | null;
  knownFutureCommitments: number | null;
  cardDueThisMonth: number | null;
  netWorthNet: number | null;
  /** Total em investimentos hoje. */
  investedNow?: number | null;
  /** Composição do patrimônio líquido (para explicar o número). */
  cashAsset?: number | null;
  owedTotal?: number | null;
  cardsOwed?: number | null;
  otherDebts?: number | null;
  bridge: MapaNetWorthBridgeIn | null;
}

export type DebtKind = "cartao_rotativo" | "emprestimo_pessoal" | "financiamento" | "cheque_especial" | "informal" | "outro";

export interface MapaDebtIn {
  id: string;
  name: string;
  status: string;
  kind: DebtKind | null;
  outstanding_balance: number;
  installment_amount: number | null;
  interest_rate_pct: number | null;
  /** Período da taxa informada. null = não informado (taxa antiga, ambígua). */
  interest_rate_period: "mes" | "ano" | null;
}

export interface MapaDebtOverdueIn {
  count: number;
  amount: number;
  max_days: number | null;
}

export type InvestmentLiquidity = "d0" | "d1" | "d30" | "longo" | "desconhecida";

export interface MapaInvestmentIn {
  id: string;
  name: string;
  current_value: number;
  liquidity: InvestmentLiquidity | null;
  /** Papel marcado pelo usuário (ex.: reserva de emergência). */
  reserve_role: string | null;
}

export interface MapaSavingsGoalIn {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  created_at: string;
  target_date: string | null;
}

export interface MapaDatedAmount {
  date: string;
  amount: number;
}

export interface MapaHealthInputs {
  snapshot: MapaSnapshotInput | null;
  /** category_id → essencial (true), não essencial (false). Ausente = não confirmado. */
  categoryEssential: Record<string, boolean>;
  debts: MapaDebtIn[];
  debtOverdue: MapaDebtOverdueIn | null;
  investments: MapaInvestmentIn[];
  savingsGoals: MapaSavingsGoalIn[];
  redemptions90: MapaDatedAmount[];
  debtPayments90: MapaDatedAmount[];
  /** Principal de dívida pago nos últimos 90 dias (tabela debt_payments; fatura de cartão NÃO entra). null = sem registro. */
  debtPrincipalPaid90?: number | null;
  /** Entradas que NÃO contam como renda (resgate, empréstimo, Pix/depósito de fora), para explicar o resultado. */
  excludedInflows?: MapaExcludedInflow[];
}

export interface MapaExcludedInflow { date: string; amount: number; kind: "emprestimo" | "resgate" | "outras" }

export const EMPTY_HEALTH_INPUTS: MapaHealthInputs = {
  snapshot: null, categoryEssential: {}, debts: [], debtOverdue: null, investments: [], savingsGoals: [], redemptions90: [], debtPayments90: [],
};

export type MapaEntryWithCategory = MapaMonthlyEntry;

const n = (v: unknown): number | null => {
  const x = typeof v === "string" && v.trim() === "" ? Number.NaN : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Converte o payload do snapshot financeiro (`financial_current_snapshots.payload`) no insumo do Mapa. */
export function snapshotInputFromPayload(payload: any): MapaSnapshotInput | null {
  const s = payload?.snapshot;
  if (!s || typeof s !== "object") return null;
  const proj = s.projection ?? {};
  const b = s.netWorthBridge ?? null;
  return {
    availableToday: n(s.availableToday),
    confirmedFutureInflows: n(proj.confirmedFutureInflows ?? s.confirmedFutureIncome),
    estimatedFixedInflows: n(proj.estimatedFixedInflows),
    knownFutureCommitments: n(proj.upcomingConfirmedCommitments ?? s.knownFutureCommitments),
    cardDueThisMonth: n(proj.cardDueThisMonth),
    netWorthNet: n(s.netWorth?.net),
    investedNow: n(s.netWorth?.invested),
    cashAsset: n(s.netWorth?.cashAsset),
    owedTotal: n(s.netWorth?.owed),
    cardsOwed: n(s.netWorth?.cardsOwed),
    otherDebts: n(s.netWorth?.otherDebts),
    bridge: b ? {
      openingDebts: n(b.openingDebts), closingDebts: n(b.closingDebts), netWorthChange: n(b.netWorthChange),
      operationalResult: n(b.operationalResult), investmentReturn: n(b.investmentReturn),
      investmentApplications: n(b.investmentApplications), investmentRedemptions: n(b.investmentRedemptions),
      debtPrincipalChange: n(b.debtPrincipalChange), valuationAdjustments: n(b.valuationAdjustments),
      confidence: b.confidence === "high" || b.confidence === "medium" || b.confidence === "low" ? b.confidence : null,
    } : null,
  };
}

// ---- Hábitos (fase 3) --------------------------------------------------------------------------------------------------
export interface MapaCommitmentPeriod {
  /** Compromisso (meta da categoria) ou semana (sexta-feira do combinado). */
  key: string;
  /** Mês (YYYY-MM) para metas; sexta-feira (YYYY-MM-DD) para fim de semana. */
  period: string;
  status: "cumprido" | "estourado";
}

export interface MapaMonthlyEstimate {
  /** Mês avaliado (YYYY-MM). */
  month: string;
  estimate: number;
  top_category_id?: string | null;
  answered_at: string;
}

/** Linhas de `map_questions` (E13). */
export interface MapaQuestionRow {
  kind: string;
  due_at: string;
  answered_at: string | null;
  skipped_at: string | null;
  created_at: string;
}

export interface MapaHabitInputs {
  goalPeriods: MapaCommitmentPeriod[];
  weekendPeriods: MapaCommitmentPeriod[];
  /** Recorrências detectadas no histórico (inclui as já cadastradas) e quantas já estão cadastradas. */
  recurringDetected: number;
  recurringRegistered: number;
  /** Equivalente mensal das regras recorrentes de despesa ativas em categorias não essenciais (ou sem categoria). */
  recurringNonEssentialMonthly: number | null;
  /** Respostas "já planejo" ÷ respondidas nos últimos 90 dias. */
  plannedAnswers: number;
  totalAnswers: number;
  /** Insights marcados como úteis × não úteis nos últimos 90 dias. */
  usefulEvents: number;
  notUsefulEvents: number;
  estimates: MapaMonthlyEstimate[];
  questions: MapaQuestionRow[];
  /** Data (YYYY-MM-DD) da última resposta do CFPB; null se nunca respondeu. */
  lastCfpbAt: string | null;
}

export const EMPTY_HABIT_INPUTS: MapaHabitInputs = {
  goalPeriods: [], weekendPeriods: [], recurringDetected: 0, recurringRegistered: 0, recurringNonEssentialMonthly: null,
  plannedAnswers: 0, totalAnswers: 0, usefulEvents: 0, notUsefulEvents: 0, estimates: [], questions: [], lastCfpbAt: null,
};
