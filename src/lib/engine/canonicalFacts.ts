/**
 * finance_truth.v1 — camada canônica de fatos de período.
 *
 * Objetivo: nenhuma superfície (Home, Relatórios, Metas, Nino, WhatsApp, MCP,
 * Insights, Proatividade, Pulso) pode calcular os mesmos conceitos de formas
 * diferentes. Todas consomem as funções deste módulo.
 *
 * Regras incorporadas ao núcleo (não opcionais):
 *  - estorno com vínculo (`refund_of_transaction_id`) abate a categoria/merchant
 *    da despesa ORIGINAL — nunca gera categoria "Estornos" no ranking;
 *  - `status = 'superseded'` nunca entra em nenhum cálculo;
 *  - pagamento de fatura, transferência e aplicação/resgate ficam fora do
 *    consumo comportamental (regra de `behavioralMetricAmount`).
 */
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  round2,
  type CategoryRow,
  type TransactionRow,
} from "./facts";
import { normalizeMerchant, merchantLabel } from "./merchant";

export const FINANCE_TRUTH_VERSION = "finance_truth.v1";

/**
 * Contrato de leitura único de transações. Toda superfície canônica precisa
 * selecionar EXATAMENTE estas colunas — em especial `refund_of_transaction_id`,
 * sem o qual o motor não consegue atribuir o estorno à categoria original.
 */
export const TRANSACTION_FACT_SELECT =
  "id,account_id,category_id,type,status,amount,occurred_at,posted_at,posted_at_source,purchase_date,competence_date,behavioral_day,behavior_date_source,behavior_date_confidence,description,friendly_description,merchant_name,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,investment_id,refund_of_transaction_id";

/** Contrato de leitura único da âncora bancária. */
export const BANK_ANCHOR_SELECT =
  "account_id,balance,balance_date,status,anchor_kind,source_document_id,reconciliation_delta";

export type EngineConfidence = "high" | "medium" | "low";

export interface FactEvidence {
  engine: string;
  formula_version: string;
  period: { start: string; end: string };
  as_of: string;
  row_count: number;
  confidence: EngineConfidence;
  notes?: string[];
}

export interface CanonicalCategoryFact {
  category_id: string | null;
  name: string;
  /** Valor líquido (bruto - estornos atribuídos). É o número exibido. */
  net: number;
  /** Soma das despesas sem abatimento de estorno — só para auditoria. */
  gross: number;
  /** Estornos atribuídos a esta categoria econômica. */
  refunds: number;
  count: number;
  share: number;
  merchants: Array<{ key: string; label: string; net: number; count: number }>;
}

export interface CanonicalCategoryFacts {
  metric: "expense" | "income";
  total: number;
  rows: CanonicalCategoryFact[];
  evidence: FactEvidence;
}

export interface CanonicalPeriodTotals {
  income: number;
  expense: number;
  net: number;
  transaction_count: number;
  evidence: FactEvidence;
}

export interface CanonicalCategoryDriver {
  category_id: string | null;
  name: string;
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
}

export interface CanonicalComparison {
  metric: "expense" | "income";
  total_a: number;
  total_b: number;
  delta_abs: number;
  delta_pct: number | null;
  drivers: CanonicalCategoryDriver[];
  merchant_drivers: Array<{ key: string; label: string; delta_abs: number; total_a: number; total_b: number }>;
  evidence: FactEvidence;
}

