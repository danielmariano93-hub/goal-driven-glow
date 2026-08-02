// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// PONTES FINANCEIRAS CANÔNICAS — `finance_contract.v4`
// ====================================================
// Este módulo é a ÚNICA fonte de verdade para as quatro perguntas do usuário:
//   1. Quanto eu tenho hoje?          → currentPosition (metrics.ts)
//   2. Como foi minha rotina?         → computePeriodPerformance
//   3. Como meu saldo se formou?      → computeCashBridge
//   4. Meu patrimônio melhorou?       → computeNetWorthBridge
//
// Regras invioláveis:
//  - Caixa usa a data BANCÁRIA (`cashDateOf`); resultado usa a data econômica.
//  - Movimentação patrimonial (aplicação, resgate, transferência, empréstimo,
//    amortização, pagamento de fatura) NUNCA entra em receita/gasto comportamental.
//  - Compra no cartão não reduz caixa; pagamento de fatura não cria consumo.
//  - Toda divergência aparece como `reconciliation_difference` + confiança menor.
//
// ESPELHADO para as Edge Functions por `scripts/sync-finance-core.mjs`.
import {
  cashDateOf,
  computeTotalCash,
  computeBehavioralExpense,
  computeCreditCardOutstanding,
  round2,
  txOrigin,
  type AccountRow,
  type AccountBalanceSnapshotRow,
  type TransactionRow,
  type InvestmentRow,
  type DebtRow,
} from "./facts.ts";

export const BRIDGE_FORMULA_VERSION = "cash_bridge.v1";
export const NET_WORTH_FORMULA_VERSION = "net_worth_bridge.v1";

export type BridgeConfidence = "high" | "medium" | "low";

export type ImpactSign = -1 | 0 | 1;

/** Linhas canônicas da ponte de caixa. */
export type CashBridgeLine =
  | "operational_income"
  | "operational_account_expense"
  | "investment_redemptions"
  | "investment_applications"
  | "investment_yield_cash"
  | "external_transfers_in"
  | "external_transfers_out"
  | "internal_transfers_net"
  | "loan_proceeds"
  | "debt_principal_payments"
  | "debt_interest_and_fees"
  | "card_payments"
  | "refunds_and_reimbursements"
  | "adjustments";

export interface MovementSemantics {
  /** Efeito no saldo em conta. */
  cashImpact: ImpactSign;
  /** Efeito no resultado da rotina (receita/gasto comportamental). */
  performanceImpact: ImpactSign;
  /** Efeito na carteira de investimentos. */
  investmentImpact: ImpactSign;
  /** Efeito no saldo devedor (dívidas + fatura). +1 aumenta a obrigação. */
  debtImpact: ImpactSign;
  /** Efeito no patrimônio líquido. */
  netWorthImpact: ImpactSign;
  /** Linha da ponte de caixa em que o valor é somado (em módulo). */
  bridgeLine: CashBridgeLine;
  /** Rótulo humano, sem jargão contábil. */
  label: string;
  /** Explicação curta para o detalhe do lançamento. */
  explanation: string;
}

const NEUTRAL: Pick<MovementSemantics, "performanceImpact"> = { performanceImpact: 0 };

/**
 * Mapa canônico `movement_kind` → semântica de impacto.
 * Nenhuma tela, relatório, insight, tool MCP ou prompt do Nino deve
 * reclassificar movimentos fora deste mapa.
 */
