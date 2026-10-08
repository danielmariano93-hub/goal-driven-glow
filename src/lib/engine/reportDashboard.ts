// Painel de Relatórios (`report_dashboard.v1`).
//
// Uma única leitura do período escolhido, sem a pessoa ter de escolher "tipo de
// relatório": totais com variação sobre o período anterior, evolução, para onde
// vai o dinheiro (categoria → estabelecimento, com participação no todo),
// "o que mudou", hábitos (melhorou/piorou), um VEREDITO explícito (melhor, igual
// ou pior) e destaques acionáveis.
//
// Verdade canônica: o livro já vem por competência, líquido de estornos e sem
// transferências/fatura/investimentos (`insights/executive/load.ts`). Módulo
// puro e determinístico, sem I/O; espelhado para as Edge Functions.

export const REPORT_DASHBOARD_VERSION = "report_dashboard.v1";

export interface DashEntry {
  date: string;
  kind: "expense" | "income";
  /** Despesa: consumo (estorno negativo). Receita: valor positivo. */
  amount: number;
  category_id: string | null;
  category: string;
  merchant_key: string | null;
  merchant: string | null;
}

export type CompareMode = "previous" | "year" | "none";
export type Granularity = "day" | "week" | "month";

export interface DashboardRequest {
  /** Hoje (YYYY-MM-DD, fuso do usuário). */
  today: string;
  start: string;
  end: string;
  compare: CompareMode;
  categoryIds?: string[];
  merchant?: string;
}

export interface DashRange { start: string; end: string; days: number }

export interface Totals {
  income: number;
  /** Saída bruta do período (igual à Home): estornos NÃO abatem aqui, aparecem em `refunds`. */
  expense: number;
  /** Estornos/reembolsos recebidos no período (voltaram para a conta). */
  refunds: number;
  net: number;
  savingsRate: number | null;
  count: number;
  dailyAvg: number;
}

export interface Delta { abs: number; pct: number | null }

export interface SeriesPoint {
  key: string;
  label: string;
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  previousExpense: number | null;
}

export interface MerchantRow {
  key: string;
  label: string;
  total: number;
  /** Participação na categoria (0..1). */
  share: number;
  previous: number;
  deltaPct: number | null;
}

export interface DashCategoryRow {
  id: string;
  name: string;
  total: number;
  /** Participação no gasto total (0..1). */
  share: number;
  count: number;
  previous: number;
  /** Mês passado INTEIRO, só quando a comparação usa uma janela parcial (ex.: dias 1–8). Contas que vencem em
   *  outra data (energia no dia 10) não aparecem na janela; este número evita ler isso como "novo". */
  previousMonth?: number | null;
  deltaAbs: number;
  deltaPct: number | null;
  /** Últimos 6 meses (o último é o mês do fim do período). */
  spark: number[];
  merchants: MerchantRow[];
}

export type Direction = "better" | "worse" | "same" | "unknown";

export interface Habit {
  key: string;
  label: string;
  unit: "pct" | "brl" | "count";
  value: number | null;
  previous: number | null;
  /** pct: pontos percentuais; brl/count: diferença absoluta. */
  delta: number | null;
  deltaPct: number | null;
  direction: Direction;
  detail: string;
}

export interface VerdictSignal {
  key: string;
  label: string;
  tone: "good" | "bad" | "neutral";
  detail: string;
  points: number;
}

export type VerdictKind = "better" | "same" | "worse" | "insufficient";

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  summary: string;
  points: number;
  signals: VerdictSignal[];
}

export interface DashHighlight {
  id: string;
  tone: "positive" | "negative" | "neutral";
  title: string;
  body: string;
  action: { label: string; route: string } | null;
}

export interface TrendMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  partial: boolean;
}

export interface ReportDashboard {
  version: typeof REPORT_DASHBOARD_VERSION;
  request: DashboardRequest;
  period: DashRange;
  previous: DashRange | null;
  granularity: Granularity;
  /** Filtro ativo: só despesa é calculada (renda e veredito não se aplicam). */
  filtered: boolean;
  totals: Totals;
  previousTotals: Totals | null;
  deltas: { income: Delta; expense: Delta; net: Delta; dailyAvg: Delta; savingsRatePoints: number | null } | null;
  series: SeriesPoint[];
  categories: DashCategoryRow[];
  change: {
    previousTotal: number;
    currentTotal: number;
    ups: Array<{ name: string; delta: number }>;
    downs: Array<{ name: string; delta: number }>;
    other: number;
  } | null;
  habits: Habit[];
  trend: { months: TrendMonth[]; direction: Direction; detail: string };
  verdict: Verdict | null;
  highlights: DashHighlight[];
  projection: { expense: number; daysElapsed: number; daysInMonth: number; previousMonthExpense: number | null } | null;
  filterOptions: { categories: Array<{ id: string; name: string; total: number }> };
  coverage: { firstDate: string | null; monthsOfHistory: number; comparisonAvailable: boolean };
}

