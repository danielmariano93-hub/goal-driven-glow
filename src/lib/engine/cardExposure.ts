/**
 * FONTE CANÔNICA — Exposição financeira de cartão de crédito.
 * =========================================================
 * Versão da fórmula: `card_exposure.v1`.
 *
 * Cinco números distintos, nunca intercambiáveis:
 *  1. `cardSpendInPeriod`            — compras no período (data econômica). Histórico, NÃO é dívida.
 *  2. `currentStatement`            — obrigação da fatura da competência atual.
 *  3. `nextStatement`               — fatura da próxima competência.
 *  4. `futureInstallments`          — parcelas de competências futuras ainda não faturadas.
 *  5. `totalCardDebt`               — dívida de cartão hoje (faturas abertas/atrasadas/parciais).
 *
 * PRECEDÊNCIA OBRIGATÓRIA:
 *  a) existindo `credit_card_statements` para a competência, ele é a verdade (`official`);
 *  b) sem statement, reconstrói-se por `transactions.competence_date` e o valor é
 *     marcado como `estimated` — a UI PRECISA rotular como estimativa;
 *  c) `credit_card_installments` só vale para competências posteriores à última
 *     fatura fechada/paga e sem statement próprio;
 *  d) fatura `paid`/`settled` resulta em obrigação 0 em TODAS as superfícies.
 */
import { round2 } from "./facts";

export const CARD_EXPOSURE_FORMULA_VERSION = "card_exposure.v1";

export type ExposureSource = "official" | "estimated" | "none";

export interface CardStatementRow {
  credit_card_id: string;
  competence_month: string;
  stated_total?: number | null;
  paid_amount?: number | null;
  outstanding_amount?: number | null;
  reconciliation_difference?: number | null;
  status?: string | null;
}

export interface CardInstallmentRow {
  credit_card_id: string;
  competence_month: string;
  amount: number;
  status?: string | null;
  /** parcela já absorvida por uma fatura fechada/paga (E6) — nunca é compromisso futuro */
  absorbed_by_statement_id?: string | null;
}

export interface CardTxRow {
  credit_card_id?: string | null;
  competence_date?: string | null;
  occurred_at?: string | null;
  amount: number;
  type?: string | null;
  status?: string | null;
  settles_card_id?: string | null;
}

export interface StatementFigure {
  amount: number;
  source: ExposureSource;
  status: string | null;
  /** total original da fatura, quando oficial */
  statedTotal: number;
  paidAmount: number;
}

export interface CardExposure {
  cardId: string;
  currentStatement: StatementFigure;
  nextStatement: StatementFigure;
  futureInstallments: number;
  /** dívida de cartão hoje — apenas faturas não liquidadas */
  totalCardDebt: number;
  needsReview: boolean;
  formulaVersion: string;
}

const SETTLED_STATUSES = new Set(["paid", "settled", "closed_paid"]);
const CLOSED_STATUSES = new Set(["paid", "settled", "closed", "closed_paid", "approved"]);
const DEAD_INSTALLMENTS = new Set(["paid", "refunded", "cancelled", "reversed", "anticipated"]);

const emptyFigure = (): StatementFigure => ({ amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 });

export function nextCompetence(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function ymOf(value?: string | null): string | null {
  const v = String(value ?? "");
  return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
}

function estimateFromTxs(txs: CardTxRow[], cardId: string, ym: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.credit_card_id !== cardId) continue;
    if (t.settles_card_id) continue;
    if (t.status && t.status !== "confirmed") continue;
    if (ymOf(t.competence_date) !== ym) continue;
    const amt = Number(t.amount || 0);
    total += t.type === "income" ? -amt : amt;
  }
  return round2(Math.max(0, total));
}

function figureFromStatement(statement: CardStatementRow): StatementFigure {
  const status = (statement.status ?? "").toString() || null;
  const stated = round2(Number(statement.stated_total ?? 0));
  const paid = round2(Number(statement.paid_amount ?? 0));
  const outstanding = statement.outstanding_amount == null
    ? round2(Math.max(0, stated - paid))
    : round2(Number(statement.outstanding_amount));
  return {
    amount: SETTLED_STATUSES.has(status ?? "") ? 0 : outstanding,
    source: "official",
    status,
    statedTotal: stated,
    paidAmount: paid,
  };
}

