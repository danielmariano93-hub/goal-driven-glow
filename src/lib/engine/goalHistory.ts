// Histórico das metas de gasto (`goal_history.v1`).
//
// A meta é uma SÉRIE por categoria, não um registro por mês: "Transporte em
// setembro" e "Transporte em outubro" são dois meses da mesma história, mesmo
// quando nasceram como metas avulsas. Para cada categoria com meta:
//  - mês a mês desde o primeiro mês com meta (e até 3 meses antes, como
//    referência de "antes da meta");
//  - limite vigente em cada mês, gasto real, cumpriu ou não, maior responsável;
//  - KPIs: meses cumpridos, sequência, economia acumulada frente à referência
//    e variação do gasto desde o início;
//  - placar (categorias × meses) e highlights determinísticos.
//
// Mesma verdade canônica do teto (livro `spending_goals.v1`): despesa real,
// competência, estornos e categoria efetiva. Módulo puro, sem I/O.

import { isObligationCategory, type SpendingEntry } from "./spendingGoals";

export const GOAL_HISTORY_VERSION = "goal_history.v2";

export interface HistoryGoalRow {
  id: string;
  category_id: string;
  computed_limit: number;
  baseline_value?: number | null;
  start_date: string;
  end_date?: string | null;
  period_type?: string | null;
  recurrence_end_date?: string | null;
  status: string;
  created_at?: string | null;
  /** "cycle" = mês guardado no histórico (meta editada ou excluída depois). */
  source?: "goal" | "cycle";
}

export type HistoryMonthStatus = "met" | "missed" | "in_progress" | "no_goal" | "before" | "paused";

export interface HistoryMonth {
  month: string;
  status: HistoryMonthStatus;
  goal_id: string | null;
  /** "cycle" quando o mês vem do histórico guardado (meta editada/excluída). */
  source: "goal" | "cycle" | null;
  limit: number | null;
  actual: number;
  /** Só no mês corrente: fechamento projetado. */
  projected: number | null;
  /** limite − gasto (positivo = sobrou). */
  difference: number | null;
  main_driver: { label: string; amount: number } | null;
}

export interface GoalSeries {
  category_id: string;
  category_name: string;
  /** Meta vigente agora (para abrir o detalhe). */
  current_goal_id: string | null;
  first_month: string;
  /** Referência de antes da meta (média mensal). */
  baseline: number | null;
  months: HistoryMonth[];
  kpis: {
    closed_months: number;
    met_months: number;
    streak: number;
    /** Economia acumulada frente à referência nos meses fechados com meta. */
    savings_total: number | null;
    /** Variação do gasto médio (últimos até 3 meses fechados) frente à referência. */
    change_vs_baseline: number | null;
    direction: "down" | "up" | "stable" | "unknown";
  };
}

export interface GoalHighlight {
  id: string;
  tone: "positive" | "negative" | "neutral";
  title: string;
  body: string;
  category_id: string | null;
}

export interface GoalHistory {
  version: typeof GOAL_HISTORY_VERSION;
  as_of: string;
  current_month: string;
  series: GoalSeries[];
  scoreboard: { months: string[]; rows: Array<{ category_id: string; category_name: string; cells: Array<{ month: string; status: HistoryMonthStatus }> }> };
  highlights: GoalHighlight[];
  impact: GoalImpact;
}

/**
 * Quanto as metas ajudaram (contrafactual): o que provavelmente teria sido
 * gasto sem meta é a média de antes da meta, ajustada pelo quanto os seus
 * OUTROS gastos (categorias sem meta) variaram no mesmo período — diferenças
 * em diferenças. Assim um mês caro "para todo mundo" não vira mérito nem culpa
 * da meta.
 */
export interface GoalImpact {
  closed_goal_months: number;
  categories_tracked: number;
  expected_without_goals: number;
  actual_with_goals: number;
  /** Economia estimada (positivo = gastou menos do que gastaria sem meta). */
  estimated_savings: number;
  /** Variação dos gastos sem meta no mesmo período (o ajuste). */
  control_change: number | null;
  /** Variação das categorias com meta frente a antes. */
  goal_change: number | null;
  /** Efeito líquido (pontos percentuais): com meta − sem meta. */
  net_effect: number | null;
  /** Fatia do gasto do último mês fechado que está sob meta (clareza). */
  coverage_share: number | null;
  months_met: number;
  alerts_delivered: number;
  by_category: Array<{ category_id: string; category_name: string; expected: number; actual: number; savings: number }>;
  headline: string;
  explanation: string;
}

