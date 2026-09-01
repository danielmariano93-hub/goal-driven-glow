// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
/**
 * FONTE CANÔNICA — Exposição financeira de cartão de crédito.
 * =========================================================
 * Versão da fórmula: `card_exposure.v2`.
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
import { round2 } from "./facts.ts";

export const CARD_EXPOSURE_FORMULA_VERSION = "card_exposure.v3";
/** Ciclo real por fechamento/vencimento (Onda 2). */
export const CARD_CYCLE_VERSION = "card_cycle.v3";

/**
 * Confiança do número exibido:
 *  - `official`    fatura registrada (documento) manda em qualquer superfície;
 *  - `estimated`   reconstruído por transações do ciclo + parcelas da competência;
 *  - `partial`     fatura oficial existe mas está inconsistente (needs_review / diferença);
 *  - `unavailable` não há nenhuma fonte para a competência (nunca exibir como zero real);
 *  - `none`        compatibilidade com consumidores anteriores (equivale a `unavailable`).
 */
export type ExposureSource = "official" | "estimated" | "partial" | "unavailable" | "none";

// ── Ciclo do cartão ───────────────────────────────────────────────────────────
export interface CardCycleConfig {
  id?: string;
  /** nome exibido nos compromissos da agenda canônica */
  name?: string | null;
  closing_day?: number | null;
  due_day?: number | null;
}

