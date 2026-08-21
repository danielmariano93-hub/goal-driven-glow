// perf_facts.v1 — FATOS FINANCEIROS MENSAIS DERIVADOS
// ===================================================
// Este módulo NÃO cria verdade financeira nova: ele aplica as MESMAS regras
// canônicas de `finance-core/facts.ts` (espelho de `src/lib/engine/facts.ts`)
// sobre UM mês de lançamentos e materializa o resultado.
//
// Por que existe: o motor de saldo e de exposição de cartão é cumulativo desde
// a origem da vida financeira. Sem fatos mensais, qualquer leitura precisa
// reler o ledger inteiro (O(N)). Com eles, `balance(M) = balance(M-1) + delta(M)`
// e a abertura da Home passa a custar o tamanho da JANELA, não da vida.
//
// Regras de atribuição (uma linha entra em cada métrica no máximo uma vez):
//  - métricas comportamentais (renda/consumo): mês de `occurred_at`;
//  - deltas de conta (caixa): mês de `cashDateOf` (postagem bancária > competência > econômica);
//  - deltas de cartão: mês de `occurred_at`.
import {
  behavioralMetricAmount,
  cashDateOf,
  isRealMonthlyMovement,
  round2,
  txOrigin,
  type TransactionRow,
} from "../finance-core/facts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const FACTS_FORMULA_VERSION = "perf_facts.v1";

export type MonthlyFacts = {
  competence_month: string;
  income: number;
  behavioral_expense: number;
  refunds: number;
  account_in: number;
  account_out: number;
  card_out: number;
  internal_transfers: number;
  external_transfers_in: number;
  external_transfers_out: number;
  investment_applications: number;
  investment_redemptions: number;
  loan_proceeds: number;
  debt_payments: number;
  card_payments: number;
  transaction_count: number;
  days_with_expense: number;
  account_deltas: Record<string, number>;
  card_deltas: Record<string, number>;
  category_breakdown: Record<string, number>;
  merchant_breakdown: Record<string, number>;
  completeness: "complete" | "partial";
};

const ym = (d: string) => String(d).slice(0, 7);
const bump = (m: Record<string, number>, k: string, v: number) => {
  m[k] = round2((m[k] ?? 0) + v);
};

/** Mês de competência de um lançamento — igual ao trigger `mark_financial_ledger_dirty`. */
export function factMonthOf(t: { competence_date?: string | null; occurred_at: string }): string {
  return ym(t.competence_date || t.occurred_at);
}

/**
 * Calcula os fatos do mês `month` (YYYY-MM) a partir de um SUPERCONJUNTO de
 * lançamentos (qualquer linha cujo `occurred_at`, `competence_date` ou
 * `posted_at` caia no mês). Cada métrica filtra pela sua própria data canônica.
 */