// ---------------------------------------------------------------------------
// Datas (civis, UTC) e período de comparação
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => fromMs(toMs(iso) + n * DAY);
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY) + 1;
const monthOf = (iso: string) => iso.slice(0, 7);
const endOfMonth = (iso: string) => fromMs(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));

function addMonths(iso: string, delta: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + delta;
  const day = Number(iso.slice(8, 10));
  const first = Date.UTC(y, m, 1);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fromMs(first + (Math.min(day, last) - 1) * DAY);
}

function shiftMonthKey(ym: string, delta: number): string {
  return addMonths(`${ym}-01`, delta).slice(0, 7);
}

const range = (start: string, end: string): DashRange => ({ start, end, days: Math.max(1, daysBetween(start, end)) });

/**
 * Período de comparação:
 *  - "previous": para períodos alinhados ao mês (começam no dia 1), o(s) mês(es)
 *    anterior(es) com a MESMA janela de dias (mês em andamento vs. os mesmos dias
 *    do mês passado); para os demais, os dias imediatamente anteriores;
 *  - "year": o mesmo intervalo, um ano antes.
 */
export function comparisonRange(period: DashRange, mode: CompareMode): DashRange | null {
  if (mode === "none") return null;
  if (mode === "year") return range(addMonths(period.start, -12), addMonths(period.end, -12));
  if (period.start.slice(8, 10) === "01") {
    const span = (Number(period.end.slice(0, 4)) * 12 + Number(period.end.slice(5, 7)))
      - (Number(period.start.slice(0, 4)) * 12 + Number(period.start.slice(5, 7))) + 1;
    const prevStart = addMonths(period.start, -span);
    const prevMonthEnd = endOfMonth(addMonths(period.end, -span));
    const fullMonths = period.end === endOfMonth(period.end);
    const wanted = addDays(prevStart, period.days - 1);
    return range(prevStart, fullMonths ? prevMonthEnd : wanted < prevMonthEnd ? wanted : prevMonthEnd);
  }
  const prevEnd = addDays(period.start, -1);
  return range(addDays(prevEnd, -(period.days - 1)), prevEnd);
}

export function granularityFor(days: number): Granularity {
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}

// ---------------------------------------------------------------------------
// Utilidades de cálculo
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const pctText = (ratio: number) => `${Math.round(Math.abs(ratio) * 100)}%`;
/** Taxa com sinal: poupança negativa (gastou mais do que entrou) aparece como −83%, nunca como 83%. */
const rateText = (ratio: number) => `${ratio < 0 ? "−" : ""}${Math.round(Math.abs(ratio) * 100)}%`;
const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const ESSENTIAL_RX = /moradia|aluguel|condom|energia|luz\b|agua|internet|telefon|saude|educa|escola|faculdade|divida|emprestimo|financiamento|imposto|tributo|seguro|mercado|supermercado|dizimo|oferta|doa[cç]|pens[aã]o|tarifa|juros/;
const SUBSCRIPTION_RX = /assinatura|streaming|software/;
export const isEssentialCategory = (name: string) => ESSENTIAL_RX.test(norm(name));

const inRange = (e: DashEntry, r: DashRange) => e.date >= r.start && e.date <= r.end;

function totalsOf(entries: DashEntry[], r: DashRange, daysForAvg: number): Totals {
  let income = 0;
  let expense = 0;
  let refunds = 0;
  let count = 0;
  for (const e of entries) {
    if (!inRange(e, r)) continue;
    if (e.kind === "income") income += e.amount;
    else if (e.amount > 0) {
      expense += e.amount;
      count += 1;
    } else {
      // Estorno de uma compra: entrada de dinheiro, nunca "gasto negativo" que
      // esconde os gastos reais do mesmo dia.
      refunds += -e.amount;
    }
  }
  income = round2(Math.max(0, income));
  expense = round2(expense);
  refunds = round2(refunds);
  const net = round2(income + refunds - expense);
  return {
    income, expense, refunds, net,
    savingsRate: income > 0 ? round2(net / income) : null,
    count,
    dailyAvg: round2(expense / Math.max(1, daysForAvg)),
  };
}

function delta(current: number, previous: number): Delta {
  return { abs: round2(current - previous), pct: previous > 0 ? round2((current - previous) / previous) : null };
}

function direction(current: number | null, previous: number | null, higherIsBetter: boolean, relTolerance = 0.05, absFloor = 0): Direction {
  if (current == null || previous == null) return "unknown";
  const diff = current - previous;
  const tolerance = Math.max(absFloor, Math.abs(previous) * relTolerance);
  if (Math.abs(diff) <= tolerance) return "same";
  return (diff > 0) === higherIsBetter ? "better" : "worse";
}

// ---------------------------------------------------------------------------
// Série (granularidade automática)
// ---------------------------------------------------------------------------

interface Bucket { key: string; label: string; from: string; to: string }