export interface GoalHistoryInput {
  today: string;
  goals: HistoryGoalRow[];
  entries: SpendingEntry[];
  categories: Array<{ id: string; name: string }>;
  /** Leitura do mês corrente já calculada (projeção do teto), por meta. */
  current?: Record<string, { projected: number; status: string }>;
  /** Quantos meses de "antes da meta" mostrar como referência. */
  monthsBefore?: number;
  /** Meses de meta guardados no histórico (sobrevivem a edição/exclusão). */
  cycles?: HistoryGoalRow[];
  /** Avisos do Nino sobre metas já entregues (clareza). */
  alertsDelivered?: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const historyMonthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 60; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Meses cobertos por uma meta (recorrente: do início até o fim da recorrência ou hoje). */
function goalMonths(goal: HistoryGoalRow, current: string): { from: string; to: string } {
  const from = goal.start_date.slice(0, 7);
  const recurring = (goal.period_type ?? (goal.end_date ? "custom" : "monthly_recurring")) === "monthly_recurring";
  if (recurring) {
    const end = goal.recurrence_end_date ? goal.recurrence_end_date.slice(0, 7) : current;
    return { from, to: end < current ? end : current };
  }
  const to = (goal.end_date ?? goal.start_date).slice(0, 7);
  return { from, to };
}

/** Meta que vale para a categoria no mês: período explícito vence recorrente; depois a mais nova. */
function goalForMonth(goals: HistoryGoalRow[], month: string, current: string): HistoryGoalRow | null {
  const applicable = goals.filter((g) => {
    const r = goalMonths(g, current);
    return month >= r.from && month <= r.to;
  });
  if (!applicable.length) return null;
  return applicable.sort((a, b) => {
    // A meta viva vence o mês guardado; período explícito vence recorrente.
    const as = a.source === "cycle" ? 1 : 0;
    const bs = b.source === "cycle" ? 1 : 0;
    if (as !== bs) return as - bs;
    const ar = (a.period_type ?? "") === "monthly_recurring" ? 1 : 0;
    const br = (b.period_type ?? "") === "monthly_recurring" ? 1 : 0;
    if (ar !== br) return ar - br;
    return String(b.created_at ?? b.start_date).localeCompare(String(a.created_at ?? a.start_date));
  })[0];
}

function pct(ratio: number): string {
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

export function buildGoalHistory(input: GoalHistoryInput): GoalHistory {
  const current = input.today.slice(0, 7);
  const monthsBefore = input.monthsBefore ?? 3;
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const goals = [
    ...input.goals.map((g) => ({ ...g, source: "goal" as const })),
    ...(input.cycles ?? []).map((c) => ({ ...c, source: "cycle" as const, status: c.status || "active" })),
  ].filter((g) => g.status !== "cancelled" && Number(g.computed_limit) > 0);

  // Gasto e maior estabelecimento por categoria e mês.
  const spend = new Map<string, number>();
  const byMerchant = new Map<string, Map<string, { label: string; amount: number }>>();
  for (const e of input.entries) {
    if (!e.category_id) continue;
    const key = `${e.category_id}|${e.month}`;
    spend.set(key, (spend.get(key) ?? 0) + e.amount);
    const merchants = byMerchant.get(key) ?? new Map();
    const row = merchants.get(e.merchant_key) ?? { label: e.merchant_label, amount: 0 };
    row.amount += e.amount;
    merchants.set(e.merchant_key, row);
    byMerchant.set(key, merchants);
  }
  const actualOf = (categoryId: string, month: string) => round2(Math.max(0, spend.get(`${categoryId}|${month}`) ?? 0));
  const driverOf = (categoryId: string, month: string) => {
    const top = [...(byMerchant.get(`${categoryId}|${month}`)?.values() ?? [])].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount)[0];
    return top ? { label: top.label, amount: round2(top.amount) } : null;
  };

  const byCategory = new Map<string, HistoryGoalRow[]>();
  for (const g of goals) byCategory.set(g.category_id, [...(byCategory.get(g.category_id) ?? []), g]);

  const series: GoalSeries[] = [];
  for (const [categoryId, list] of byCategory.entries()) {
    const firstMonth = list.map((g) => g.start_date.slice(0, 7)).sort()[0];
    if (firstMonth > current) continue;
    // A série vai até o mês corrente: um mês sem meta depois de já ter tido meta aparece como lacuna.
    const end = current;
    const before = monthRange(shiftMonth(firstMonth, -monthsBefore), shiftMonth(firstMonth, -1));
    const span = monthRange(firstMonth, end);

    const months: HistoryMonth[] = [];
    for (const month of before) {
      months.push({ month, status: "before", goal_id: null, source: null, limit: null, actual: actualOf(categoryId, month), projected: null, difference: null, main_driver: driverOf(categoryId, month) });
    }
    for (const month of span) {
      const goal = goalForMonth(list, month, current);
      const actual = actualOf(categoryId, month);
      if (!goal) {
        // Mês corrente sem meta só aparece se já houve meta antes (mostra a lacuna).
        months.push({ month, status: "no_goal", goal_id: null, source: null, limit: null, actual, projected: null, difference: null, main_driver: driverOf(categoryId, month) });
        continue;
      }
      const limit = round2(Number(goal.computed_limit));
      const isCurrent = month === current;
      const projected = isCurrent ? round2(Math.max(actual, input.current?.[goal.id]?.projected ?? actual)) : null;
      const status: HistoryMonthStatus = goal.status === "paused"
        ? "paused"
        : isCurrent ? "in_progress" : actual <= limit ? "met" : "missed";
      months.push({ month, status, goal_id: goal.id, source: goal.source ?? "goal", limit, actual, projected, difference: round2(limit - actual), main_driver: driverOf(categoryId, month) });
    }

    // Referência: a da meta (congelada na criação) ou a média dos meses antes dela.
    // Referência: o que você gastava nos meses ANTES da primeira meta (o mesmo
    // livro canônico); sem histórico, a referência informada na criação.
    const firstGoal = [...list].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const beforeValues = months.filter((m) => m.status === "before" && m.actual > 0).map((m) => m.actual);
    const baseline = beforeValues.length
      ? round2(beforeValues.reduce((a, b) => a + b, 0) / beforeValues.length)
      : firstGoal.baseline_value && firstGoal.baseline_value > 0 ? round2(firstGoal.baseline_value) : null;

    const closed = months.filter((m) => m.status === "met" || m.status === "missed");
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && closed[i].status === "met"; i -= 1) streak += 1;
    const recent = closed.slice(-3);
    const recentAvg = recent.length ? recent.reduce((a, m) => a + m.actual, 0) / recent.length : null;
    const change = baseline && recentAvg != null ? round2((recentAvg - baseline) / baseline) : null;
    const savings = baseline != null && closed.length ? round2(closed.reduce((a, m) => a + (baseline - m.actual), 0)) : null;

    const currentMonth = months.find((m) => m.month === current && m.goal_id && m.source === "goal");
    series.push({
      category_id: categoryId,
      category_name: names.get(categoryId) ?? "Categoria",
      current_goal_id: currentMonth?.goal_id ?? [...months].reverse().find((m) => m.goal_id && m.source === "goal")?.goal_id ?? null,
      first_month: firstMonth,
      baseline,
      months,
      kpis: {
        closed_months: closed.length,
        met_months: closed.filter((m) => m.status === "met").length,
        streak,
        savings_total: savings,
        change_vs_baseline: change,
        direction: change == null ? "unknown" : change <= -0.05 ? "down" : change >= 0.05 ? "up" : "stable",
      },
    });
  }
  series.sort((a, b) => a.category_name.localeCompare(b.category_name, "pt-BR"));