export function computeMonthlyFacts(month: string, rows: TransactionRow[]): MonthlyFacts {
  const facts: MonthlyFacts = {
    competence_month: `${month}-01`,
    income: 0,
    behavioral_expense: 0,
    refunds: 0,
    account_in: 0,
    account_out: 0,
    card_out: 0,
    internal_transfers: 0,
    external_transfers_in: 0,
    external_transfers_out: 0,
    investment_applications: 0,
    investment_redemptions: 0,
    loan_proceeds: 0,
    debt_payments: 0,
    card_payments: 0,
    transaction_count: 0,
    days_with_expense: 0,
    account_deltas: {},
    card_deltas: {},
    category_breakdown: {},
    merchant_breakdown: {},
    completeness: "complete",
  };

  const daysWithExpense = new Set<string>();
  const transferLegs = new Map<string, TransactionRow[]>();

  for (const t of rows) {
    const amount = Number(t.amount ?? 0);
    const mk = String((t as Any).movement_kind ?? "transaction");
    const behavioralMonth = ym(t.occurred_at);
    const cashMonth = ym(cashDateOf(t));

    // ── Métricas comportamentais (data econômica) ────────────────────────
    if (behavioralMonth === month) {
      if (factMonthOf(t) === month) facts.transaction_count += 1;
      const inc = behavioralMetricAmount(t, "income");
      const exp = behavioralMetricAmount(t, "expense");
      facts.income = round2(facts.income + inc);
      facts.behavioral_expense = round2(facts.behavioral_expense + exp);
      if (mk === "refund" && t.type === "income") facts.refunds = round2(facts.refunds + amount);
      if (exp > 0) {
        daysWithExpense.add(t.occurred_at);
        if (t.category_id) bump(facts.category_breakdown, t.category_id, exp);
        const merchant = String((t as Any).merchant_name ?? "").trim();
        if (merchant) bump(facts.merchant_breakdown, merchant.toLowerCase(), exp);
      }
      if (isRealMonthlyMovement(t) === false) {
        if (mk === "investment_application") facts.investment_applications = round2(facts.investment_applications + amount);
        if (mk === "investment_redemption") facts.investment_redemptions = round2(facts.investment_redemptions + amount);
        if (mk === "loan_proceeds") facts.loan_proceeds = round2(facts.loan_proceeds + amount);
        if (mk === "internal_transfer") facts.internal_transfers = round2(facts.internal_transfers + amount);
        if (mk === "external_transfer_in") facts.external_transfers_in = round2(facts.external_transfers_in + amount);
        if (mk === "external_transfer_out") facts.external_transfers_out = round2(facts.external_transfers_out + amount);
      }
      if ((t as Any).settles_card_id) facts.card_payments = round2(facts.card_payments + amount);
      if (mk === "debt_payment") facts.debt_payments = round2(facts.debt_payments + amount);

      // ── Delta de cartão (data econômica, igual à exposição canônica) ────
      if (t.status === "confirmed" && t.type === "expense" && txOrigin(t) === "credit_card" && t.credit_card_id) {
        bump(facts.card_deltas, String(t.credit_card_id), amount);
        facts.card_out = round2(facts.card_out + amount);
      }
      if (t.status === "confirmed" && (t as Any).settles_card_id) {
        bump(facts.card_deltas, String((t as Any).settles_card_id), -amount);
      }
    }

    // ── Delta de conta (data de CAIXA) ───────────────────────────────────
    if (cashMonth === month && t.status === "confirmed") {
      if (t.type === "transfer") {
        const gid = (t as Any).transfer_group_id;
        if (gid) {
          const legs = transferLegs.get(String(gid)) ?? [];
          legs.push(t);
          transferLegs.set(String(gid), legs);
        }
      } else if (txOrigin(t) === "account" && t.account_id) {
        const signed = t.type === "income" ? amount : -amount;
        bump(facts.account_deltas, String(t.account_id), signed);
        if (signed > 0) facts.account_in = round2(facts.account_in + amount);
        else facts.account_out = round2(facts.account_out + amount);
      }
    }
  }

  // Transferências entre contas próprias movem dinheiro em pares (mesma regra
  // determinística do motor: ordem por id, primeira perna debita).
  for (const legs of transferLegs.values()) {
    if (legs.length < 2) continue;
    const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
    const amount = Number(sorted[0].amount ?? 0);
    bump(facts.account_deltas, String(sorted[0].account_id), -amount);
    bump(facts.account_deltas, String(sorted[1].account_id), amount);
  }

  facts.days_with_expense = daysWithExpense.size;
  return facts;
}

/** Superconjunto do mês: qualquer data relevante dentro do intervalo. */
export async function fetchMonthRows(
  sb: Any,
  userId: string,
  month: string,
  columns: string,
): Promise<Any[]> {
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const end = endDate.toISOString().slice(0, 10);
  const PAGE = 1000;
  const rows: Any[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await sb
      .from("transactions")
      .select(columns)
      .eq("user_id", userId)
      .or(
        `and(occurred_at.gte.${start},occurred_at.lte.${end}),` +
          `and(competence_date.gte.${start},competence_date.lte.${end}),` +
          `and(posted_at.gte.${start},posted_at.lte.${end})`,
      )
      .order("id", { ascending: true })
      .range(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { source: "transactions" });
    const chunk = (data ?? []) as Any[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}