function bucketsOf(r: DashRange, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  if (g === "month") {
    for (let m = monthOf(r.start); m <= monthOf(r.end) && out.length < 40; m = shiftMonthKey(m, 1)) {
      const from = m === monthOf(r.start) ? r.start : `${m}-01`;
      const to = m === monthOf(r.end) ? r.end : endOfMonth(`${m}-01`);
      out.push({ key: m, label: `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`, from, to });
    }
    return out;
  }
  const step = g === "day" ? 1 : 7;
  for (let from = r.start; from <= r.end && out.length < 400; from = addDays(from, step)) {
    const to = addDays(from, step - 1) > r.end ? r.end : addDays(from, step - 1);
    out.push({ key: from, label: `${from.slice(8, 10)}/${from.slice(5, 7)}`, from, to });
  }
  return out;
}

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

export function buildReportDashboard(entries: DashEntry[], req: DashboardRequest): ReportDashboard {
  const period = range(req.start, req.end);
  const previous = comparisonRange(period, req.compare);
  // Janela parcial do mês anterior (dias 1–8)? Guardamos também o mês inteiro como contexto por categoria.
  const previousMonthRange: DashRange | null = previous && previous.end !== endOfMonth(previous.end) && req.compare === "previous"
    ? range(previous.start, endOfMonth(previous.end)) : null;
  const granularity = granularityFor(period.days);
  const categoryFilter = req.categoryIds?.length ? new Set(req.categoryIds) : null;
  const merchantTerm = req.merchant ? norm(req.merchant).trim() : "";
  const filtered = Boolean(categoryFilter || merchantTerm);

  const matchesMerchant = (e: DashEntry) => !merchantTerm
    || norm(e.merchant ?? "").includes(merchantTerm) || norm(e.merchant_key ?? "").includes(merchantTerm);
  const scoped = filtered
    ? entries.filter((e) => e.kind === "expense" && (!categoryFilter || (e.category_id != null && categoryFilter.has(e.category_id))) && matchesMerchant(e))
    : entries;

  // Dias efetivamente decorridos (período em andamento não divide por dias futuros).
  const elapsed = (r: DashRange) => (r.end > req.today ? Math.max(1, daysBetween(r.start, req.today)) : r.days);
  const totals = totalsOf(scoped, period, elapsed(period));
  const previousTotals = previous ? totalsOf(scoped, previous, previous.days) : null;

  const deltas = previousTotals ? {
    income: delta(totals.income, previousTotals.income),
    expense: delta(totals.expense, previousTotals.expense),
    net: delta(totals.net, previousTotals.net),
    dailyAvg: delta(totals.dailyAvg, previousTotals.dailyAvg),
    savingsRatePoints: totals.savingsRate != null && previousTotals.savingsRate != null
      ? round2((totals.savingsRate - previousTotals.savingsRate) * 100) : null,
  } : null;

  // Série
  const buckets = bucketsOf(period, granularity);
  const prevBuckets = previous ? bucketsOf(previous, granularity) : [];
  const series: SeriesPoint[] = buckets.map((b, i) => {
    const t = totalsOf(scoped, { start: b.from, end: b.to, days: 1 }, 1);
    const pb = prevBuckets[i];
    return {
      key: b.key, label: b.label, from: b.from, to: b.to,
      income: t.income, expense: t.expense, net: t.net,
      previousExpense: pb ? totalsOf(scoped, { start: pb.from, end: pb.to, days: 1 }, 1).expense : null,
    };
  });

  // Categorias → estabelecimentos
  type Acc = { id: string; name: string; total: number; count: number; previous: number; previousMonth: number; byMonth: Map<string, number>; merchants: Map<string, { label: string; total: number; previous: number }> };
  const cats = new Map<string, Acc>();
  const touch = (e: DashEntry): Acc => {
    const id = e.category_id ?? "__none__";
    let c = cats.get(id);
    if (!c) {
      c = { id, name: e.category_id ? e.category : "Sem categoria", total: 0, count: 0, previous: 0, previousMonth: 0, byMonth: new Map(), merchants: new Map() };
      cats.set(id, c);
    }
    return c;
  };
  const sparkMonths = Array.from({ length: 6 }, (_, i) => shiftMonthKey(monthOf(period.end), i - 5));
  const sparkFloor = `${sparkMonths[0]}-01`;
  for (const e of scoped) {
    if (e.kind !== "expense" || e.amount <= 0) continue;
    const inCurrent = inRange(e, period);
    const inPrevious = previous ? inRange(e, previous) : false;
    const inPreviousMonth = previousMonthRange ? inRange(e, previousMonthRange) : false;
    const inSpark = e.date >= sparkFloor && e.date <= endOfMonth(`${monthOf(period.end)}-01`);
    if (!inCurrent && !inPrevious && !inPreviousMonth && !inSpark) continue;
    const c = touch(e);
    const mk = e.merchant_key ?? "__none__";
    const m = c.merchants.get(mk) ?? { label: e.merchant ?? "Sem identificação", total: 0, previous: 0 };
    if (inCurrent) { c.total += e.amount; if (e.amount > 0) c.count += 1; m.total += e.amount; }
    if (inPrevious) { c.previous += e.amount; m.previous += e.amount; }
    if (inPreviousMonth) c.previousMonth += e.amount;
    if (inSpark) c.byMonth.set(monthOf(e.date), (c.byMonth.get(monthOf(e.date)) ?? 0) + e.amount);
    c.merchants.set(mk, m);
  }
  const expenseTotal = totals.expense;
  const allCats = [...cats.values()];
  const categories: DashCategoryRow[] = allCats
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => {
      const rows: MerchantRow[] = [...c.merchants.entries()]
        .filter(([, m]) => m.total > 0)
        .map(([key, m]) => ({
          key, label: m.label, total: round2(m.total), share: c.total > 0 ? round2(m.total / c.total) : 0,
          previous: round2(Math.max(0, m.previous)), deltaPct: m.previous > 0 ? round2((m.total - m.previous) / m.previous) : null,
        }))
        .sort((a, b) => b.total - a.total);
      const top = rows.slice(0, 6);
      const rest = rows.slice(6);
      if (rest.length) {
        const total = round2(sum(rest.map((r) => r.total)));
        top.push({ key: "__others__", label: "Outros", total, share: c.total > 0 ? round2(total / c.total) : 0, previous: round2(sum(rest.map((r) => r.previous))), deltaPct: null });
      }
      return {
        id: c.id, name: c.name, total: round2(c.total),
        share: expenseTotal > 0 ? round2(c.total / expenseTotal) : 0,
        count: c.count, previous: round2(Math.max(0, c.previous)),
        previousMonth: previousMonthRange ? round2(Math.max(0, c.previousMonth)) : null,
        deltaAbs: round2(c.total - Math.max(0, c.previous)),
        deltaPct: c.previous > 0 ? round2((c.total - c.previous) / c.previous) : null,
        spark: sparkMonths.map((m) => round2(Math.max(0, c.byMonth.get(m) ?? 0))),
        merchants: top,
      };
    });

  // O que mudou (cascata): categorias que mais empurraram o gasto para cima/baixo.
  let change: ReportDashboard["change"] = null;
  if (previous && previousTotals) {
    const moves = allCats.map((c) => ({ name: c.name, delta: round2(c.total - Math.max(0, c.previous)) })).filter((m) => Math.abs(m.delta) >= 1);
    const ups = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4);
    const downs = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
    const shown = sum(ups.map((m) => m.delta)) + sum(downs.map((m) => m.delta));
    change = {
      previousTotal: previousTotals.expense, currentTotal: totals.expense, ups, downs,
      other: round2((totals.expense - previousTotals.expense) - shown),
    };
  }

  // Tendência: 6 meses até o fim do período (mês aberto não conta para a direção).
  const trendMonths: TrendMonth[] = sparkMonths.map((month) => {
    const t = totalsOf(scoped, { start: `${month}-01`, end: endOfMonth(`${month}-01`), days: 1 }, 1);
    return { month, income: t.income, expense: t.expense, net: t.net, savingsRate: t.savingsRate, partial: month >= monthOf(req.today) };
  });
  const closed = trendMonths.filter((m) => !m.partial);
  const trend = trendOf(closed, filtered);

  // Hábitos
  const habits = filtered ? [] : buildHabits({ entries: scoped.filter((e) => e.kind !== "expense" || e.amount > 0), period, previous, totals, previousTotals, categories, req, elapsedDays: elapsed(period) });

  // Veredito
  const verdict = filtered ? null : buildVerdict({ totals, previousTotals, deltas, categories, habits, trend, comparing: previous != null, tooEarly: period.end >= req.today && elapsed(period) < 3 });

  // Projeção do mês em andamento
  let projection: ReportDashboard["projection"] = null;
  if (elapsed(period) >= 3 && totals.expense > 0 && period.start.slice(8, 10) === "01" && period.end >= req.today && monthOf(period.start) === monthOf(req.today) && monthOf(period.end) === monthOf(req.today)) {
    const daysElapsed = Math.max(1, daysBetween(period.start, req.today));
    const daysInMonth = daysBetween(period.start, endOfMonth(period.start));
    const prevMonth = shiftMonthKey(monthOf(period.start), -1);
    const prevMonthExpense = totalsOf(scoped, { start: `${prevMonth}-01`, end: endOfMonth(`${prevMonth}-01`), days: 1 }, 1).expense;
    projection = {
      expense: round2(totals.expense / daysElapsed * daysInMonth), daysElapsed, daysInMonth,
      previousMonthExpense: prevMonthExpense > 0 ? prevMonthExpense : null,
    };
  }

  const highlights = buildHighlights({ totals, previousTotals, deltas, categories, habits, trend, projection, filtered });

  // Opções de filtro (independem do filtro de categoria ativo).
  const optionTotals = new Map<string, { id: string; name: string; total: number }>();
  for (const e of entries) {
    if (e.kind !== "expense" || e.amount <= 0 || !inRange(e, period) || !e.category_id) continue;
    const o = optionTotals.get(e.category_id) ?? { id: e.category_id, name: e.category, total: 0 };
    o.total += e.amount;
    optionTotals.set(e.category_id, o);
  }
  const first = entries.reduce<string | null>((min, e) => (!min || e.date < min ? e.date : min), null);
  const monthsOfHistory = first ? Math.max(1, (Number(req.today.slice(0, 4)) * 12 + Number(req.today.slice(5, 7))) - (Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7))) + 1) : 0;

  return {
    version: REPORT_DASHBOARD_VERSION,
    request: req, period, previous, granularity, filtered,
    totals, previousTotals, deltas, series, categories, change, habits, trend, verdict, highlights, projection,
    filterOptions: { categories: [...optionTotals.values()].filter((o) => o.total > 0).map((o) => ({ ...o, total: round2(o.total) })).sort((a, b) => b.total - a.total) },
    coverage: {
      firstDate: first, monthsOfHistory,
      comparisonAvailable: previous != null && first != null && first <= previous.end,
    },
  };
}

