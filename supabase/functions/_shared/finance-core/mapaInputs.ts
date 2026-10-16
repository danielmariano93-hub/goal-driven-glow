// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Insumos dos motores de saúde financeira do Mapa Financeiro. Puro: o servidor carrega, os motores só calculam.
import type { MapaMonthlyEntry } from "./mapaMonthly.ts";

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
}

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
    bridge: b ? {
      openingDebts: n(b.openingDebts), closingDebts: n(b.closingDebts), netWorthChange: n(b.netWorthChange),
      operationalResult: n(b.operationalResult), investmentReturn: n(b.investmentReturn),
      investmentApplications: n(b.investmentApplications), investmentRedemptions: n(b.investmentRedemptions),
      debtPrincipalChange: n(b.debtPrincipalChange), valuationAdjustments: n(b.valuationAdjustments),
      confidence: b.confidence === "high" || b.confidence === "medium" || b.confidence === "low" ? b.confidence : null,
    } : null,
  };
}
