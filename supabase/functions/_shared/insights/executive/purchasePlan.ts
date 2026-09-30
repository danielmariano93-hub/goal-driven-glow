// Antes de gastar — projeção mês a mês (`nino_purchase_plan.v1`)
//
// Uma compra futura é julgada no(s) mês(es) em que ela pesa, nunca só no mês
// corrente: no cartão, cada parcela cai na fatura da sua competência; à vista,
// no mês da data prevista. Para cada mês afetado:
//
//   entra  = renda típica (mediana dos últimos 6 meses; no mês corrente, o que
//            já entrou se for maior)
//   sai    = gasto típico (mediana — já inclui aluguel, contas e as parcelas de
//            sempre), ou o que já está comprometido (fixos + parcelas
//            contratadas) se isso for maior; no mês corrente, o realizado mais o
//            ritmo típico dos dias que faltam
//   sobra  = entra − sai − compra
//
// Mesma verdade canônica do motor executivo (livro por competência, estornos,
// sem fatura/transferência). Módulo puro, sem I/O.
import { brl, compact, monthName, monthNameCap, pct } from "./format.ts";
import { addMonths, buildBook, isStable, median, monthsOf, range, type LedgerEntry } from "./engine.ts";

export const PURCHASE_PLAN_VERSION = "nino_purchase_plan.v1";

export type PurchasePlanInput = {
  as_of: string;
  entries: LedgerEntry[];
  future_installments?: Array<{ month: string; amount: number }>;
  purchase: {
    amount: number;
    category_id: string | null;
    category_name: string;
    /** Competência (YYYY-MM) e valor de cada parcela; à vista = um item. */
    months: Array<{ month: string; amount: number }>;
    /** Limite da meta da categoria em cada mês afetado (quando existe). */
    category_limits?: Record<string, number | null>;
  };
};

export type MonthVerdict = "fits" | "tight" | "deficit" | "worsens_deficit";

export type PurchaseMonth = {
  month: string;
  label: string;
  purchase: number;
  income: number;
  income_basis: "typical" | "realized";
  outflow: number;
  outflow_basis: "typical" | "committed" | "realized_plus_pace";
  fixed_commitments: number;
  contracted_installments: number;
  margin_before: number;
  margin_after: number;
  verdict: MonthVerdict;
  summary: string;
  category: {
    name: string;
    typical: number;
    after: number;
    limit: number | null;
    exceeds_limit: boolean;
    times_typical: number | null;
    text: string;
  } | null;
};