function trendOf(closed: TrendMonth[], filtered: boolean): ReportDashboard["trend"] {
  const withMoney = closed.filter((m) => (filtered ? m.expense > 0 : m.income > 0 || m.expense > 0));
  if (withMoney.length < 4) return { months: closed, direction: "unknown", detail: "Ainda há poucos meses fechados para ler a tendência." };
  const half = Math.floor(withMoney.length / 2);
  const older = withMoney.slice(0, half);
  const recent = withMoney.slice(-half);
  const avg = (list: TrendMonth[], pick: (m: TrendMonth) => number) => sum(list.map(pick)) / Math.max(1, list.length);
  if (!filtered) {
    const rates = (list: TrendMonth[]) => list.filter((m) => m.savingsRate != null).map((m) => m.savingsRate as number);
    const a = rates(older);
    const b = rates(recent);
    if (a.length && b.length) {
      const before = sum(a) / a.length;
      const after = sum(b) / b.length;
      const points = (after - before) * 100;
      const dir: Direction = Math.abs(points) < 3 ? "same" : points > 0 ? "better" : "worse";
      return {
        months: closed, direction: dir,
        detail: dir === "same"
          ? `Sua taxa de poupança está estável em torno de ${rateText(after)}.`
          : `Sua taxa de poupança ${dir === "better" ? "subiu" : "caiu"} de ${rateText(before)} para ${rateText(after)} nos meses mais recentes.`,
      };
    }
  }
  const before = avg(older, (m) => m.expense);
  const after = avg(recent, (m) => m.expense);
  const dir = direction(after, before, false);
  return {
    months: closed, direction: dir,
    detail: dir === "same" ? "O gasto mensal está estável." : `O gasto médio mensal ${dir === "better" ? "caiu" : "subiu"} de ${brl(before)} para ${brl(after)} nos meses mais recentes.`,
  };
}