export interface PeriodRange {
  start: string;
  end: string;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function confidenceFrom(rowCount: number, days: number): EngineConfidence {
  if (rowCount >= 20 && days >= 14) return "high";
  if (rowCount >= 6) return "medium";
  return "low";
}

function daysOf(range: PeriodRange): number {
  const a = new Date(`${range.start}T12:00:00Z`).getTime();
  const b = new Date(`${range.end}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * Guarda de contrato: uma superfície canônica não pode calcular categoria sem
 * a proveniência de estorno. Quando o select esquece `refund_of_transaction_id`
 * o total fecha e a categoria mente — falha explícita é melhor que silêncio.
 */
export function assertRefundProvenance(
  txs: Array<Record<string, unknown>>,
  surface: string,
): void {
  const refundRow = txs.find((t) => String(t.movement_kind ?? "") === "refund");
  if (!refundRow) return;
  if (!("refund_of_transaction_id" in refundRow)) {
    throw new Error(
      `finance_truth_contract:${surface}: select sem refund_of_transaction_id (use TRANSACTION_FACT_SELECT)`,
    );
  }
}

/** Remove linhas que nunca podem entrar em cálculo (superseded). */
export function canonicalLedgerRows<T extends { status?: string | null }>(txs: T[]): T[] {
  return txs.filter((t) => String(t.status ?? "confirmed") !== "superseded");
}

function inRange(date: string, range: PeriodRange): boolean {
  const d = date.slice(0, 10);
  return d >= range.start && d <= range.end;
}

/** Totais canônicos de período — usados por Home, Relatórios, Agent, MCP. */
export function computeCanonicalPeriodTotals(
  txsInput: TransactionRow[],
  range: PeriodRange,
): CanonicalPeriodTotals {
  const txs = canonicalLedgerRows(txsInput);
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of txs) {
    if (!inRange(t.occurred_at, range)) continue;
    const inc = behavioralMetricAmount(t, "income");
    const exp = behavioralMetricAmount(t, "expense");
    if (inc === 0 && exp === 0) continue;
    income += inc;
    expense += exp;
    count += 1;
  }
  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    transaction_count: count,
    evidence: {
      engine: "canonical_period_totals",
      formula_version: FINANCE_TRUTH_VERSION,
      period: range,
      as_of: todayIso(),
      row_count: count,
      confidence: confidenceFrom(count, daysOf(range)),
    },
  };
}

/**
 * Fatos canônicos por categoria. Este é o ÚNICO caminho permitido para
 * responder "quanto gastei em X" em qualquer superfície.
 */
export function computeCanonicalCategoryFacts(
  txsInput: TransactionRow[],
  categories: Array<Pick<CategoryRow, "id" | "name">>,
  range: PeriodRange,
  metric: "expense" | "income" = "expense",
): CanonicalCategoryFacts {
  const txs = canonicalLedgerRows(txsInput);
  // A atribuição usa o histórico completo: a despesa original pode estar fora
  // do período do estorno, e ainda assim é ela que define a categoria.
  const attribution = buildRefundAttribution(txs);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const buckets = new Map<string, {
    net: number;
    gross: number;
    refunds: number;
    count: number;
    merchants: Map<string, { label: string; net: number; count: number }>;
  }>();
  let rowCount = 0;

  for (const t of txs) {
    if (!inRange(t.occurred_at, range)) continue;
    const signed = behavioralMetricAmount(t, metric);
    if (signed === 0) continue;
    rowCount += 1;
    const key = effectiveCategoryId(t, attribution) ?? "__none__";
    const bucket = buckets.get(key) ?? {
      net: 0, gross: 0, refunds: 0, count: 0,
      merchants: new Map<string, { label: string; net: number; count: number }>(),
    };
    bucket.net = round2(bucket.net + signed);
    if (signed > 0) {
      bucket.gross = round2(bucket.gross + signed);
      bucket.count += 1;
    } else {
      bucket.refunds = round2(bucket.refunds - signed);
    }
    const mKey = normalizeMerchant(
      (t as { merchant_name?: string | null }).merchant_name
        ?? t.friendly_description
        ?? t.description,
    );
    if (mKey) {
      const merchant = bucket.merchants.get(mKey)
        ?? { label: merchantLabel(mKey), net: 0, count: 0 };

      merchant.net = round2(merchant.net + signed);
      if (signed > 0) merchant.count += 1;
      bucket.merchants.set(mKey, merchant);
    }
    buckets.set(key, bucket);
  }

  const total = round2([...buckets.values()].reduce((sum, b) => sum + b.net, 0));
  const rows: CanonicalCategoryFact[] = [...buckets.entries()]
    .map(([id, b]) => ({
      category_id: id === "__none__" ? null : id,
      name: id === "__none__" ? "Sem categoria" : (nameById.get(id) ?? "Categoria removida"),
      net: round2(b.net),
      gross: round2(b.gross),
      refunds: round2(b.refunds),
      count: b.count,
      share: total > 0 ? round2(b.net / total) : 0,
      merchants: [...b.merchants.entries()]
        .map(([key, m]) => ({ key, label: m.label, net: round2(m.net), count: m.count }))
        .filter((m) => m.net !== 0)
        .sort((a, b2) => b2.net - a.net)
        .slice(0, 5),
    }))
    .filter((row) => row.net !== 0)
    .sort((a, b) => b.net - a.net);

  return {
    metric,
    total,
    rows,
    evidence: {
      engine: "canonical_category_facts",
      formula_version: FINANCE_TRUTH_VERSION,
      period: range,
      as_of: todayIso(),
      row_count: rowCount,
      confidence: confidenceFrom(rowCount, daysOf(range)),
    },
  };
}

/** Fato canônico de UMA categoria (metas, assessor, relatórios inteligentes). */
export function computeCanonicalCategoryTotal(
  txs: TransactionRow[],
  categoryId: string,
  range: PeriodRange,
  metric: "expense" | "income" = "expense",
): { net: number; gross: number; refunds: number; count: number } {
  const rows = canonicalLedgerRows(txs);
  const attribution = buildRefundAttribution(rows);
  let net = 0;
  let gross = 0;
  let refunds = 0;
  let count = 0;
  for (const t of rows) {
    if (effectiveCategoryId(t, attribution) !== categoryId) continue;
    if (!inRange(t.occurred_at, range)) continue;
    const signed = behavioralMetricAmount(t, metric);
    if (signed === 0) continue;
    net += signed;
    if (signed > 0) { gross += signed; count += 1; } else { refunds -= signed; }
  }
  return { net: round2(net), gross: round2(gross), refunds: round2(refunds), count };
}

/** Comparação canônica entre dois períodos, com drivers por categoria econômica. */
export function computeCanonicalComparison(
  txsInput: TransactionRow[],
  categories: Array<Pick<CategoryRow, "id" | "name">>,
  periodA: PeriodRange,
  periodB: PeriodRange,
  metric: "expense" | "income" = "expense",
): CanonicalComparison {
  const a = computeCanonicalCategoryFacts(txsInput, categories, periodA, metric);
  const b = computeCanonicalCategoryFacts(txsInput, categories, periodB, metric);

  const keyOf = (row: CanonicalCategoryFact) => row.category_id ?? "__none__";
  const mapA = new Map(a.rows.map((r) => [keyOf(r), r]));
  const mapB = new Map(b.rows.map((r) => [keyOf(r), r]));
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);

  const drivers: CanonicalCategoryDriver[] = [...keys].map((key) => {
    const ra = mapA.get(key);
    const rb = mapB.get(key);
    const ta = ra?.net ?? 0;
    const tb = rb?.net ?? 0;
    const delta = round2(tb - ta);
    return {
      category_id: key === "__none__" ? null : key,
      name: (rb ?? ra)?.name ?? "Sem categoria",
      total_a: ta,
      total_b: tb,
      delta_abs: delta,
      delta_pct: ta > 0 ? round2(delta / ta) : (tb > 0 ? null : 0),
    };
  }).sort((x, y) => Math.abs(y.delta_abs) - Math.abs(x.delta_abs));

  const merchantsA = new Map<string, { label: string; net: number }>();
  const merchantsB = new Map<string, { label: string; net: number }>();
  for (const [rowsList, target] of [[a.rows, merchantsA], [b.rows, merchantsB]] as const) {
    for (const row of rowsList) {
      for (const m of row.merchants) {
        const cur = target.get(m.key) ?? { label: m.label, net: 0 };
        cur.net = round2(cur.net + m.net);
        target.set(m.key, cur);
      }
    }
  }
  const merchantKeys = new Set([...merchantsA.keys(), ...merchantsB.keys()]);
  const merchant_drivers = [...merchantKeys].map((key) => {
    const ta = merchantsA.get(key)?.net ?? 0;
    const tb = merchantsB.get(key)?.net ?? 0;
    return {
      key,
      label: merchantsB.get(key)?.label ?? merchantsA.get(key)?.label ?? key,
      total_a: ta,
      total_b: tb,
      delta_abs: round2(tb - ta),
    };
  }).sort((x, y) => Math.abs(y.delta_abs) - Math.abs(x.delta_abs)).slice(0, 8);

  const rowCount = a.evidence.row_count + b.evidence.row_count;
  return {
    metric,
    total_a: a.total,
    total_b: b.total,
    delta_abs: round2(b.total - a.total),
    delta_pct: a.total > 0 ? round2((b.total - a.total) / a.total) : null,
    drivers,
    merchant_drivers,
    evidence: {
      engine: "canonical_comparison",
      formula_version: FINANCE_TRUTH_VERSION,
      period: { start: periodA.start, end: periodB.end },
      as_of: todayIso(),
      row_count: rowCount,
      confidence: confidenceFrom(rowCount, daysOf(periodA) + daysOf(periodB)),
    },
  };
}

/** Movimento real de despesa da categoria (usado por baseline de meta). */
export function isCanonicalExpenseMovement(t: TransactionRow): boolean {
  return t.type === "expense" && isRealMonthlyMovement(t);
}