export function computeCardExposure(input: {
  cardIds: string[];
  statements: CardStatementRow[];
  installments: CardInstallmentRow[];
  txs: CardTxRow[];
  /** competência corrente no formato YYYY-MM */
  currentYM: string;
}): Record<string, CardExposure> {
  const { cardIds, statements, installments, txs, currentYM } = input;
  const nextYM = nextCompetence(currentYM);
  const result: Record<string, CardExposure> = {};

  const ids = new Set<string>(cardIds);
  for (const s of statements) ids.add(s.credit_card_id);
  for (const i of installments) ids.add(i.credit_card_id);

  for (const cardId of ids) {
    const cardStatements = statements.filter((s) => s.credit_card_id === cardId);
    const byYM = new Map<string, CardStatementRow>();
    for (const s of cardStatements) {
      const ym = ymOf(s.competence_month);
      if (ym) byYM.set(ym, s);
    }

    const currentRow = byYM.get(currentYM);
    const current = currentRow
      ? figureFromStatement(currentRow)
      : { ...emptyFigure(), amount: estimateFromTxs(txs, cardId, currentYM), source: "estimated" as ExposureSource };

    const nextRow = byYM.get(nextYM);
    const next = nextRow
      ? figureFromStatement(nextRow)
      : { ...emptyFigure(), amount: estimateFromTxs(txs, cardId, nextYM), source: "estimated" as ExposureSource };

    // Última competência já fechada/paga: nada até ela pode contar como futuro.
    let lastClosedYM = "";
    for (const [ym, s] of byYM) {
      if (CLOSED_STATUSES.has((s.status ?? "").toString()) && ym > lastClosedYM) lastClosedYM = ym;
    }

    let futureInstallments = 0;
    for (const inst of installments) {
      if (inst.credit_card_id !== cardId) continue;
      if (DEAD_INSTALLMENTS.has((inst.status ?? "").toString())) continue;
      if (inst.absorbed_by_statement_id) continue;
      const ym = ymOf(inst.competence_month);
      if (!ym) continue;
      if (lastClosedYM && ym <= lastClosedYM) continue; // já absorvida por fatura fechada/paga
      if (ym <= currentYM) continue; // faz parte da fatura atual, não é "futuro"
      const covering = byYM.get(ym);
      if (covering && SETTLED_STATUSES.has((covering.status ?? "").toString())) continue;
      futureInstallments += Number(inst.amount || 0);
    }

    const openStatementsDebt = cardStatements.reduce((sum, s) => {
      const status = (s.status ?? "").toString();
      if (SETTLED_STATUSES.has(status)) return sum;
      const fig = figureFromStatement(s);
      return sum + fig.amount;
    }, 0);

    const totalCardDebt = currentRow || cardStatements.length > 0
      ? round2(openStatementsDebt)
      : round2(current.amount);

    result[cardId] = {
      cardId,
      currentStatement: current,
      nextStatement: next,
      futureInstallments: round2(futureInstallments),
      totalCardDebt,
      needsReview: Boolean(
        currentRow &&
        ((currentRow.status ?? "") === "needs_review" || round2(Number(currentRow.reconciliation_difference ?? 0)) !== 0),
      ),
      formulaVersion: CARD_EXPOSURE_FORMULA_VERSION,
    };
  }

  return result;
}

/** Dívida total de cartão somando todos os cartões (faturas não liquidadas). */
export function totalCardDebtOf(exposures: Record<string, CardExposure>): number {
  return round2(Object.values(exposures).reduce((sum, e) => sum + e.totalCardDebt, 0));
}

/** Compromisso futuro de parcelas somando todos os cartões (NÃO é dívida atual). */
export function totalFutureInstallmentsOf(exposures: Record<string, CardExposure>): number {
  return round2(Object.values(exposures).reduce((sum, e) => sum + e.futureInstallments, 0));
}