// ---------------------------------------------------------------------------
// Hábitos
// ---------------------------------------------------------------------------

function buildHabits(a: {
  entries: DashEntry[]; period: DashRange; previous: DashRange | null; totals: Totals; previousTotals: Totals | null;
  categories: DashCategoryRow[]; req: DashboardRequest; elapsedDays: number;
}): Habit[] {
  const { entries, period, previous, totals, previousTotals } = a;
  const expenseIn = (r: DashRange | null) => (r ? entries.filter((e) => e.kind === "expense" && inRange(e, r)) : []);
  const cur = expenseIn(period);
  const prev = expenseIn(previous);
  const flexible = (list: DashEntry[]) => round2(Math.max(0, sum(list.filter((e) => !isEssentialCategory(e.category)).map((e) => e.amount))));
  const subs = (list: DashEntry[]) => round2(Math.max(0, sum(list.filter((e) => SUBSCRIPTION_RX.test(norm(e.category))).map((e) => e.amount))));
  const small = (list: DashEntry[]) => list.filter((e) => e.amount > 0 && e.amount < 50).length;
  const weekendShare = (list: DashEntry[]) => {
    const flex = list.filter((e) => !isEssentialCategory(e.category) && e.amount > 0);
    const total = sum(flex.map((e) => e.amount));
    if (total <= 0) return null;
    const wk = sum(flex.filter((e) => { const d = new Date(`${e.date}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; }).map((e) => e.amount));
    return round2(wk / total);
  };
  const habit = (h: Omit<Habit, "delta" | "deltaPct"> & { delta?: number | null; deltaPct?: number | null }): Habit => ({ delta: null, deltaPct: null, ...h });
  const pctDelta = (c: number | null, p: number | null) => (c != null && p != null && p > 0 ? round2((c - p) / p) : null);
  const haveCompare = previous != null && previousTotals != null;

  const flexCur = flexible(cur);
  const flexPrev = haveCompare ? flexible(prev) : null;
  const subCur = subs(cur);
  const subPrev = haveCompare ? subs(prev) : null;
  const smallCur = small(cur);
  const smallPrev = haveCompare ? small(prev) : null;
  const wkCur = weekendShare(cur);
  const wkPrev = haveCompare ? weekendShare(prev) : null;
  const top = a.categories[0];

  const out: Habit[] = [];
  out.push(habit({
    key: "savings", label: "Taxa de poupança", unit: "pct",
    value: totals.savingsRate, previous: previousTotals?.savingsRate ?? null,
    delta: totals.savingsRate != null && previousTotals?.savingsRate != null ? round2((totals.savingsRate - previousTotals.savingsRate) * 100) : null,
    direction: direction(totals.savingsRate, previousTotals?.savingsRate ?? null, true, 0, 0.02),
    detail: totals.savingsRate == null ? "Sem renda registrada no período." : totals.savingsRate < 0 ? `Gastou ${pctText(totals.savingsRate)} a mais do que entrou.` : `Sobrou ${pctText(totals.savingsRate)} do que entrou.`,
  }));
  out.push(habit({
    key: "flexible", label: "Gasto flexível", unit: "brl", value: flexCur, previous: flexPrev,
    delta: flexPrev != null ? round2(flexCur - flexPrev) : null, deltaPct: pctDelta(flexCur, flexPrev),
    direction: direction(flexCur, flexPrev, false, 0.05, 20),
    detail: "Tudo o que não é moradia, contas, saúde, mercado ou dívida: onde dá para escolher.",
  }));
  out.push(habit({
    key: "daily", label: "Gasto por dia", unit: "brl", value: totals.dailyAvg, previous: previousTotals?.dailyAvg ?? null,
    delta: previousTotals ? round2(totals.dailyAvg - previousTotals.dailyAvg) : null, deltaPct: pctDelta(totals.dailyAvg, previousTotals?.dailyAvg ?? null),
    direction: direction(totals.dailyAvg, previousTotals?.dailyAvg ?? null, false, 0.05, 5),
    detail: `Média de ${brl(totals.dailyAvg)} por dia no período.`,
  }));
  out.push(habit({
    key: "subscriptions", label: "Assinaturas", unit: "brl", value: subCur, previous: subPrev,
    delta: subPrev != null ? round2(subCur - subPrev) : null, deltaPct: pctDelta(subCur, subPrev),
    direction: direction(subCur, subPrev, false, 0.05, 10),
    detail: subCur > 0 ? `${brl(subCur)} em serviços recorrentes.` : "Nenhuma assinatura no período.",
  }));
  out.push(habit({
    key: "small", label: "Compras pequenas (< R$ 50)", unit: "count", value: smallCur, previous: smallPrev,
    delta: smallPrev != null ? smallCur - smallPrev : null, deltaPct: pctDelta(smallCur, smallPrev),
    direction: direction(smallCur, smallPrev, false, 0.1, 2),
    detail: "Muitas compras pequenas somam rápido e passam despercebidas.",
  }));
  out.push(habit({
    key: "weekend", label: "Gasto flexível no fim de semana", unit: "pct", value: wkCur, previous: wkPrev,
    delta: wkCur != null && wkPrev != null ? round2((wkCur - wkPrev) * 100) : null,
    direction: direction(wkCur, wkPrev, false, 0, 0.05),
    detail: wkCur == null ? "Sem gasto flexível no período." : `${pctText(wkCur)} do gasto flexível acontece no sábado e no domingo.`,
  }));
  if (top) {
    const prevTop = previous && previousTotals && previousTotals.expense > 0 ? round2(Math.max(0, prev.filter((e) => e.category_id === (top.id === "__none__" ? null : top.id)).reduce((s, e) => s + e.amount, 0)) / previousTotals.expense) : null;
    out.push(habit({
      key: "concentration", label: `Concentração em ${top.name}`, unit: "pct", value: top.share, previous: prevTop,
      delta: prevTop != null ? round2((top.share - prevTop) * 100) : null,
      direction: direction(top.share, prevTop, false, 0, 0.05),
      detail: `${top.name} é ${pctText(top.share)} de tudo o que saiu.`,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Veredito
// ---------------------------------------------------------------------------

function buildVerdict(a: {
  totals: Totals; previousTotals: Totals | null; deltas: ReportDashboard["deltas"]; categories: DashCategoryRow[];
  habits: Habit[]; trend: ReportDashboard["trend"]; comparing: boolean; tooEarly: boolean;
}): Verdict {
  const { totals, previousTotals, deltas, categories, habits, trend } = a;
  const noData = totals.count < 5 && (previousTotals?.count ?? 0) < 5;
  if (a.tooEarly) {
    return {
      kind: "insufficient",
      headline: "Ainda é cedo para dizer",
      summary: "O período mal começou. Com mais alguns dias de lançamentos, o Nino compara com o anterior e diz como você está.",
      points: 0, signals: [],
    };
  }
  if (!a.comparing || !previousTotals || !deltas || noData || (previousTotals.expense <= 0 && previousTotals.income <= 0)) {
    return {
      kind: "insufficient",
      headline: "Ainda não dá para comparar",
      summary: !a.comparing
        ? "Escolha um período de comparação para ver se você está melhor ou pior."
        : "O período anterior não tem lançamentos suficientes. Com mais histórico, o Nino compara e diz como você está.",
      points: 0, signals: [],
    };
  }
  const signals: VerdictSignal[] = [];
  const push = (key: string, label: string, points: number, detail: string) =>
    signals.push({ key, label, points, detail, tone: points > 0 ? "good" : points < 0 ? "bad" : "neutral" });

  const pp = deltas.savingsRatePoints;
  if (pp != null) {
    const points = pp >= 3 ? 2 : pp >= 1 ? 1 : pp <= -3 ? -2 : pp <= -1 ? -1 : 0;
    push("savings", "Poupança", points, `Taxa de poupança ${pp >= 0 ? "+" : "−"}${Math.abs(Math.round(pp))} p.p. (${totals.savingsRate != null ? rateText(totals.savingsRate) : "—"}).`);
  }
  if (previousTotals.net !== 0 || totals.net !== 0) {
    const base = Math.max(1, Math.abs(previousTotals.net));
    const rel = (totals.net - previousTotals.net) / base;
    const points = rel >= 0.1 ? 1 : rel <= -0.1 ? -1 : 0;
    push("net", "Sobra do período", points, `Sobrou ${brl(totals.net)} contra ${brl(previousTotals.net)} antes.`);
  }
  const flex = habits.find((h) => h.key === "flexible");
  if (flex && flex.deltaPct != null) {
    const points = flex.deltaPct <= -0.1 ? 2 : flex.deltaPct <= -0.05 ? 1 : flex.deltaPct >= 0.1 ? -2 : flex.deltaPct >= 0.05 ? -1 : 0;
    push("flexible", "Gasto flexível", points, `${flex.deltaPct >= 0 ? "Subiu" : "Caiu"} ${pctText(flex.deltaPct)} (${brl(flex.value ?? 0)}).`);
  }
  const material = Math.max(100, totals.expense * 0.03);
  const up = categories.filter((c) => c.deltaPct != null && c.deltaPct >= 0.3 && c.deltaAbs >= material);
  const down = categories.filter((c) => c.deltaPct != null && c.deltaPct <= -0.3 && -c.deltaAbs >= material);
  if (up.length || down.length) {
    const points = Math.min(2, down.length) - Math.min(2, up.length);
    const parts = [
      up.length ? `${up.slice(0, 2).map((c) => c.name).join(" e ")} ${up.length > 1 ? "subiram" : "subiu"} bastante` : "",
      down.length ? `${down.slice(0, 2).map((c) => c.name).join(" e ")} ${down.length > 1 ? "caíram" : "caiu"} bastante` : "",
    ].filter(Boolean);
    push("categories", "Categorias", points, `${parts.join("; ")}.`);
  }
  if (trend.direction === "better" || trend.direction === "worse") {
    push("trend", "Tendência de meses", trend.direction === "better" ? 1 : -1, trend.detail);
  }
  const points = sum(signals.map((s) => s.points));
  const kind: VerdictKind = points >= 2 ? "better" : points <= -2 ? "worse" : "same";
  const goods = signals.filter((s) => s.points > 0).length;
  const bads = signals.filter((s) => s.points < 0).length;
  return {
    kind,
    headline: kind === "better" ? "Você está melhor que no período anterior" : kind === "worse" ? "Você está pior que no período anterior" : "Você está parecido com o período anterior",
    summary: kind === "same"
      ? `Sinais positivos e negativos se equilibram (${goods} a favor, ${bads} contra).`
      : `${kind === "better" ? goods : bads} de ${signals.length} sinais ${kind === "better" ? "melhoraram" : "pioraram"}.`,
    points, signals,
  };
}

// ---------------------------------------------------------------------------
// Destaques acionáveis
// ---------------------------------------------------------------------------

function buildHighlights(a: {
  totals: Totals; previousTotals: Totals | null; deltas: ReportDashboard["deltas"]; categories: DashCategoryRow[];
  habits: Habit[]; trend: ReportDashboard["trend"]; projection: ReportDashboard["projection"]; filtered: boolean;
}): DashHighlight[] {
  const { totals, previousTotals, categories, habits, trend, projection } = a;
  const out: Array<DashHighlight & { weight: number }> = [];
  const material = Math.max(100, totals.expense * 0.03);

  const topUp = [...categories].filter((c) => c.deltaPct != null && c.deltaAbs >= material).sort((x, y) => y.deltaAbs - x.deltaAbs)[0];
  if (topUp) {
    const driver = [...topUp.merchants].filter((m) => m.key !== "__others__").sort((x, y) => (y.total - y.previous) - (x.total - x.previous))[0];
    out.push({
      id: `up:${topUp.id}`, tone: "negative", weight: 90,
      title: `${topUp.name} subiu ${brl(topUp.deltaAbs)} (+${pctText(topUp.deltaPct as number)})`,
      body: `${brl(topUp.total)} contra ${brl(topUp.previous)} antes.${driver && driver.total - driver.previous > 0 ? ` O que mais pesou: ${driver.label} (${brl(driver.total)}).` : ""}`,
      action: { label: `Criar meta de ${topUp.name}`, route: "/app/metas" },
    });
  }
  const topDown = [...categories].filter((c) => c.deltaPct != null && -c.deltaAbs >= material).sort((x, y) => x.deltaAbs - y.deltaAbs)[0];
  if (topDown) {
    out.push({
      id: `down:${topDown.id}`, tone: "positive", weight: 70,
      title: `${topDown.name} caiu ${brl(-topDown.deltaAbs)} (−${pctText(topDown.deltaPct as number)})`,
      body: `${brl(topDown.total)} contra ${brl(topDown.previous)} antes. Vale manter o que funcionou.`,
      action: null,
    });
  }
  const top = categories[0];
  if (top && top.share >= 0.3) {
    const m = top.merchants[0];
    out.push({
      id: `concentration:${top.id}`, tone: "neutral", weight: 60,
      title: `${top.name} concentra ${pctText(top.share)} dos seus gastos`,
      body: m && m.key !== "__others__" ? `${m.label} sozinho é ${pctText(m.share)} da categoria (${brl(m.total)}).` : `${brl(top.total)} no período.`,
      action: { label: `Ver ${top.name}`, route: "/app/lancamentos" },
    });
  }
  const savings = habits.find((h) => h.key === "savings");
  if (savings && savings.value != null && savings.previous != null && savings.direction !== "same" && savings.direction !== "unknown") {
    out.push({
      id: "savings", tone: savings.direction === "better" ? "positive" : "negative", weight: 80,
      title: `Taxa de poupança ${savings.direction === "better" ? "subiu" : "caiu"} para ${rateText(savings.value)}`,
      body: `Era ${rateText(savings.previous)} no período anterior.`,
      action: savings.direction === "worse" ? { label: "Ver metas", route: "/app/metas" } : null,
    });
  }
  const subs = habits.find((h) => h.key === "subscriptions");
  if (subs && subs.value != null && subs.value >= Math.max(50, totals.expense * 0.05)) {
    out.push({
      id: "subscriptions", tone: "neutral", weight: 55,
      title: `Assinaturas somam ${brl(subs.value)}`,
      body: "Revise o que você ainda usa: cancelar hoje vale todos os meses seguintes.",
      action: { label: "Revisar assinaturas", route: "/app/lancamentos" },
    });
  }
  if (projection) {
    const base = projection.previousMonthExpense;
    out.push({
      id: "projection", tone: base != null && projection.expense > base * 1.05 ? "negative" : "neutral", weight: 85,
      title: `No ritmo atual, o mês fecha em ${brl(projection.expense)} de gasto`,
      body: base != null
        ? `${projection.expense >= base ? "Acima" : "Abaixo"} do mês passado inteiro (${brl(base)}) em ${brl(Math.abs(projection.expense - base))}.`
        : `Com ${projection.daysElapsed} de ${projection.daysInMonth} dias passados.`,
      action: null,
    });
  }
  if (trend.direction === "better" || trend.direction === "worse") {
    out.push({
      id: "trend", tone: trend.direction === "better" ? "positive" : "negative", weight: 65,
      title: trend.direction === "better" ? "Seus últimos meses estão melhorando" : "Seus últimos meses estão piorando",
      body: trend.detail, action: null,
    });
  }
  if (previousTotals && previousTotals.income > 0 && totals.income > 0 && Math.abs(totals.income - previousTotals.income) / previousTotals.income >= 0.2) {
    const up = totals.income > previousTotals.income;
    out.push({
      id: "income", tone: up ? "positive" : "negative", weight: 50,
      title: `Sua renda ${up ? "subiu" : "caiu"} ${pctText((totals.income - previousTotals.income) / previousTotals.income)}`,
      body: `${brl(totals.income)} contra ${brl(previousTotals.income)} antes.`, action: null,
    });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 6).map(({ weight: _w, ...h }) => h);
}

/** Rótulo curto do período para títulos ("outubro de 2026", "01/10 a 15/10"). */
export function periodTitle(r: DashRange): string {
  const sameMonth = monthOf(r.start) === monthOf(r.end);
  const full = r.start.slice(8, 10) === "01" && r.end === endOfMonth(r.end);
  if (sameMonth && full) return `${MONTH_NAMES[Number(r.start.slice(5, 7)) - 1]} de ${r.start.slice(0, 4)}`;
  const f = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) !== r.end.slice(0, 4) ? `/${d.slice(2, 4)}` : ""}`;
  return `${f(r.start)} a ${f(r.end)}`;
}
