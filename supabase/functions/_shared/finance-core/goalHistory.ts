// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
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

import type { SpendingEntry } from "./spendingGoals.ts";

export const GOAL_HISTORY_VERSION = "goal_history.v1";

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
}

export type HistoryMonthStatus = "met" | "missed" | "in_progress" | "no_goal" | "before" | "paused";

export interface HistoryMonth {
  month: string;
  status: HistoryMonthStatus;
  goal_id: string | null;
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
  const goals = input.goals.filter((g) => g.status !== "cancelled" && Number(g.computed_limit) > 0);

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
      months.push({ month, status: "before", goal_id: null, limit: null, actual: actualOf(categoryId, month), projected: null, difference: null, main_driver: driverOf(categoryId, month) });
    }
    for (const month of span) {
      const goal = goalForMonth(list, month, current);
      const actual = actualOf(categoryId, month);
      if (!goal) {
        // Mês corrente sem meta só aparece se já houve meta antes (mostra a lacuna).
        months.push({ month, status: "no_goal", goal_id: null, limit: null, actual, projected: null, difference: null, main_driver: driverOf(categoryId, month) });
        continue;
      }
      const limit = round2(Number(goal.computed_limit));
      const isCurrent = month === current;
      const projected = isCurrent ? round2(Math.max(actual, input.current?.[goal.id]?.projected ?? actual)) : null;
      const status: HistoryMonthStatus = goal.status === "paused"
        ? "paused"
        : isCurrent ? "in_progress" : actual <= limit ? "met" : "missed";
      months.push({ month, status, goal_id: goal.id, limit, actual, projected, difference: round2(limit - actual), main_driver: driverOf(categoryId, month) });
    }

    // Referência: a da meta (congelada na criação) ou a média dos meses antes dela.
    const firstGoal = [...list].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const beforeValues = months.filter((m) => m.status === "before" && m.actual > 0).map((m) => m.actual);
    const baseline = firstGoal.baseline_value && firstGoal.baseline_value > 0
      ? round2(firstGoal.baseline_value)
      : beforeValues.length ? round2(beforeValues.reduce((a, b) => a + b, 0) / beforeValues.length) : null;

    const closed = months.filter((m) => m.status === "met" || m.status === "missed");
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && closed[i].status === "met"; i -= 1) streak += 1;
    const recent = closed.slice(-3);
    const recentAvg = recent.length ? recent.reduce((a, m) => a + m.actual, 0) / recent.length : null;
    const change = baseline && recentAvg != null ? round2((recentAvg - baseline) / baseline) : null;
    const savings = baseline != null && closed.length ? round2(closed.reduce((a, m) => a + (baseline - m.actual), 0)) : null;

    const currentMonth = months.find((m) => m.month === current && m.goal_id);
    series.push({
      category_id: categoryId,
      category_name: names.get(categoryId) ?? "Categoria",
      current_goal_id: currentMonth?.goal_id ?? [...months].reverse().find((m) => m.goal_id)?.goal_id ?? null,
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

  return {
    version: GOAL_HISTORY_VERSION,
    as_of: input.today,
    current_month: current,
    series,
    scoreboard,
    highlights: goalHighlights(series, current),
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
  const savingsSeries = series.filter((s) => s.kpis.savings_total != null && s.kpis.closed_months > 0);
  if (savingsSeries.length) {
    const total = round2(savingsSeries.reduce((a, s) => a + (s.kpis.savings_total ?? 0), 0));
    const since = savingsSeries.map((s) => s.first_month).sort()[0];
    out.push(total >= 0
      ? { id: "savings", tone: "positive", category_id: null, weight: 75, title: `${brl(total)} economizados desde ${historyMonthName(since)}`, body: "Soma do que ficou abaixo da sua referência nos meses fechados com meta." }
      : { id: "savings", tone: "negative", category_id: null, weight: 65, title: `${brl(-total)} acima da referência desde ${historyMonthName(since)}`, body: "Nos meses fechados com meta, o gasto somado ficou acima do que era antes." });
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
