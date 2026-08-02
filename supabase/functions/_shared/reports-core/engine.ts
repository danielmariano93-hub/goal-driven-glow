// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v2)
// Motor determinístico dos Relatórios Inteligentes (reports_catalog.v1).
// Todas as métricas derivam de finance_contract.v2 (src/lib/engine/facts).
import {
  behavioralMetricAmount,
  computeTotalCash,
  computeCreditCardOutstanding,
  round2,
  type TransactionRow,
} from "../finance-core/facts.ts";
import { eachDay, resolvePeriods, shortDay, daysInPeriod } from "./periods.ts";
import { detectHighlights } from "./highlights.ts";
import {
  REPORTS_CATALOG_VERSION,
  REPORT_TEMPLATE_VERSION,
  type CategorySlice,
  type DataQualityFlag,
  type DataQualityStatus,
  type HealthComponent,
  type IntelligentReport,
  type ReportEngineInput,
  type ReportMetric,
  type ReportPayload,
  type ReportPeriod,
  type SeriesPoint,
} from "./types.ts";

const ESSENTIAL_RX = /moradia|aluguel|condom[ií]nio|financiamento|d[ií]vida|empr[eé]stimo|sa[uú]de|seguro|educa[çc][aã]o|imposto|energia|[aá]gua|internet|transporte|mercado|aliment/i;
const FLEXIBLE_RX = /lazer|restaurante|delivery|bar|ifood|assinatura|streaming|vestu[aá]rio|beleza|presente|viagem|jogo/i;

export function isEssentialCategory(name: string): boolean {
  return ESSENTIAL_RX.test(name);
}
export function isFlexibleCategory(name: string): boolean {
  return FLEXIBLE_RX.test(name) && !ESSENTIAL_RX.test(name);
}

function inRange(dateStr: string, period: ReportPeriod): boolean {
  return dateStr >= period.start && dateStr <= period.end;
}

function categoryNameOf(t: TransactionRow, names: Record<string, string>): string {
  const id = t.category_id ?? "";
  return (id && names[id]) || "Sem categoria";
}

function expenseOf(t: TransactionRow): number {
  return behavioralMetricAmount(t, "expense");
}
function incomeOf(t: TransactionRow): number {
  return behavioralMetricAmount(t, "income");
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return round2(((current - previous) / previous) * 100);
}

function buildCategories(
  current: TransactionRow[],
  previous: TransactionRow[],
  names: Record<string, string>,
  totalExpense: number,
): CategorySlice[] {
  const cur = new Map<string, { total: number; count: number }>();
  for (const t of current) {
    const amount = expenseOf(t);
    if (amount === 0) continue;
    const key = categoryNameOf(t, names);
    const acc = cur.get(key) ?? { total: 0, count: 0 };
    acc.total = round2(acc.total + amount);
    if (amount > 0) acc.count += 1;
    cur.set(key, acc);
  }
  const prev = new Map<string, number>();
  for (const t of previous) {
    const amount = expenseOf(t);
    if (amount === 0) continue;
    const key = categoryNameOf(t, names);
    prev.set(key, round2((prev.get(key) ?? 0) + amount));
  }
  return [...cur.entries()]
    .filter(([, v]) => v.total > 0)
    .map(([category, v]) => {
      const previousTotal = prev.get(category) ?? 0;
      return {
        category,
        total: v.total,
        count: v.count,
        share: totalExpense > 0 ? v.total / totalExpense : 0,
        previous: previousTotal,
        deltaPct: pctDelta(v.total, previousTotal),
      };
    })
    .sort((a, b) => b.total - a.total);
}

function buildSeries(period: ReportPeriod, txns: TransactionRow[]): SeriesPoint[] {
  const byDay = new Map<string, { expense: number; income: number }>();
  for (const t of txns) {
    const acc = byDay.get(t.occurred_at) ?? { expense: 0, income: 0 };
    acc.expense = round2(acc.expense + expenseOf(t));
    acc.income = round2(acc.income + incomeOf(t));
    byDay.set(t.occurred_at, acc);
  }
  let cumulative = 0;
  return eachDay(period).map((date) => {
    const d = byDay.get(date) ?? { expense: 0, income: 0 };
    cumulative = round2(cumulative + d.expense);
    return { label: shortDay(date), date, expense: d.expense, income: d.income, cumulativeExpense: cumulative };
  });
}