  const boardMonths = monthRange(shiftMonth(current, -5), current);
  const scoreboard = {
    months: boardMonths,
    rows: series.map((s) => ({
      category_id: s.category_id,
      category_name: s.category_name,
      cells: boardMonths.map((month) => ({ month, status: s.months.find((m) => m.month === month)?.status ?? "no_goal" })),
    })),
  };

  const impact = goalImpact({
    series, entries: input.entries, categories: input.categories, current,
    monthsBefore, alertsDelivered: input.alertsDelivered ?? 0,
  });
  const highlights = goalHighlights(series, current);
  if (impact.closed_goal_months > 0 && Math.abs(impact.estimated_savings) >= 1) {
    highlights.unshift({
      id: "impact",
      tone: impact.estimated_savings > 0 ? "positive" : "negative",
      category_id: null,
      title: impact.headline,
      body: impact.explanation,
    });
  }

  return {
    version: GOAL_HISTORY_VERSION,
    as_of: input.today,
    current_month: current,
    series,
    scoreboard,
    highlights: highlights.slice(0, 6),
    impact,
  };
}

/** Contrafactual das metas: quanto foi evitado e quanto ficou mais claro. */
export function goalImpact(args: {
  series: GoalSeries[];
  entries: SpendingEntry[];
  categories: Array<{ id: string; name: string }>;
  current: string;
  monthsBefore: number;
  alertsDelivered: number;
}): GoalImpact {
  const goalCats = new Set(args.series.map((s) => s.category_id));
  const closedBySeries = args.series.map((s) => ({
    s,
    closed: s.months.filter((m) => m.status === "met" || m.status === "missed"),
  })).filter((x) => x.closed.length && x.s.baseline != null);
  const closedMonths = [...new Set(closedBySeries.flatMap((x) => x.closed.map((m) => m.month)))].sort();
  const firstGoalMonth = args.series.map((s) => s.first_month).sort()[0] ?? args.current;
  const preMonths = monthRange(shiftMonth(firstGoalMonth, -args.monthsBefore), shiftMonth(firstGoalMonth, -1));

  // Grupo de comparação: categorias de consumo SEM meta.
  const names = new Map(args.categories.map((c) => [c.id, c.name]));
  const controlTotals = new Map<string, number>();
  const monthTotals = new Map<string, number>();
  for (const e of args.entries) {
    monthTotals.set(e.month, (monthTotals.get(e.month) ?? 0) + e.amount);
    if (!e.category_id || goalCats.has(e.category_id)) continue;
    const name = names.get(e.category_id);
    if (!name || isObligationCategory(name)) continue;
    controlTotals.set(e.month, (controlTotals.get(e.month) ?? 0) + e.amount);
  }
  const avg = (months: string[], map: Map<string, number>) => months.length
    ? months.reduce((a, m) => a + Math.max(0, map.get(m) ?? 0), 0) / months.length
    : 0;
  const controlBefore = avg(preMonths, controlTotals);
  const controlAfter = avg(closedMonths, controlTotals);
  // Ajuste limitado a ±30% para um mês atípico de outra categoria não dominar.
  const controlChange = controlBefore > 0 && closedMonths.length
    ? Math.max(-0.3, Math.min(0.3, (controlAfter - controlBefore) / controlBefore))
    : null;

  const byCategory = closedBySeries.map(({ s, closed }) => {
    const expected = round2(closed.length * (s.baseline ?? 0) * (1 + (controlChange ?? 0)));
    const actual = round2(closed.reduce((a, m) => a + m.actual, 0));
    return { category_id: s.category_id, category_name: s.category_name, expected, actual, savings: round2(expected - actual) };
  }).sort((a, b) => b.savings - a.savings);
  const expected = round2(byCategory.reduce((a, c) => a + c.expected, 0));
  const actual = round2(byCategory.reduce((a, c) => a + c.actual, 0));
  const savings = round2(expected - actual);
  const baseSum = closedBySeries.reduce((a, x) => a + (x.s.baseline ?? 0) * x.closed.length, 0);
  const goalChange = baseSum > 0 ? round2(actual / baseSum - 1) : null;
  const net = goalChange != null && controlChange != null ? round2(goalChange - controlChange) : null;

  const lastClosed = shiftMonth(args.current, -1);
  const lastTotal = monthTotals.get(lastClosed) ?? 0;
  const underGoal = args.series.reduce((a, s) => a + (s.months.find((m) => m.month === lastClosed && m.goal_id)?.actual ?? 0), 0);
  const coverage = lastTotal > 0 && underGoal > 0 ? round2(underGoal / lastTotal) : null;
  const monthsMet = closedBySeries.reduce((a, x) => a + x.closed.filter((m) => m.status === "met").length, 0);
  const closedCount = closedBySeries.reduce((a, x) => a + x.closed.length, 0);

  const best = byCategory.find((c) => c.savings > 0);
  const headline = !closedCount
    ? "O impacto das metas aparece no primeiro fechamento"
    : savings > 0
      ? `As metas evitaram cerca de ${brl(savings)} em gastos`
      : `Com meta, o gasto ficou ${brl(-savings)} acima do esperado`;
  const adjust = controlChange == null
    ? ""
    : ` Seus gastos sem meta ${controlChange >= 0 ? "subiram" : "caíram"} ${pct(controlChange)} no mesmo período, e isso já foi descontado.`;
  const explanation = !closedCount
    ? "Assim que um mês com meta fechar, o Nino compara o que você gastou com o que provavelmente gastaria sem ela."
    : `Sem meta, você provavelmente gastaria ${brl(expected)} nessas categorias em ${closedCount} ${closedCount === 1 ? "mês" : "meses"} de meta; gastou ${brl(actual)}.${adjust}${savings > 0 && best ? ` A maior contribuição veio de ${best.category_name}.` : ""}`;

  return {
    closed_goal_months: closedCount,
    categories_tracked: args.series.length,
    expected_without_goals: expected,
    actual_with_goals: actual,
    estimated_savings: savings,
    control_change: controlChange == null ? null : round2(controlChange),
    goal_change: goalChange,
    net_effect: net,
    coverage_share: coverage,
    months_met: monthsMet,
    alerts_delivered: args.alertsDelivered,
    by_category: byCategory,
    headline,
    explanation,
  };
}