export const MOVEMENT_SEMANTICS: Record<string, MovementSemantics> = {
  income: {
    cashImpact: 1, performanceImpact: 1, investmentImpact: 0, debtImpact: 0, netWorthImpact: 1,
    bridgeLine: "operational_income",
    label: "Receita",
    explanation: "Dinheiro que entrou na conta e conta como receita da sua rotina.",
  },
  expense: {
    cashImpact: -1, performanceImpact: -1, investmentImpact: 0, debtImpact: 0, netWorthImpact: -1,
    bridgeLine: "operational_account_expense",
    label: "Gasto",
    explanation: "Dinheiro que saiu da conta e conta como gasto da sua rotina.",
  },
  card_expense: {
    cashImpact: 0, performanceImpact: -1, investmentImpact: 0, debtImpact: 1, netWorthImpact: -1,
    bridgeLine: "operational_account_expense",
    label: "Compra no cartão",
    explanation: "Conta como consumo agora e aumenta a fatura, mas só sai da conta quando você pagar a fatura.",
  },
  refund: {
    ...NEUTRAL,
    cashImpact: 1, performanceImpact: 1, investmentImpact: 0, debtImpact: 0, netWorthImpact: 1,
    bridgeLine: "refunds_and_reimbursements",
    label: "Estorno / reembolso",
    explanation: "Devolução de um valor: entra na conta e abate o gasto original.",
  },
  internal_transfer: {
    cashImpact: 0, performanceImpact: 0, investmentImpact: 0, debtImpact: 0, netWorthImpact: 0,
    bridgeLine: "internal_transfers_net",
    label: "Transferência entre suas contas",
    explanation: "Muda o dinheiro de lugar. Não é receita nem gasto, e não altera seu patrimônio.",
  },
  external_transfer_in: {
    cashImpact: 1, performanceImpact: 0, investmentImpact: 0, debtImpact: 0, netWorthImpact: 1,
    bridgeLine: "external_transfers_in",
    label: "Transferência recebida",
    explanation: "Entrou dinheiro de terceiro. Aumenta o saldo, mas não é receita da sua rotina.",
  },
  external_transfer_out: {
    cashImpact: -1, performanceImpact: 0, investmentImpact: 0, debtImpact: 0, netWorthImpact: -1,
    bridgeLine: "external_transfers_out",
    label: "Transferência enviada",
    explanation: "Saiu dinheiro para terceiro. Reduz o saldo, mas não é gasto da sua rotina.",
  },
  investment_application: {
    cashImpact: -1, performanceImpact: 0, investmentImpact: 1, debtImpact: 0, netWorthImpact: 0,
    bridgeLine: "investment_applications",
    label: "Aplicação",
    explanation: "Saiu da conta e entrou no investimento. Seu patrimônio não muda.",
  },
  investment_redemption: {
    cashImpact: 1, performanceImpact: 0, investmentImpact: -1, debtImpact: 0, netWorthImpact: 0,
    bridgeLine: "investment_redemptions",
    label: "Resgate",
    explanation: "Saiu do investimento e entrou na conta. Seu patrimônio não muda.",
  },
  investment_yield: {
    cashImpact: 0, performanceImpact: 0, investmentImpact: 1, debtImpact: 0, netWorthImpact: 1,
    bridgeLine: "investment_yield_cash",
    label: "Rendimento",
    explanation: "Ganho do investimento. Aumenta seu patrimônio sem ser receita da rotina.",
  },
  loan_proceeds: {
    cashImpact: 1, performanceImpact: 0, investmentImpact: 0, debtImpact: 1, netWorthImpact: 0,
    bridgeLine: "loan_proceeds",
    label: "Crédito de empréstimo",
    explanation: "Entrou dinheiro na conta, mas criou uma dívida do mesmo valor. Não é receita.",
  },
  debt_payment: {
    cashImpact: -1, performanceImpact: 0, investmentImpact: 0, debtImpact: -1, netWorthImpact: 0,
    bridgeLine: "debt_principal_payments",
    label: "Amortização de dívida",
    explanation: "Saiu da conta e reduziu sua dívida no mesmo valor. Não é gasto novo.",
  },
  card_payment: {
    cashImpact: -1, performanceImpact: 0, investmentImpact: 0, debtImpact: -1, netWorthImpact: 0,
    bridgeLine: "card_payments",
    label: "Pagamento de fatura",
    explanation: "Saiu da conta e reduziu a fatura. O consumo já foi contado na data da compra.",
  },
  fee: {
    cashImpact: -1, performanceImpact: -1, investmentImpact: 0, debtImpact: 0, netWorthImpact: -1,
    bridgeLine: "debt_interest_and_fees",
    label: "Tarifa",
    explanation: "Custo bancário: sai da conta e reduz seu patrimônio.",
  },
  interest: {
    cashImpact: -1, performanceImpact: -1, investmentImpact: 0, debtImpact: 0, netWorthImpact: -1,
    bridgeLine: "debt_interest_and_fees",
    label: "Juros",
    explanation: "Custo do crédito: sai da conta e reduz seu patrimônio.",
  },
  adjustment: {
    cashImpact: 1, performanceImpact: 0, investmentImpact: 0, debtImpact: 0, netWorthImpact: 1,
    bridgeLine: "adjustments",
    label: "Ajuste de conciliação",
    explanation: "Correção para o saldo do app bater com o extrato do banco.",
  },
};

