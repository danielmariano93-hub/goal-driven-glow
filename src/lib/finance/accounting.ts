import { behavioralMetricAmount, round2, type TransactionRow } from "@/lib/engine/facts";

export const ACCOUNTING_FORMULA_VERSION = "personal_finance_accrual.v1";
export const DEBT_FORMULA_VERSION = "debt_schedule.v1";

export type DebtPlanInput = {
  originalAmount?: number | null;
  installmentAmount?: number | null;
  installmentsTotal?: number | null;
  installmentsPaid?: number | null;
};

export type DebtPlan = {
  originalAmount: number;
  installmentAmount: number | null;
  installmentsTotal: number | null;
  installmentsPaid: number;
  paidAmount: number;
  outstandingAmount: number;
  progressPct: number;
  inferredOriginal: boolean;
};

/**
 * Resolve um plano de dívida sem esconder inferências:
 * - total informado prevalece;
 * - sem total, parcela × quantidade pode inferi-lo;
 * - saldo nunca fica negativo;
 * - progresso usa valor efetivamente amortizado.
 */
export function resolveDebtPlan(input: DebtPlanInput): DebtPlan {
  const installment = positive(input.installmentAmount);
  const totalInstallments = positiveInt(input.installmentsTotal);
  const paidInstallments = Math.min(
    positiveInt(input.installmentsPaid) ?? 0,
    totalInstallments ?? Number.MAX_SAFE_INTEGER,
  );
  const explicitOriginal = positive(input.originalAmount);
  const inferred = explicitOriginal == null && installment != null && totalInstallments != null;
  const original = round2(explicitOriginal ?? ((installment ?? 0) * (totalInstallments ?? 0)));
  const paid = round2(Math.min(original, installment != null ? installment * paidInstallments : 0));
  const outstanding = round2(Math.max(0, original - paid));
  return {
    originalAmount: original,
    installmentAmount: installment,
    installmentsTotal: totalInstallments,
    installmentsPaid: paidInstallments,
    paidAmount: paid,
    outstandingAmount: outstanding,
    progressPct: original > 0 ? round2((paid / original) * 100) : 0,
    inferredOriginal: inferred,
  };
}

export type DailySpendPoint = {
  date: string;
  actual: number;
  typical: number;
  rollingTypical: number;
};

function parseLocal(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function enumerateDays(start: string, end: string): string[] {
  const cursor = parseLocal(start);
  const last = parseLocal(end);
  const result: string[] = [];
  while (cursor <= last) {
    result.push(isoLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const rest = position - lower;
  return sorted[lower + 1] == null
    ? sorted[lower]
    : sorted[lower] + rest * (sorted[lower + 1] - sorted[lower]);
}

/**
 * Série factual para Relatórios.
 * `actual` conserva os picos; `typical` retira somente dias estatisticamente
 * atípicos quando há amostra suficiente; zeros permanecem no denominador.
 */
export function buildDailySpendSeries(
  txs: TransactionRow[],
  range: { start: string; end: string },
  rollingWindow = 7,
): DailySpendPoint[] {
  const dates = enumerateDays(range.start, range.end);
  const byDay = new Map(dates.map((date) => [date, 0]));
  for (const transaction of txs) {
    const date = transaction.occurred_at.slice(0, 10);
    if (!byDay.has(date)) continue;
    const amount = behavioralMetricAmount(transaction, "expense");
    byDay.set(date, round2((byDay.get(date) ?? 0) + amount));
  }
  const positiveDays = [...byDay.values()].filter((value) => value > 0).sort((a, b) => a - b);
  let outlierLimit = Number.POSITIVE_INFINITY;
  if (positiveDays.length >= 8) {
    const q1 = quantile(positiveDays, 0.25);
    const q3 = quantile(positiveDays, 0.75);
    outlierLimit = q3 + 1.5 * (q3 - q1);
  }
  const typicalValues = dates.map((date) => {
    const actual = round2(Math.max(0, byDay.get(date) ?? 0));
    return actual > outlierLimit ? 0 : actual;
  });
  return dates.map((date, index) => {
    const from = Math.max(0, index - rollingWindow + 1);
    const sample = typicalValues.slice(from, index + 1);
    // Divide pela janela civil, portanto dias sem gasto continuam representados.
    const rollingTypical = round2(sample.reduce((sum, value) => sum + value, 0) / sample.length);
    return {
      date,
      actual: round2(Math.max(0, byDay.get(date) ?? 0)),
      typical: typicalValues[index],
      rollingTypical,
    };
  });
}

function positive(value: number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : null;
}

function positiveInt(value: number | null | undefined): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