export interface CardCycle {
  /** competência da fatura no formato YYYY-MM (mês do FECHAMENTO do ciclo) */
  competence: string;
  /** primeiro dia do período de compras (fechamento anterior + 1) */
  period_start: string;
  /** último dia do período de compras (data de fechamento) */
  period_end: string;
  closing_date: string;
  due_date: string;
  /** true quando o ciclo não pôde usar closing_day/due_day (fallback calendário) */
  fallback: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const iso = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;

function addMonths(y: number, m1: number, delta: number): [number, number] {
  const zero = y * 12 + (m1 - 1) + delta;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}

function dayInMonth(y: number, m1: number, day: number): string {
  return iso(y, m1, Math.min(Math.max(1, day), lastDayOf(y, m1)));
}

function addDaysISO(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Ciclo ao qual uma data pertence.
 *
 * `card_cycle.v3` — a competência da fatura é o MÊS DO FECHAMENTO do ciclo.
 * O vencimento é atributo operacional e NÃO define competência: ciclo que fecha
 * em 25/08 e vence em 01/09 continua sendo a fatura de agosto (`2026-08`).
 *
 * Sem `closing_day` válido, cai no fallback de calendário (mês da própria data).
 */
export function cycleFor(card: CardCycleConfig | null | undefined, dateISO: string): CardCycle {
  const [y0, m0, d0] = String(dateISO).slice(0, 10).split("-").map(Number);
  const closingDay = Number(card?.closing_day ?? 0);
  const dueDayRaw = Number(card?.due_day ?? 0);
  const fallback = !(closingDay >= 1 && closingDay <= 31);

  if (!y0 || !m0 || !d0) {
    const now = new Date();
    return cycleFor(card, iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()));
  }

  if (fallback) {
    const end = dayInMonth(y0, m0, 31);
    const dueDay = dueDayRaw >= 1 ? dueDayRaw : lastDayOf(y0, m0);
    return {
      competence: `${y0}-${pad(m0)}`,
      period_start: iso(y0, m0, 1),
      period_end: end,
      closing_date: end,
      due_date: dayInMonth(y0, m0, dueDay),
      fallback: true,
    };
  }

  // Mês de fechamento: o próprio mês se a compra ocorreu até o fechamento.
  const closingThis = Math.min(closingDay, lastDayOf(y0, m0));
  const [cy, cm] = d0 <= closingThis ? [y0, m0] : addMonths(y0, m0, 1);
  const closing = dayInMonth(cy, cm, closingDay);
  const [py, pm] = addMonths(cy, cm, -1);
  const periodStart = addDaysISO(dayInMonth(py, pm, closingDay), 1);

  const dueDay = dueDayRaw >= 1 && dueDayRaw <= 31 ? dueDayRaw : closingDay;
  // Vencimento posterior ao fechamento: mesmo mês se o dia é maior, senão o mês seguinte.
  const [dy, dm] = dueDay > closingDay ? [cy, cm] : addMonths(cy, cm, 1);
  const due = dayInMonth(dy, dm, dueDay);

  return {
    // Competência = mês do fechamento. Vencimento nunca define competência.
    competence: closing.slice(0, 7),
    period_start: periodStart,
    period_end: closing,
    closing_date: closing,
    due_date: due,
    fallback: false,
  };
}

/** Ciclo em curso (fatura em formação) na data de referência. */
export function openCycleOf(card: CardCycleConfig | null | undefined, todayISO: string): CardCycle {
  return cycleFor(card, todayISO);
}

/** Ciclo imediatamente anterior ao informado. */
export function previousCycleOf(card: CardCycleConfig | null | undefined, cycle: CardCycle): CardCycle {
  return cycleFor(card, addDaysISO(cycle.period_start, -1));
}


export interface CardStatementRow {
  id?: string | null;
  credit_card_id: string;
  competence_month: string;
  due_date?: string | null;
  stated_total?: number | null;
  paid_amount?: number | null;
  outstanding_amount?: number | null;
  reconciliation_difference?: number | null;
  status?: string | null;
}

export interface CardInstallmentRow {
  id?: string | null;
  credit_card_id: string;
  competence_month: string;
  amount: number;
  status?: string | null;
  /** Transação legada que já representa esta parcela no ledger. */
  legacy_transaction_id?: string | null;
  /** parcela já absorvida por uma fatura fechada/paga (E6) — nunca é compromisso futuro */
  absorbed_by_statement_id?: string | null;
  /** identidade da compra original (linhagem de parcelamento) */
  purchase_id?: string | null;
  installment_number?: number | null;
}

export interface CardTxRow {
  id?: string | null;
  credit_card_id?: string | null;
  competence_date?: string | null;
  occurred_at?: string | null;
  amount: number;
  type?: string | null;
  status?: string | null;
  settles_card_id?: string | null;
  /** pagamento de fatura, transferência, amortização: nunca é consumo de cartão */
  movement_kind?: string | null;
}

/** Motivo determinístico pelo qual um lançamento foi excluído da reconstrução. */
export type CardExclusionReason =
  | "absorbed_by_statement"
  | "installment_settled"
  | "not_confirmed"
  | "card_payment"
  | "neutral_movement";

export interface StatementBreakdown {
  /** compras novas do ciclo/competência (não parceladas ou 1ª parcela nova) */
  newPurchases: number;
  /** parcelas já contratadas atribuídas a esta competência */
  contractedInstallments: number;
  feesInterest: number;
  refunds: number;
  credits: number;
  /** valor excluído por já pertencer a fatura anterior/absorvida */
  excludedAbsorbed: number;
  excludedCount: number;
  /** ids dos lançamentos que formaram o número (reconciliável até a origem) */
  transactionIds: string[];
  installmentIds: string[];
}

export interface StatementFigure {
  amount: number;
  source: ExposureSource;
  status: string | null;
  /** total original da fatura, quando oficial */
  statedTotal: number;
  paidAmount: number;
  /** compras elegíveis usadas na reconstrução (só em fatura estimada) */
  purchasesAmount?: number | null;
  /** parcelas contratadas da competência usadas na reconstrução */
  installmentsAmount?: number | null;
  /** decomposição explicável — nenhum número mágico (E10/E18) */
  breakdown?: StatementBreakdown | null;
}

export interface CardExposure {
  cardId: string;
  currentStatement: StatementFigure;
  nextStatement: StatementFigure;
  /** compras do ciclo em curso — parcial, NUNCA é dívida nem fatura fechada */
  formingStatement: StatementFigure;
  futureInstallments: number;
  /** dívida de cartão hoje — apenas faturas não liquidadas */
  totalCardDebt: number;
  needsReview: boolean;
  /** ciclo em curso (fatura em formação), quando o cartão tem fechamento definido */
  openCycle: CardCycle | null;
  /** lançamentos ignorados por já pertencerem a fatura anterior (auditoria) */
  excludedAbsorbed: number;
  excludedCount: number;
  formulaVersion: string;
  cycleVersion: string;
}


const SETTLED_STATUSES = new Set(["paid", "settled", "closed_paid"]);
const CLOSED_STATUSES = new Set(["paid", "settled", "closed", "closed_paid", "approved"]);
const DEAD_INSTALLMENTS = new Set(["paid", "settled", "refunded", "cancelled", "reversed", "anticipated", "superseded"]);
/** Movimentos que nunca são consumo de cartão (E5). */
const NEUTRAL_MOVEMENTS = new Set([
  "card_payment", "debt_payment", "internal_transfer",
  "external_transfer_in", "external_transfer_out",
  "investment_application", "investment_redemption",
]);


const emptyFigure = (): StatementFigure => ({ amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 });

/**
 * Uma linha vazia/draft criada como placeholder não pode esconder parcelas já
 * contratadas. Só tratamos a fatura como documento financeiro autoritativo
 * quando ela está liquidada/fechada ou contém algum valor efetivamente
 * informado. Isso preserva a precedência do documento sem transformar
 * "ausência de informação" em zero.
 */
export function isAuthoritativeCardStatement(statement: CardStatementRow): boolean {
  const status = String(statement.status ?? "").toLowerCase();
  if (SETTLED_STATUSES.has(status) || CLOSED_STATUSES.has(status)) return true;
  return Math.abs(Number(statement.stated_total ?? 0)) > 0.005
    || Math.abs(Number(statement.outstanding_amount ?? 0)) > 0.005
    || Math.abs(Number(statement.paid_amount ?? 0)) > 0.005;
}

export function nextCompetence(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function ymOf(value?: string | null): string | null {
  const v = String(value ?? "");
  return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
}

/**
 * ÍNDICE DE EXCLUSÃO (card_exposure.v3)
 * =====================================
 * `competence_date` NUNCA é a única verdade. Um lançamento cuja parcela já foi
 * absorvida por uma fatura fechada/paga pertence àquela fatura — mesmo que o
 * ledger legado diga outra competência. Sem esta guarda, a fatura em formação
 * recontava faturas antigas (incidente de 18/08/2026).
 *
 * PRECEDÊNCIA: statement oficial fechado/pago > installment absorvida >
 * cronograma de parcelas > ciclo por data da compra > `competence_date` legado.
 */
export interface ExclusionIndex {
  /** id da transação → motivo determinístico da exclusão */
  reasons: Map<string, CardExclusionReason>;
  /** id da transação → competência da fatura que a absorveu (verdade) */
  absorbedCompetence: Map<string, string>;
}

export function buildExclusionIndex(
  installments: CardInstallmentRow[],
  statements: CardStatementRow[],
): ExclusionIndex {
  const reasons = new Map<string, CardExclusionReason>();
  const absorbedCompetence = new Map<string, string>();
  const statementById = new Map<string, CardStatementRow>();
  for (const s of statements) if (s.id) statementById.set(String(s.id), s);

  for (const inst of installments) {
    const txId = inst.legacy_transaction_id ? String(inst.legacy_transaction_id) : null;
    if (!txId) continue;
    const status = String(inst.status ?? "");
    const absorbedId = inst.absorbed_by_statement_id ? String(inst.absorbed_by_statement_id) : null;
    if (absorbedId) {
      const stmt = statementById.get(absorbedId);
      const ym = stmt ? ymOf(stmt.competence_month) : null;
      if (ym) absorbedCompetence.set(txId, ym);
      // Fatura absorvedora é a verdade: o lançamento não volta para reconstrução.
      reasons.set(txId, "absorbed_by_statement");
      continue;
    }
    if (DEAD_INSTALLMENTS.has(status)) reasons.set(txId, "installment_settled");
  }
  return { reasons, absorbedCompetence };
}

/** Motivo pelo qual a transação não pode compor uma fatura reconstruída. */
function exclusionOf(t: CardTxRow, index?: ExclusionIndex): CardExclusionReason | null {
  if (t.settles_card_id) return "card_payment";
  const mk = String(t.movement_kind ?? "transaction");
  if (NEUTRAL_MOVEMENTS.has(mk)) return mk === "card_payment" ? "card_payment" : "neutral_movement";
  if (t.status && t.status !== "confirmed") return "not_confirmed";
  const id = t.id ? String(t.id) : null;
  if (id && index?.reasons.has(id)) return index.reasons.get(id)!;
  return null;
}

interface TxSum {
  total: number;
  ids: string[];
  excludedAbsorbed: number;
  excludedCount: number;
}

function estimateFromTxs(txs: CardTxRow[], cardId: string, ym: string, index?: ExclusionIndex): TxSum {
  let total = 0;
  let excludedAbsorbed = 0;
  let excludedCount = 0;
  const ids: string[] = [];
  for (const t of txs) {
    if (t.credit_card_id !== cardId) continue;
    if (ymOf(t.competence_date) !== ym) continue;
    const reason = exclusionOf(t, index);
    if (reason) {
      if (reason === "absorbed_by_statement" || reason === "installment_settled") {
        excludedAbsorbed += Math.abs(Number(t.amount || 0));
        excludedCount += 1;
      }
      continue;
    }
    const amt = Number(t.amount || 0);
    total += t.type === "income" ? -amt : amt;
    if (t.id) ids.push(String(t.id));
  }
  return { total: round2(Math.max(0, total)), ids, excludedAbsorbed: round2(excludedAbsorbed), excludedCount };
}

/**
 * Parcelas conhecidas de uma competência que NÃO estão absorvidas por fatura.
 * Sem esta soma, uma fatura estimada "esquece" parcelamentos já contratados —
 * era a causa raiz de previsões otimistas na Home e no simulador.
 */
function installmentsOfCompetence(
  installments: CardInstallmentRow[],
  txs: CardTxRow[],
  cardId: string,
  ym: string,
): { total: number; ids: string[] } {
  const ledgerIds = new Set(
    txs
      .filter((tx) => tx.credit_card_id === cardId && ymOf(tx.competence_date) === ym)
      .map((tx) => tx.id)
      .filter((id): id is string => Boolean(id)),
  );
  let total = 0;
  const ids: string[] = [];
  for (const inst of installments) {
    if (inst.credit_card_id !== cardId) continue;
    if (inst.absorbed_by_statement_id) continue;
    if (DEAD_INSTALLMENTS.has((inst.status ?? "").toString())) continue;
    if (ymOf(inst.competence_month) !== ym) continue;
    // A parcela importada/migrada já está dentro de `estimateFromTxs`.
    // Somá-la novamente inflaria a fatura estimada.
    if (inst.legacy_transaction_id && ledgerIds.has(inst.legacy_transaction_id)) continue;
    total += Number(inst.amount || 0);
    if (inst.id) ids.push(String(inst.id));
  }
  return { total: round2(Math.max(0, total)), ids };
}

function estimateFromCycle(txs: CardTxRow[], cardId: string, cycle: CardCycle, index?: ExclusionIndex): TxSum {
  let total = 0;
  let excludedAbsorbed = 0;
  let excludedCount = 0;
  const ids: string[] = [];
  for (const t of txs) {
    if (t.credit_card_id !== cardId) continue;
    const day = String(t.occurred_at ?? "").slice(0, 10);
    if (!day || day < cycle.period_start || day > cycle.period_end) continue;
    const reason = exclusionOf(t, index);
    if (reason) {
      if (reason === "absorbed_by_statement" || reason === "installment_settled") {
        excludedAbsorbed += Math.abs(Number(t.amount || 0));
        excludedCount += 1;
      }
      continue;
    }
    const amt = Number(t.amount || 0);
    total += t.type === "income" ? -amt : amt;
    if (t.id) ids.push(String(t.id));
  }
  return { total: round2(Math.max(0, total)), ids, excludedAbsorbed: round2(excludedAbsorbed), excludedCount };
}


function figureFromStatement(statement: CardStatementRow): StatementFigure {
  const status = (statement.status ?? "").toString() || null;
  const stated = round2(Number(statement.stated_total ?? 0));
  const paid = round2(Number(statement.paid_amount ?? 0));
  const outstanding = statement.outstanding_amount == null
    ? round2(Math.max(0, stated - paid))
    : round2(Number(statement.outstanding_amount));
  const inconsistent = status === "needs_review" || round2(Number(statement.reconciliation_difference ?? 0)) !== 0;
  return {
    amount: SETTLED_STATUSES.has(status ?? "") ? 0 : outstanding,
    source: inconsistent ? "partial" : "official",
    status,
    statedTotal: stated,
    paidAmount: paid,
    purchasesAmount: null,
    installmentsAmount: null,
  };
}

/**
 * Fatura reconstruída sem documento oficial: compras elegíveis da competência
 * MAIS parcelas contratadas da mesma competência. Sem nenhuma das duas fontes o
 * número é `unavailable` — zero nunca substitui ausência de dados.
 */
function estimatedFigure(
  txs: CardTxRow[],
  installments: CardInstallmentRow[],
  cardId: string,
  ym: string,
  index?: ExclusionIndex,
): StatementFigure {
  const purchases = estimateFromTxs(txs, cardId, ym, index);
  const contracted = installmentsOfCompetence(installments, txs, cardId, ym);
  const total = round2(purchases.total + contracted.total);
  return {
    ...emptyFigure(),
    amount: total,
    source: total > 0 ? "estimated" : "unavailable",
    purchasesAmount: purchases.total,
    installmentsAmount: contracted.total,
    breakdown: {
      newPurchases: purchases.total,
      contractedInstallments: contracted.total,
      feesInterest: 0,
      refunds: 0,
      credits: 0,
      excludedAbsorbed: purchases.excludedAbsorbed,
      excludedCount: purchases.excludedCount,
      transactionIds: purchases.ids,
      installmentIds: contracted.ids,
    },
  };
}


export function computeCardExposure(input: {
  cardIds: string[];
  statements: CardStatementRow[];
  installments: CardInstallmentRow[];
  txs: CardTxRow[];
  /** competência corrente no formato YYYY-MM */
  currentYM: string;
  /** configuração de ciclo por cartão (closing_day/due_day) — habilita a fatura em formação */
  cards?: CardCycleConfig[];
  /** data de referência (America/Sao_Paulo) no formato YYYY-MM-DD */
  todayISO?: string;
}): Record<string, CardExposure> {
  const { cardIds, statements, installments, txs, currentYM } = input;
  const nextYM = nextCompetence(currentYM);
  const today = input.todayISO ?? `${currentYM}-01`;
  const cycleConfig = new Map<string, CardCycleConfig>();
  for (const c of input.cards ?? []) if (c.id) cycleConfig.set(c.id, c);
  const result: Record<string, CardExposure> = {};

  const ids = new Set<string>(cardIds);
  for (const s of statements) ids.add(s.credit_card_id);
  for (const i of installments) ids.add(i.credit_card_id);

  // Guarda de absorção — precedência do documento sobre o ledger legado.
  const exclusion = buildExclusionIndex(installments, statements);

  for (const cardId of ids) {
    const cardStatements = statements.filter((s) => s.credit_card_id === cardId);
    const byYM = new Map<string, CardStatementRow>();
    for (const s of cardStatements) {
      const ym = ymOf(s.competence_month);
      if (ym) byYM.set(ym, s);
    }

    const currentCandidate = byYM.get(currentYM);
    const currentRow = currentCandidate && isAuthoritativeCardStatement(currentCandidate)
      ? currentCandidate
      : undefined;
    const current = currentRow
      ? figureFromStatement(currentRow)
      : estimatedFigure(txs, installments, cardId, currentYM, exclusion);

    const nextCandidate = byYM.get(nextYM);
    const nextRow = nextCandidate && isAuthoritativeCardStatement(nextCandidate)
      ? nextCandidate
      : undefined;
    const next = nextRow
      ? figureFromStatement(nextRow)
      : estimatedFigure(txs, installments, cardId, nextYM, exclusion);


    // Última competência já fechada/paga: nada até ela pode contar como futuro.
    let lastClosedYM = "";
    for (const [ym, s] of byYM) {
      if (isAuthoritativeCardStatement(s) && CLOSED_STATUSES.has((s.status ?? "").toString()) && ym > lastClosedYM) lastClosedYM = ym;
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
      if (covering && isAuthoritativeCardStatement(covering) && SETTLED_STATUSES.has((covering.status ?? "").toString())) continue;
      futureInstallments += Number(inst.amount || 0);
    }

    const openStatementsDebt = cardStatements.reduce((sum, s) => {
      if (!isAuthoritativeCardStatement(s)) return sum;
      const status = (s.status ?? "").toString();
      if (SETTLED_STATUSES.has(status)) return sum;
      const fig = figureFromStatement(s);
      return sum + fig.amount;
    }, 0);

    // Faturas oficiais abertas de outras competências continuam sendo dívida.
    // Se a competência atual só possui placeholder, soma-se a reconstrução
    // conhecida em vez de devolver zero silencioso.
    const totalCardDebt = round2(openStatementsDebt + (currentRow ? 0 : current.amount));

    // Fatura em formação: ciclo em curso, por DATA DA COMPRA (nunca dívida).
    const cfg = cycleConfig.get(cardId);
    const openCycle = cfg && Number(cfg.closing_day ?? 0) >= 1 ? openCycleOf(cfg, today) : null;
    const cycleSum = openCycle ? estimateFromCycle(txs, cardId, openCycle, exclusion) : null;
    const forming: StatementFigure = cycleSum
      ? {
          ...emptyFigure(),
          amount: cycleSum.total,
          source: "estimated",
          breakdown: {
            newPurchases: cycleSum.total,
            contractedInstallments: 0,
            feesInterest: 0,
            refunds: 0,
            credits: 0,
            excludedAbsorbed: cycleSum.excludedAbsorbed,
            excludedCount: cycleSum.excludedCount,
            transactionIds: cycleSum.ids,
            installmentIds: [],
          },
        }
      : emptyFigure();

    const excludedAbsorbed = round2(
      (current.breakdown?.excludedAbsorbed ?? 0) + (cycleSum?.excludedAbsorbed ?? 0),
    );
    const excludedCount = (current.breakdown?.excludedCount ?? 0) + (cycleSum?.excludedCount ?? 0);

    result[cardId] = {
      cardId,
      currentStatement: current,
      nextStatement: next,
      formingStatement: forming,
      futureInstallments: round2(futureInstallments),
      totalCardDebt,
      needsReview: Boolean(
        currentRow &&
        ((currentRow.status ?? "") === "needs_review" || round2(Number(currentRow.reconciliation_difference ?? 0)) !== 0),
      ),
      openCycle,
      excludedAbsorbed,
      excludedCount,
      formulaVersion: CARD_EXPOSURE_FORMULA_VERSION,
      cycleVersion: CARD_CYCLE_VERSION,
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

/** Exposição neutra (cartão sem nenhum dado) — evita objetos ad-hoc na UI. */
export function emptyExposure(cardId: string): CardExposure {
  return {
    cardId,
    currentStatement: { amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 },
    nextStatement: { amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 },
    formingStatement: { amount: 0, source: "none", status: null, statedTotal: 0, paidAmount: 0 },
    futureInstallments: 0,
    totalCardDebt: 0,
    needsReview: false,
    openCycle: null,
    excludedAbsorbed: 0,
    excludedCount: 0,

    formulaVersion: CARD_EXPOSURE_FORMULA_VERSION,
    cycleVersion: CARD_CYCLE_VERSION,
  };
}