/**
 * Resolve a semântica canônica de uma transação.
 * Precedência: pagamento de fatura (`settles_card_id`) → `movement_kind` → tipo.
 */
export function semanticsOf(
  t: Pick<TransactionRow, "type" | "movement_kind" | "settles_card_id" | "payment_method" | "credit_card_id">,
): MovementSemantics {
  if (t.settles_card_id) return MOVEMENT_SEMANTICS.card_payment;
  const mk = String(t.movement_kind ?? "").trim();
  if (mk && mk !== "transaction" && MOVEMENT_SEMANTICS[mk]) return MOVEMENT_SEMANTICS[mk];
  if (t.type === "transfer") return MOVEMENT_SEMANTICS.internal_transfer;
  if (t.type === "income") return MOVEMENT_SEMANTICS.income;
  if (txOrigin(t) === "credit_card") return MOVEMENT_SEMANTICS.card_expense;
  return MOVEMENT_SEMANTICS.expense;
}

export interface PeriodRange {
  start: string;
  end: string;
}

export interface CashBridgeInput {
  accounts: AccountRow[];
  txs: TransactionRow[];
  snapshots?: AccountBalanceSnapshotRow[];
  period: PeriodRange;
  /** Restringe a ponte a uma conta específica. */
  accountId?: string | null;
}

export interface CashBridgeLineValue {
  key: CashBridgeLine;
  label: string;
  /** Valor sempre positivo (em módulo). */
  amount: number;
  /** Direção no caixa: +1 entrou, -1 saiu, 0 neutro. */
  direction: ImpactSign;
  count: number;
}