/** Highlights determinísticos: o que mudou, o que se sustenta e o que preocupa. */
export function goalHighlights(series: GoalSeries[], current: string): GoalHighlight[] {
  const out: Array<GoalHighlight & { weight: number }> = [];
  for (const s of series) {
    const closed = s.months.filter((m) => m.status === "met" || m.status === "missed");
    const now = s.months.find((m) => m.month === current && m.status === "in_progress");
    if (now && now.limit != null && now.actual > now.limit) {
      out.push({
        id: `over_now:${s.category_id}`, tone: "negative", category_id: s.category_id, weight: 100,
        title: `${s.category_name} já passou do limite de ${historyMonthName(current)}`,
        body: `${brl(now.actual)} de ${brl(now.limit)}${now.main_driver ? `; o maior peso é ${now.main_driver.label}` : ""}.`,
      });
    }
    const change = s.kpis.change_vs_baseline;
    if (change != null && s.baseline && change <= -0.1) {
      out.push({
        id: `down:${s.category_id}`, tone: "positive", category_id: s.category_id, weight: 80 + Math.abs(change) * 10,
        title: `${s.category_name} caiu ${pct(change)}`,
        body: `Média recente de ${brl(s.baseline * (1 + change))} por mês, contra ${brl(s.baseline)} antes da meta.`,
      });
    } else if (change != null && s.baseline && change >= 0.1) {
      out.push({
        id: `up:${s.category_id}`, tone: "negative", category_id: s.category_id, weight: 85 + change * 10,
        title: `${s.category_name} subiu ${pct(change)}`,
        body: `Média recente de ${brl(s.baseline * (1 + change))} por mês, contra ${brl(s.baseline)} antes da meta.`,
      });
    }
    if (s.kpis.streak >= 2) {
      out.push({
        id: `streak:${s.category_id}`, tone: "positive", category_id: s.category_id, weight: 70 + s.kpis.streak,
        title: `${s.category_name}: ${s.kpis.streak} meses seguidos na meta`,
        body: "Sequência mantida. O próximo fechamento conta para ela.",
      });
    }
    const tail = closed.slice(-2);
    if (tail.length === 2 && tail.every((m) => m.status === "missed")) {
      const sameDriver = tail[0].main_driver && tail[1].main_driver && tail[0].main_driver.label === tail[1].main_driver.label;
      out.push({
        id: `misses:${s.category_id}`, tone: "negative", category_id: s.category_id, weight: 90,
        title: `${s.category_name}: 2 meses seguidos acima`,
        body: sameDriver
          ? `${tail[1].main_driver!.label} foi o maior peso nos dois meses. Uma submeta para ele ajuda.`
          : `Acima do limite em ${historyMonthName(tail[0].month)} e ${historyMonthName(tail[1].month)}.`,
      });
    } else if (closed.length && closed[closed.length - 1].status === "met" && closed.length >= 1 && s.kpis.streak === 1) {
      const last = closed[closed.length - 1];
      out.push({
        id: `met:${s.category_id}`, tone: "positive", category_id: s.category_id, weight: 50,
        title: `${s.category_name} cumpriu a meta de ${historyMonthName(last.month)}`,
        body: `${brl(last.actual)} de ${brl(last.limit ?? 0)} (sobraram ${brl(last.difference ?? 0)}).`,
      });
    } else if (closed.length && closed[closed.length - 1].status === "missed") {
      const last = closed[closed.length - 1];
      out.push({
        id: `missed:${s.category_id}`, tone: "negative", category_id: s.category_id, weight: 60,
        title: `${s.category_name} fechou ${historyMonthName(last.month)} acima`,
        body: `${brl(last.actual)} para um limite de ${brl(last.limit ?? 0)}${last.main_driver ? `; o maior peso foi ${last.main_driver.label}` : ""}.`,
      });
    }
  }
  if (series.length && !series.some((s) => s.kpis.closed_months > 0)) {
    out.push({
      id: "first_close", tone: "neutral", category_id: null, weight: 10,
      title: "O primeiro fechamento vem no início do próximo mês",
      body: "A partir dele, o Nino mostra se você cumpriu, quanto economizou e a tendência de cada meta.",
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 6).map(({ weight: _w, ...h }) => h);
}
