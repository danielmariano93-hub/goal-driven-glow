// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
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
import { round2 } from "./facts.ts";

export const CARD_EXPOSURE_FORMULA_VERSION = "card_exposure.v1";
/** Ciclo real por fechamento/vencimento (Onda 2). */
export const CARD_CYCLE_VERSION = "card_cycle.v2";

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
  /** competência da fatura no formato YYYY-MM (mês do vencimento) */
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
 * Convenção (Itaú e maioria dos emissores brasileiros): a competência da fatura
 * é o MÊS DO VENCIMENTO. Compra em 26/07 com fechamento 25 e vencimento 01 cai
 * no ciclo 26/07–25/08, vence em 01/09 → competência `2026-09`.
 *
 * Sem `closing_day` válido, cai no fallback de calendário (mês da própria data),
 * preservando o comportamento anterior a `card_cycle.v2`.
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
    competence: due.slice(0, 7),
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
  formulaVersion: string;
  cycleVersion: string;
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
): number {
  const ledgerIds = new Set(
    txs
      .filter((tx) => tx.credit_card_id === cardId && ymOf(tx.competence_date) === ym)
      .map((tx) => tx.id)
      .filter((id): id is string => Boolean(id)),
  );
  let total = 0;
  for (const inst of installments) {
    if (inst.credit_card_id !== cardId) continue;
    if (inst.absorbed_by_statement_id) continue;
    if (DEAD_INSTALLMENTS.has((inst.status ?? "").toString())) continue;
    if (ymOf(inst.competence_month) !== ym) continue;
    // A parcela importada/migrada já está dentro de `estimateFromTxs`.
    // Somá-la novamente inflaria a fatura estimada.
    if (inst.legacy_transaction_id && ledgerIds.has(inst.legacy_transaction_id)) continue;
    total += Number(inst.amount || 0);
  }
  return round2(Math.max(0, total));
}

function estimateFromCycle(txs: CardTxRow[], cardId: string, cycle: CardCycle): number {
  let total = 0;
  for (const t of txs) {
    if (t.credit_card_id !== cardId) continue;
    if (t.settles_card_id) continue;
    if (t.status && t.status !== "confirmed") continue;
    const day = String(t.occurred_at ?? "").slice(0, 10);
    if (!day || day < cycle.period_start || day > cycle.period_end) continue;
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
): StatementFigure {
  const purchases = estimateFromTxs(txs, cardId, ym);
  const contracted = installmentsOfCompetence(installments, txs, cardId, ym);
  const total = round2(purchases + contracted);
  return {
    ...emptyFigure(),
    amount: total,
    source: total > 0 ? "estimated" : "unavailable",
    purchasesAmount: purchases,
    installmentsAmount: contracted,
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
      : estimatedFigure(txs, installments, cardId, currentYM);

    const nextRow = byYM.get(nextYM);
    const next = nextRow
      ? figureFromStatement(nextRow)
      : estimatedFigure(txs, installments, cardId, nextYM);

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

    // Fatura em formação: ciclo em curso, por DATA DA COMPRA (nunca dívida).
    const cfg = cycleConfig.get(cardId);
    const openCycle = cfg && Number(cfg.closing_day ?? 0) >= 1 ? openCycleOf(cfg, today) : null;
    const forming: StatementFigure = openCycle
      ? { ...emptyFigure(), amount: estimateFromCycle(txs, cardId, openCycle), source: "estimated" }
      : emptyFigure();

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
    formulaVersion: CARD_EXPOSURE_FORMULA_VERSION,
    cycleVersion: CARD_CYCLE_VERSION,
  };
}