export interface CashBridge {
  formulaVersion: string;
  period: PeriodRange;
  accountId: string | null;
  openingCash: number;
  operationalIncome: number;
  operationalAccountExpense: number;
  investmentRedemptions: number;
  investmentApplications: number;
  externalTransfersIn: number;
  externalTransfersOut: number;
  internalTransfersNet: number;
  loanProceeds: number;
  debtPrincipalPayments: number;
  debtInterestAndFees: number;
  cardPayments: number;
  refundsAndReimbursements: number;
  adjustments: number;
  calculatedClosingCash: number;
  confirmedClosingCash: number;
  reconciliationDifference: number;
  confidence: BridgeConfidence;
  lines: CashBridgeLineValue[];
  evidence: {
    transactionCount: number;
    inferredCashDateCount: number;
    snapshotAnchorsInPeriod: number;
    lastConfirmedSnapshot: string | null;
  };
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

const LINE_LABELS: Record<CashBridgeLine, string> = {
  operational_income: "Receitas recebidas",
  operational_account_expense: "Gastos pagos pela conta",
  investment_redemptions: "Resgates de investimentos",
  investment_applications: "Aplicações em investimentos",
  investment_yield_cash: "Rendimentos creditados",
  external_transfers_in: "Transferências recebidas",
  external_transfers_out: "Transferências enviadas",
  internal_transfers_net: "Transferências entre suas contas",
  loan_proceeds: "Empréstimos creditados",
  debt_principal_payments: "Pagamentos de dívidas",
  debt_interest_and_fees: "Juros e tarifas",
  card_payments: "Pagamentos de fatura",
  refunds_and_reimbursements: "Estornos e reembolsos",
  adjustments: "Ajustes e conciliações",
};

/**
 * PONTE DE CAIXA — a equação FECHA por construção:
 * saldo inicial + Σ(linhas com sinal) + ajustes = saldo final confirmado.
 * Quando o motor de saldo e a soma das linhas divergem (snapshot no meio do
 * período, dado incompleto), a diferença vira `adjustments` e a confiança cai.
 */
export function computeCashBridge(input: CashBridgeInput): CashBridge {
  const { period } = input;
  const scope = input.accountId ?? null;
  const accounts = scope ? input.accounts.filter((a) => a.id === scope) : input.accounts;
  const snapshots = (input.snapshots ?? []).filter((s) => !scope || s.account_id === scope);

  const openingCash = computeTotalCash(accounts, input.txs, snapshots, { asOf: dayBefore(period.start) });
  const confirmedClosingCash = computeTotalCash(accounts, input.txs, snapshots, { asOf: period.end });

  const buckets = new Map<CashBridgeLine, { amount: number; count: number; direction: ImpactSign }>();
  const bump = (line: CashBridgeLine, amount: number, direction: ImpactSign) => {
    const cur = buckets.get(line) ?? { amount: 0, count: 0, direction };
    cur.amount += Math.abs(amount);
    cur.count += 1;
    cur.direction = direction;
    buckets.set(line, cur);
  };

  let transactionCount = 0;
  let inferredCashDateCount = 0;
  let internalNet = 0;

  const transferGroups = new Map<string, TransactionRow[]>();

  for (const t of input.txs) {
    if (t.status !== "confirmed") continue;
    if (txOrigin(t) !== "account") continue; // compras no cartão não tocam o caixa
    const d = cashDateOf(t);
    if (d < period.start || d > period.end) continue;
    if (scope && t.account_id !== scope && t.type !== "transfer") continue;

    if (t.type === "transfer" && t.transfer_group_id) {
      const arr = transferGroups.get(t.transfer_group_id) ?? [];
      arr.push(t);
      transferGroups.set(t.transfer_group_id, arr);
      continue;
    }

    const sem = semanticsOf(t);
    if (sem.cashImpact === 0) continue;
    transactionCount += 1;
    if (!t.posted_at || t.posted_at_source === "inferred") inferredCashDateCount += 1;
    bump(sem.bridgeLine, Number(t.amount || 0), sem.cashImpact);
  }

  // Transferências internas: consolidadas se cancelam; com escopo de conta, movem caixa.
  for (const legs of transferGroups.values()) {
    if (legs.length < 2) continue;
    const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
    const [src, dst] = sorted;
    const amt = Number(src.amount || 0);
    if (!scope) continue; // net zero no consolidado
    if (src.account_id === scope) internalNet -= amt;
    if (dst.account_id === scope) internalNet += amt;
  }
  if (internalNet !== 0) {
    bump("internal_transfers_net", internalNet, internalNet > 0 ? 1 : -1);
  }

  const get = (line: CashBridgeLine) => round2(buckets.get(line)?.amount ?? 0);

  const operationalIncome = get("operational_income");
  const operationalAccountExpense = get("operational_account_expense");
  const investmentRedemptions = get("investment_redemptions");
  const investmentApplications = get("investment_applications");
  const investmentYieldCash = get("investment_yield_cash");
  const externalTransfersIn = get("external_transfers_in");
  const externalTransfersOut = get("external_transfers_out");
  const loanProceeds = get("loan_proceeds");
  const debtPrincipalPayments = get("debt_principal_payments");
  const debtInterestAndFees = get("debt_interest_and_fees");
  const cardPayments = get("card_payments");
  const refundsAndReimbursements = get("refunds_and_reimbursements");
  const internalTransfersNet = round2(internalNet);

  const movementsSum = round2(
    operationalIncome
    - operationalAccountExpense
    + investmentRedemptions
    - investmentApplications
    + investmentYieldCash
    + externalTransfersIn
    - externalTransfersOut
    + internalTransfersNet
    + loanProceeds
    - debtPrincipalPayments
    - debtInterestAndFees
    - cardPayments
    + refundsAndReimbursements,
  );

  const adjustments = round2(confirmedClosingCash - openingCash - movementsSum);
  const calculatedClosingCash = round2(openingCash + movementsSum + adjustments);
  const reconciliationDifference = round2(confirmedClosingCash - calculatedClosingCash);

  const anchors = snapshots
    .filter((s) => !s.status || s.status === "confirmed")
    .filter((s) => s.balance_date >= period.start && s.balance_date <= period.end);
  const lastConfirmed = [...snapshots]
    .filter((s) => !s.status || s.status === "confirmed")
    .sort((a, b) => a.balance_date.localeCompare(b.balance_date))
    .pop();

  // Confiança = qualidade da RECONCILIAÇÃO. A ausência de `posted_at` fica
  // registrada em `evidence` (inferredCashDateCount) mas só derruba a confiança
  // quando também há divergência de saldo — caso contrário a equação já fechou.
  let confidence: BridgeConfidence = "high";
  const tolerance = Math.max(50, Math.abs(confirmedClosingCash) * 0.05);
  if (Math.abs(adjustments) > 0.01) confidence = "medium";
  if (Math.abs(adjustments) > tolerance) confidence = "low";

  const lines: CashBridgeLineValue[] = ([
    ["operational_income", operationalIncome, 1],
    ["operational_account_expense", operationalAccountExpense, -1],
    ["refunds_and_reimbursements", refundsAndReimbursements, 1],
    ["investment_redemptions", investmentRedemptions, 1],
    ["investment_applications", investmentApplications, -1],
    ["investment_yield_cash", investmentYieldCash, 1],
    ["external_transfers_in", externalTransfersIn, 1],
    ["external_transfers_out", externalTransfersOut, -1],
    ["internal_transfers_net", Math.abs(internalTransfersNet), internalTransfersNet >= 0 ? 1 : -1],
    ["loan_proceeds", loanProceeds, 1],
    ["card_payments", cardPayments, -1],
    ["debt_principal_payments", debtPrincipalPayments, -1],
    ["debt_interest_and_fees", debtInterestAndFees, -1],
    ["adjustments", Math.abs(adjustments), adjustments >= 0 ? 1 : -1],
  ] as Array<[CashBridgeLine, number, ImpactSign]>)
    .filter(([, amount]) => Math.abs(amount) > 0.005)
    .map(([key, amount, direction]) => ({
      key,
      label: LINE_LABELS[key],
      amount: round2(amount),
      direction,
      count: buckets.get(key)?.count ?? 0,
    }));

  return {
    formulaVersion: BRIDGE_FORMULA_VERSION,
    period,
    accountId: scope,
    openingCash,
    operationalIncome,
    operationalAccountExpense,
    investmentRedemptions,
    investmentApplications,
    externalTransfersIn,
    externalTransfersOut,
    internalTransfersNet,
    loanProceeds,
    debtPrincipalPayments,
    debtInterestAndFees,
    cardPayments,
    refundsAndReimbursements,
    adjustments,
    calculatedClosingCash,
    confirmedClosingCash,
    reconciliationDifference,
    confidence,
    lines,
    evidence: {
      transactionCount,
      inferredCashDateCount,
      snapshotAnchorsInPeriod: anchors.length,
      lastConfirmedSnapshot: lastConfirmed?.balance_date ?? null,
    },
  };
}

export interface PeriodPerformance {
  period: PeriodRange;
  /** Receitas reais da rotina (sem resgate, empréstimo ou transferência). */
  operationalIncome: number;
  /** Gastos reais da rotina, já líquidos de estorno (conta + cartão). */
  operationalExpense: number;
  /** Receitas − gastos. Negativo = gastou além do que recebeu. */
  operationalResult: number;
  /** |resultado| quando negativo — usado na copy "gastos acima das receitas". */
  operationalGap: number;
  /** Taxa de sobra (0..1) ou null quando não houve receita. */
  savingsRate: number | null;
  refunds: number;
}

/**
 * RESULTADO DA ROTINA — usa a MESMA regra comportamental do restante do app
 * (`computeBehavioralExpense`), garantindo paridade em centavos com Home,
 * relatórios e insights. Movimentação patrimonial fica fora por construção.
 */
export function computePeriodPerformance(
  txs: TransactionRow[],
  period: PeriodRange,
): PeriodPerformance {
  let income = 0;
  let refunds = 0;
  for (const t of txs) {
    if (t.status !== "confirmed") continue;
    if (t.occurred_at < period.start || t.occurred_at > period.end) continue;
    const sem = semanticsOf(t);
    if (sem.performanceImpact !== 1) continue;
    if (sem.bridgeLine === "refunds_and_reimbursements") {
      refunds += Number(t.amount || 0);
      continue;
    }
    income += Number(t.amount || 0);
  }
  const operationalIncome = round2(income);
  const operationalExpense = round2(computeBehavioralExpense(txs, period));
  const operationalResult = round2(operationalIncome - operationalExpense);
  return {
    period,
    operationalIncome,
    operationalExpense,
    operationalResult,
    operationalGap: operationalResult < 0 ? round2(-operationalResult) : 0,
    savingsRate: operationalIncome > 0 ? round2(operationalResult / operationalIncome) : null,
    refunds: round2(refunds),
  };
}

export interface NetWorthBridgeInput extends CashBridgeInput {
  investments: InvestmentRow[];
  debts: DebtRow[];
  /** Movimentos de investimento do período (aplicação/resgate/rendimento). */
  investmentMovements?: Array<{ type: string; amount: number; occurred_at: string }>;
}

export interface NetWorthBridge {
  formulaVersion: string;
  period: PeriodRange;
  openingCash: number;
  openingInvestments: number;
  openingDebts: number;
  openingNetWorth: number;
  operationalResult: number;
  investmentReturn: number;
  investmentApplications: number;
  investmentRedemptions: number;
  debtPrincipalChange: number;
  interestAndFees: number;
  valuationAdjustments: number;
  closingCash: number;
  closingInvestments: number;
  closingDebts: number;
  closingNetWorth: number;
  netWorthChange: number;
  confidence: BridgeConfidence;
}

/**
 * PONTE PATRIMONIAL — reconstrói a posição inicial a partir da posição atual
 * e dos movimentos do período (não temos snapshot histórico de investimentos).
 * O resíduo entre a variação explicada e a real vira `valuationAdjustments`.
 */
export function computeNetWorthBridge(input: NetWorthBridgeInput): NetWorthBridge {
  const cash = computeCashBridge(input);
  const perf = computePeriodPerformance(input.txs, input.period);

  const closingInvestments = round2(
    input.investments.reduce((a, i) => a + Number(i.current_value || 0), 0),
  );
  const cardsOwed = computeCreditCardOutstanding(input.txs);
  const otherDebts = round2(
    input.debts.filter((d) => d.status === "active").reduce((a, d) => a + Number(d.outstanding_balance || 0), 0),
  );
  const closingDebts = round2(cardsOwed + otherDebts);

  const movements = input.investmentMovements ?? [];
  const inPeriod = movements.filter((m) => m.occurred_at >= input.period.start && m.occurred_at <= input.period.end);
  const sumKind = (kinds: string[]) =>
    round2(inPeriod.filter((m) => kinds.includes(m.type)).reduce((a, m) => a + Number(m.amount || 0), 0));

  const applications = round2(Math.max(cash.investmentApplications, sumKind(["application", "buy", "deposit"])));
  const redemptions = round2(Math.max(cash.investmentRedemptions, sumKind(["redemption", "sell", "withdraw"])));
  const investmentReturn = sumKind(["yield", "interest", "dividend", "valuation"]);

  const openingInvestments = round2(closingInvestments - applications + redemptions - investmentReturn);
  // Dívida inicial = dívida final + amortizações − novos créditos.
  const openingDebts = round2(closingDebts + cash.debtPrincipalPayments + cash.cardPayments - cash.loanProceeds);
  const debtPrincipalChange = round2(closingDebts - openingDebts);

  const openingNetWorth = round2(cash.openingCash + openingInvestments - openingDebts);
  const closingNetWorth = round2(cash.confirmedClosingCash + closingInvestments - closingDebts);
  const netWorthChange = round2(closingNetWorth - openingNetWorth);

  const explained = round2(
    perf.operationalResult
    + investmentReturn
    - cash.debtInterestAndFees
    - debtPrincipalChange
    + cash.externalTransfersIn
    - cash.externalTransfersOut,
  );
  const valuationAdjustments = round2(netWorthChange - explained);

  let confidence: BridgeConfidence = cash.confidence;
  if (movements.length === 0 && Math.abs(valuationAdjustments) > 0.01) {
    confidence = confidence === "high" ? "medium" : confidence;
  }
  if (Math.abs(valuationAdjustments) > Math.max(100, Math.abs(closingNetWorth) * 0.05)) confidence = "low";

  return {
    formulaVersion: NET_WORTH_FORMULA_VERSION,
    period: input.period,
    openingCash: cash.openingCash,
    openingInvestments,
    openingDebts,
    openingNetWorth,
    operationalResult: perf.operationalResult,
    investmentReturn,
    investmentApplications: applications,
    investmentRedemptions: redemptions,
    debtPrincipalChange,
    interestAndFees: cash.debtInterestAndFees,
    valuationAdjustments,
    closingCash: cash.confirmedClosingCash,
    closingInvestments,
    closingDebts,
    closingNetWorth,
    netWorthChange,
    confidence,
  };
}

const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

export interface BalanceExplanation {
  headline: string;
  body: string;
  tone: "positive" | "neutral" | "attention";
  /** Frases usadas na UI expandida, uma por linha da ponte. */
  steps: string[];
  confidence: BridgeConfidence;
}

/**
 * Explicação DETERMINÍSTICA (sem LLM) de como o saldo se formou.
 * Nunca expõe um número negativo isolado como "resultado".
 */
export function explainBalanceChange(
  bridge: CashBridge,
  performance?: PeriodPerformance,
): BalanceExplanation {
  const steps: string[] = [];
  steps.push(`Você começou o período com ${money(bridge.openingCash)} em conta.`);
  if (bridge.operationalIncome > 0) steps.push(`Recebeu ${money(bridge.operationalIncome)} de receitas.`);
  if (bridge.operationalAccountExpense > 0) steps.push(`Pagou ${money(bridge.operationalAccountExpense)} de gastos pela conta.`);
  if (bridge.refundsAndReimbursements > 0) steps.push(`Recebeu ${money(bridge.refundsAndReimbursements)} em estornos e reembolsos.`);
  if (bridge.investmentRedemptions > 0) steps.push(`Resgatou ${money(bridge.investmentRedemptions)} dos investimentos.`);
  if (bridge.investmentApplications > 0) steps.push(`Aplicou ${money(bridge.investmentApplications)} em investimentos.`);
  if (bridge.externalTransfersIn > 0) steps.push(`Recebeu ${money(bridge.externalTransfersIn)} em transferências.`);
  if (bridge.externalTransfersOut > 0) steps.push(`Enviou ${money(bridge.externalTransfersOut)} em transferências.`);
  if (bridge.loanProceeds > 0) steps.push(`Recebeu ${money(bridge.loanProceeds)} de crédito — isso é dívida, não receita.`);
  if (bridge.cardPayments > 0) steps.push(`Pagou ${money(bridge.cardPayments)} de fatura do cartão (consumo já contado antes).`);
  if (bridge.debtPrincipalPayments > 0) steps.push(`Amortizou ${money(bridge.debtPrincipalPayments)} de dívidas.`);
  if (bridge.debtInterestAndFees > 0) steps.push(`Pagou ${money(bridge.debtInterestAndFees)} de juros e tarifas.`);
  if (Math.abs(bridge.adjustments) > 0.01) {
    steps.push(
      bridge.adjustments > 0
        ? `Somamos ${money(bridge.adjustments)} de ajuste para bater com o extrato do banco.`
        : `Descontamos ${money(Math.abs(bridge.adjustments))} de ajuste para bater com o extrato do banco.`,
    );
  }
  steps.push(`Por isso terminou com ${money(bridge.confirmedClosingCash)} em conta.`);

  const gap = performance?.operationalGap ?? 0;
  const delta = round2(bridge.confirmedClosingCash - bridge.openingCash);
  let headline: string;
  let tone: BalanceExplanation["tone"];
  if (gap > 0) {
    headline = `Gastos acima das receitas: ${money(gap)}`;
    tone = "attention";
  } else if (delta >= 0) {
    headline = `Seu saldo em conta cresceu ${money(delta)}`;
    tone = "positive";
  } else {
    headline = `Você usou ${money(Math.abs(delta))} de recursos acumulados`;
    tone = "neutral";
  }

  const body = [
    steps.join(" "),
    gap > 0 && bridge.confirmedClosingCash > 0
      ? "Sua conta continua positiva porque havia saldo anterior e/ou movimentações patrimoniais."
      : null,
  ].filter(Boolean).join(" ");

  return { headline, body, tone, steps, confidence: bridge.confidence };
}