function buildHealth(payload: ReportPayload, quality: DataQualityFlag[]): { score: number; breakdown: HealthComponent[] } {
  const { totals } = payload;
  const components: HealthComponent[] = [];

  // 1. Sobra do período (0–3,5)
  const rate = totals.savingsRate;
  let saving = 0;
  if (rate === null) saving = 0.5;
  else if (rate >= 0.2) saving = 3.5;
  else if (rate >= 0.1) saving = 2.8;
  else if (rate >= 0.05) saving = 2;
  else if (rate >= 0) saving = 1.2;
  components.push({
    key: "savings",
    label: "Sobra do período",
    score: saving,
    max: 3.5,
    detail: rate === null ? "Sem receita registrada no período." : `Sobra de ${(rate * 100).toFixed(1)}% da receita.`,
  });

  // 2. Controle de gastos vs período anterior (0–2,5)
  const delta = totals.expenseDeltaPct;
  let control = 1.2;
  if (delta === null) control = 1.2;
  else if (delta <= -10) control = 2.5;
  else if (delta <= 0) control = 2.1;
  else if (delta <= 10) control = 1.5;
  else if (delta <= 25) control = 0.9;
  else control = 0.3;
  components.push({
    key: "control",
    label: "Controle de gastos",
    score: control,
    max: 2.5,
    detail: delta === null ? "Sem período anterior comparável." : `Despesa ${delta >= 0 ? "subiu" : "caiu"} ${Math.abs(delta).toFixed(1)}% vs período anterior.`,
  });

  // 3. Composição essencial vs flexível (0–2)
  const flexShare = totals.expense > 0 ? totals.flexibleTotal / totals.expense : 0;
  let composition = 1;
  if (totals.expense <= 0) composition = 1;
  else if (flexShare <= 0.15) composition = 2;
  else if (flexShare <= 0.3) composition = 1.6;
  else if (flexShare <= 0.45) composition = 1;
  else composition = 0.4;
  components.push({
    key: "composition",
    label: "Composição dos gastos",
    score: composition,
    max: 2,
    detail: `${(flexShare * 100).toFixed(0)}% das despesas em categorias flexíveis.`,
  });

  // 4. Consistência de registro (0–1)
  const days = daysInPeriod(payload.period);
  const coverage = days > 0 ? totals.daysWithExpense / days : 0;
  const consistency = coverage >= 0.6 ? 1 : coverage >= 0.35 ? 0.7 : coverage > 0 ? 0.4 : 0;
  components.push({
    key: "consistency",
    label: "Consistência de registro",
    score: consistency,
    max: 1,
    detail: `${totals.daysWithExpense} de ${days} dias com lançamento.`,
  });

  // 5. Qualidade dos dados (0–1)
  const blocking = quality.filter((q) => q.severity === "blocking").length;
  const attention = quality.filter((q) => q.severity === "attention").length;
  const dataScore = blocking > 0 ? 0.2 : attention > 0 ? 0.6 : 1;
  components.push({
    key: "data_quality",
    label: "Qualidade dos dados",
    score: dataScore,
    max: 1,
    detail: quality.length === 0 ? "Nenhum alerta de qualidade." : quality.map((q) => q.label).join("; "),
  });

  const total = components.reduce((sum, c) => sum + c.score, 0);
  return { score: round2(Math.max(0, Math.min(10, total))), breakdown: components };
}

function buildQualityFlags(payload: ReportPayload, txCount: number): { flags: DataQualityFlag[]; status: DataQualityStatus } {
  const flags: DataQualityFlag[] = [];
  const uncategorized = payload.categories.find((c) => c.category === "Sem categoria");
  if (uncategorized && uncategorized.share >= 0.15) {
    flags.push({
      key: "uncategorized",
      label: `${(uncategorized.share * 100).toFixed(0)}% das despesas sem categoria`,
      severity: "attention",
      detail: `${uncategorized.count} lançamentos sem categoria somam R$ ${uncategorized.total.toFixed(2)}.`,
    });
  }
  if (payload.totals.income <= 0) {
    flags.push({
      key: "no_income",
      label: "Nenhuma receita registrada",
      severity: "attention",
      detail: "Sem receita no período, a taxa de sobra não pode ser calculada.",
    });
  }
  if (txCount < 3) {
    flags.push({
      key: "low_volume",
      label: "Volume de lançamentos muito baixo",
      severity: "blocking",
      detail: `Apenas ${txCount} lançamento(s) no período — leitura limitada.`,
    });
  }
  const status: DataQualityStatus = flags.some((f) => f.severity === "blocking")
    ? "insufficient"
    : flags.length > 0
      ? "attention"
      : "ok";
  return { flags, status };
}