export type PurchasePlan = {
  version: typeof PURCHASE_PLAN_VERSION;
  verdict: MonthVerdict | "unknown";
  headline: string;
  explanation: string;
  months: PurchaseMonth[];
  fixed_commitments: Array<{ label: string; amount: number }>;
  notes: string[];
  basis: { months_of_history: number; income_reliable: boolean; typical_income: number; typical_spend: number; weakest_income: number | null };
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const ym = (date: string) => date.slice(0, 7);
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const RANK: Record<MonthVerdict, number> = { fits: 0, tight: 1, deficit: 2, worsens_deficit: 3 };

export function computePurchasePlan(input: PurchasePlanInput): PurchasePlan {
  const asOf = input.as_of.slice(0, 10);
  const current = ym(asOf);
  const day = Number(asOf.slice(8, 10));
  const firstMonth = input.entries.reduce<string | null>((min, e) => (!min || ym(e.date) < min ? ym(e.date) : min), null) ?? current;
  // Base: os 6 meses fechados anteriores ao mês corrente.
  const baseline = range(addMonths(current, -6), addMonths(current, -1)).filter((m) => m >= firstMonth);
  const book = buildBook(input.entries, range(addMonths(current, -12), current));

  const incomes = monthsOf(book.income, baseline).filter((v) => v > 0);
  const incomeReliable = incomes.length >= 3;
  const typicalIncome = r2(median(incomes));
  const weakestIncome = incomes.length ? Math.min(...incomes) : null;
  const typicalSpend = r2(median(monthsOf(book.spend, baseline)));

  // Compromissos fixos: uma cobrança por mês com valor estável (aluguel, contas, assinaturas).
  const window = [...baseline, current];
  const fixed = [...book.byMerchant.values()].flatMap((mer) => {
    const present = window.filter((m) => (mer.counts.get(m) ?? 0) > 0);
    if (present.length < Math.min(4, window.length)) return [];
    const perMonth = sum(present.map((m) => mer.counts.get(m) ?? 0)) / present.length;
    const values = monthsOf(mer.months, window);
    if (perMonth > 1.5 || !isStable(values, Math.min(4, window.length))) return [];
    return [{ label: mer.label, amount: r2(median(values.filter((v) => v > 0))) }];
  }).sort((a, b) => b.amount - a.amount);
  const fixedTotal = r2(sum(fixed.map((f) => f.amount)));

  const categoryKey = input.purchase.category_id ?? `name:${input.purchase.category_name}`;
  const categoryBook = book.byCategory.get(categoryKey);
  const categoryTypical = r2(median(categoryBook ? monthsOf(categoryBook.months, baseline) : []));

  const byMonth = new Map<string, number>();
  for (const item of input.purchase.months) {
    if (!/^\d{4}-\d{2}$/.test(item.month) || !(item.amount > 0)) continue;
    byMonth.set(item.month, r2((byMonth.get(item.month) ?? 0) + item.amount));
  }

  const months: PurchaseMonth[] = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, purchase]) => {
    const isCurrent = month === current;
    const contracted = r2(sum((input.future_installments ?? []).filter((i) => i.month === month).map((i) => i.amount)));
    const committed = r2(fixedTotal + (month > current ? contracted : 0));

    let income = typicalIncome;
    let incomeBasis: PurchaseMonth["income_basis"] = "typical";
    let outflow = Math.max(typicalSpend, committed);
    let outflowBasis: PurchaseMonth["outflow_basis"] = committed > typicalSpend ? "committed" : "typical";
    if (isCurrent) {
      const realizedIncome = book.income.get(current) ?? 0;
      if (realizedIncome > income) { income = realizedIncome; incomeBasis = "realized"; }
      const realizedSpend = book.spend.get(current) ?? 0;
      const remainingShare = Math.max(0, (daysIn(current) - day) / daysIn(current));
      const paced = realizedSpend + typicalSpend * remainingShare;
      outflow = Math.max(paced, committed);
      outflowBasis = "realized_plus_pace";
    }
    income = r2(income);
    outflow = r2(outflow);
    const marginBefore = r2(income - outflow);
    const marginAfter = r2(marginBefore - purchase);
    const verdict: MonthVerdict = marginAfter >= Math.max(200, 0.1 * income)
      ? "fits"
      : marginAfter >= 0 ? "tight" : marginBefore >= 0 ? "deficit" : "worsens_deficit";
    const label = monthNameCap(month);
    const summary = {
      fits: `${label}: sobram ${compact(marginAfter)} depois da compra.`,
      tight: `${label}: cabe, mas a sobra cai de ${compact(marginBefore)} para ${compact(marginAfter)}.`,
      deficit: `${label}: o mês passa a fechar ${compact(-marginAfter)} no negativo.`,
      worsens_deficit: `${label}: o mês já tende a fechar ${compact(-marginBefore)} no negativo; com a compra, ${compact(-marginAfter)}.`,
    }[verdict];

    const limit = input.purchase.category_limits?.[month] ?? null;
    const after = r2(categoryTypical + purchase);
    const timesTypical = categoryTypical > 0 ? r2(after / categoryTypical) : null;
    const exceeds = limit != null && after > limit;
    const categoryText = limit != null
      ? (exceeds
        ? `${input.purchase.category_name} em ${monthName(month)}: seu gasto típico (${brl(categoryTypical)}) mais esta compra dá ${brl(after)}, ${brl(after - limit)} acima do limite de ${brl(limit)}.`
        : `${input.purchase.category_name} em ${monthName(month)}: ${brl(after)} com esta compra, dentro do limite de ${brl(limit)}.`)
      : categoryTypical > 0
        ? `${input.purchase.category_name} em ${monthName(month)}: ${brl(after)} com esta compra, ${timesTypical != null && timesTypical >= 1.2 ? `${timesTypical.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes` : "perto de"} o seu normal (${brl(categoryTypical)}).`
        : `${input.purchase.category_name} em ${monthName(month)}: esta compra seria praticamente todo o gasto da categoria no mês.`;

    return {
      month,
      label,
      purchase,
      income,
      income_basis: incomeBasis,
      outflow,
      outflow_basis: outflowBasis,
      fixed_commitments: fixedTotal,
      contracted_installments: month > current ? contracted : 0,
      margin_before: marginBefore,
      margin_after: marginAfter,
      verdict,
      summary,
      category: {
        name: input.purchase.category_name,
        typical: categoryTypical,
        after,
        limit,
        exceeds_limit: exceeds,
        times_typical: timesTypical,
        text: categoryText,
      },
    };
  });

  const notes: string[] = [];
  if (incomeReliable && weakestIncome != null && typicalIncome > 0 && weakestIncome < 0.7 * typicalIncome && months.length) {
    const worst = months.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a));
    const weakMargin = r2(weakestIncome - worst.outflow - worst.purchase);
    notes.push(`Sua renda varia bastante. Num mês fraco como o seu pior dos últimos 6 (${compact(weakestIncome)}), ${monthName(worst.month)} fecharia ${weakMargin >= 0 ? `com ${compact(weakMargin)} de sobra` : `${compact(-weakMargin)} no negativo`}.`);
  }
  if (baseline.length < 3) notes.push("Ainda há pouco histórico: a projeção fica mais precisa com mais meses registrados.");

  if (!incomeReliable) {
    return {
      version: PURCHASE_PLAN_VERSION,
      verdict: "unknown",
      headline: "Preciso da sua renda para dizer se cabe",
      explanation: `Não há renda registrada suficiente nos últimos meses. Seu gasto típico é ${compact(typicalSpend)} por mês; esta compra soma ${compact(input.purchase.amount)} a isso.`,
      months,
      fixed_commitments: fixed.slice(0, 5),
      notes,
      basis: { months_of_history: baseline.length, income_reliable: false, typical_income: typicalIncome, typical_spend: typicalSpend, weakest_income: weakestIncome },
    };
  }

  const worst = months.reduce<PurchaseMonth | null>((a, b) => (!a || RANK[b.verdict] > RANK[a.verdict] ? b : a), null);
  const verdict = worst?.verdict ?? "fits";
  const where = months.length > 1 ? `em ${monthName(worst!.month)}` : `em ${monthName(worst?.month ?? current)}`;
  const headline = {
    fits: months.length > 1 ? "Cabe em todos os meses das parcelas" : `Cabe no seu orçamento de ${monthName(worst?.month ?? current)}`,
    tight: `Cabe, mas aperta ${where}`,
    deficit: `Não cabe ${where}: o mês passa a fechar no negativo`,
    worsens_deficit: `Não cabe: ${monthName(worst?.month ?? current)} já tende a fechar no negativo`,
  }[verdict];
  const explanation = worst
    ? `Num mês típico entram ${compact(worst.income)} e saem ${compact(worst.outflow)} (seu padrão, já com aluguel, contas e parcelas de sempre). ${worst.summary}`
    : "";

  return {
    version: PURCHASE_PLAN_VERSION,
    verdict,
    headline,
    explanation,
    months,
    fixed_commitments: fixed.slice(0, 5),
    notes,
    basis: { months_of_history: baseline.length, income_reliable: true, typical_income: typicalIncome, typical_spend: typicalSpend, weakest_income: weakestIncome },
  };
}

/** Participação da compra no gasto típico (para o texto "equivale a X% do seu mês"). */
export function shareOfTypicalMonth(plan: PurchasePlan, amount: number): string | null {
  return plan.basis.typical_spend > 0 ? pct(amount / plan.basis.typical_spend) : null;
}