function buildMetrics(payload: ReportPayload): ReportMetric[] {
  const t = payload.totals;
  const top = payload.categories[0];
  const metrics: ReportMetric[] = [
    { key: "income_total", label: "Receitas", value: t.income, comparison: t.previousIncome, comparisonPct: pctDelta(t.income, t.previousIncome), unit: "BRL", order: 1 },
    { key: "expense_total", label: "Despesas", value: t.expense, comparison: t.previousExpense, comparisonPct: t.expenseDeltaPct, unit: "BRL", order: 2 },
    { key: "net_result", label: "Resultado do período", value: t.net, unit: "BRL", order: 3 },
    { key: "savings_rate", label: "Taxa de sobra", value: t.savingsRate === null ? null : round2(t.savingsRate * 100), unit: "pct", order: 4 },
    { key: "daily_avg_expense", label: "Gasto médio por dia", value: t.dailyAvgExpense, unit: "BRL", order: 5 },
    { key: "days_with_expense", label: "Dias com gasto", value: t.daysWithExpense, unit: "days", order: 6 },
    { key: "transaction_count", label: "Lançamentos", value: t.transactionCount, unit: "count", order: 7 },
    { key: "essential_total", label: "Gastos essenciais", value: t.essentialTotal, unit: "BRL", order: 8 },
    { key: "flexible_total", label: "Gastos flexíveis", value: t.flexibleTotal, unit: "BRL", order: 9 },
    { key: "card_outstanding", label: "Cartão em aberto", value: t.cardOutstanding, unit: "BRL", order: 10 },
    { key: "cash_total", label: "Saldo em contas", value: t.cashTotal, unit: "BRL", order: 11 },
  ];
  if (top) {
    metrics.push({
      key: "top_category",
      label: "Maior categoria",
      value: top.total,
      text: top.category,
      comparison: top.previous,
      comparisonPct: top.deltaPct,
      unit: "BRL",
      evidence: { category: top.category, share: round2(top.share * 100), count: top.count },
      order: 12,
    });
  }
  if (t.biggestExpense) {
    metrics.push({
      key: "biggest_expense",
      label: "Maior gasto individual",
      value: t.biggestExpense.amount,
      text: t.biggestExpense.description,
      unit: "BRL",
      evidence: { ...t.biggestExpense },
      order: 13,
    });
  }
  return metrics;
}

export function buildIntelligentReport(input: ReportEngineInput): IntelligentReport {
  const { period, previous } = resolvePeriods(input.reportType, input.referenceDate);
  const names = input.categoryNames ?? {};
  const all = input.transactions ?? [];
  const current = all.filter((t) => inRange(t.occurred_at, period));
  const prior = all.filter((t) => inRange(t.occurred_at, previous));

  let income = 0;
  let expense = 0;
  let txCount = 0;
  const expenseDays = new Set<string>();
  let biggest: ReportPayload["totals"]["biggestExpense"] = null;
  let essential = 0;
  let flexible = 0;

  for (const t of current) {
    const inc = incomeOf(t);
    const exp = expenseOf(t);
    if (inc === 0 && exp === 0) continue;
    txCount += 1;
    income = round2(income + inc);
    expense = round2(expense + exp);
    if (exp > 0) {
      expenseDays.add(t.occurred_at);
      const cat = categoryNameOf(t, names);
      if (isFlexibleCategory(cat)) flexible = round2(flexible + exp);
      else if (isEssentialCategory(cat)) essential = round2(essential + exp);
      if (!biggest || exp > biggest.amount) {
        biggest = {
          description: (((t as { friendly_description?: string | null }).friendly_description) || t.description || cat || "Lançamento").slice(0, 80),
          amount: exp,
          date: t.occurred_at,
          category: cat,
        };
      }
    }
  }

  let previousExpense = 0;
  let previousIncome = 0;
  for (const t of prior) {
    previousExpense = round2(previousExpense + expenseOf(t));
    previousIncome = round2(previousIncome + incomeOf(t));
  }

  const categories = buildCategories(current, prior, names, expense);
  const series = buildSeries(period, current);
  const goalContribByGoal = new Map<string, number>();
  for (const c of input.goalContributions ?? []) {
    goalContribByGoal.set(c.goal_id, round2((goalContribByGoal.get(c.goal_id) ?? 0) + Number(c.amount || 0)));
  }
  const goals = (input.goals ?? [])
    .filter((g) => (g.status ?? "active") === "active")
    .map((g) => {
      const target = Number(g.target_amount || 0);
      const currentAmount = goalContribByGoal.get(g.id) ?? 0;
      return {
        name: g.name,
        current: currentAmount,
        target,
        progress: target > 0 ? Math.min(1, currentAmount / target) : 0,
      };
    })
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 4);

  const payload: ReportPayload = {
    version: REPORTS_CATALOG_VERSION,
    reportType: input.reportType,
    period,
    previousPeriod: previous,
    totals: {
      income,
      expense,
      net: round2(income - expense),
      savingsRate: income > 0 ? round2((income - expense) / income) : null,
      previousExpense,
      previousIncome,
      expenseDeltaPct: pctDelta(expense, previousExpense),
      dailyAvgExpense: expenseDays.size > 0 ? round2(expense / expenseDays.size) : 0,
      daysWithExpense: expenseDays.size,
      transactionCount: txCount,
      biggestExpense: biggest,
      essentialTotal: essential,
      flexibleTotal: flexible,
      cardOutstanding: round2(computeCreditCardOutstanding(all)),
      cashTotal: round2(computeTotalCash(input.accounts ?? [], all, input.balanceSnapshots ?? [])),
    },
    categories,
    series,
    goals,
  };

  const quality = buildQualityFlags(payload, txCount);
  const health = buildHealth(payload, quality.flags);

  return {
    reportType: input.reportType,
    period,
    previousPeriod: previous,
    metrics: buildMetrics(payload),
    highlights: detectHighlights(payload),
    healthScore: health.score,
    healthBreakdown: health.breakdown,
    dataQualityStatus: quality.status,
    dataQualityFlags: quality.flags,
    payload,
    catalogVersion: REPORTS_CATALOG_VERSION,
    templateVersion: REPORT_TEMPLATE_VERSION,
  };
}
