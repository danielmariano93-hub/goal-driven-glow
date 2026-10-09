// nino_weekend_forecast.v1 — previsibilidade do fim de semana (função pura).
//
// Na sexta de manhã, para a categoria em que o fim de semana (sex–dom) concentra
// o gasto, mostra: quanto os últimos fins de semana custaram (faixa e
// frequência, não uma média única), onde o mês está, para onde caminha com os
// fins de semana que restam e quanto cabe por fim de semana. Um fim de semana é
// um bloco só: o gasto de sexta à noite cai no sábado e o valor pesa no domingo.
//
// Tudo é calculado aqui a partir das transações; a IA não inventa padrão nem
// valor. Dados incompletos NÃO bloqueiam o aviso: ele sai com a ressalva.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";
import {
  categoryMonthlyAverage,
  isFixedDateCategory,
  isWeekdayNudgeWindow,
  type NudgeGoal,
  type NudgeTransaction,
} from "./weekdayNudge.ts";

export const WEEKEND_FORECAST_VERSION = "nino_weekend_forecast.v1";

export const WEEKEND_FORECAST_RULES = {
  weekends: 12,
  /** Fins de semana com gasto na categoria, de 12, para existir hábito. */
  minActiveWeekends: 5,
  /** Fatia do gasto da categoria que cai em sex–dom (3 de 7 dias = 43% se fosse uniforme). */
  minWeekendShare: 0.55,
  /** Valor típico (mediana dos fins de semana com gasto) para valer um aviso. */
  minTypical: 50,
  /** Um único fim de semana não pode ser mais que essa fatia do total (viagem pontual). */
  maxSingleWeekendShare: 0.5,
  /** Sem meta: a projeção precisa passar da média dos meses anteriores por esta margem. */
  baselineMargin: 1.1,
  /** Excesso mínimo (R$) sobre a referência para avisar sem meta. */
  minOverage: 30,
  /** Cartão: meses anteriores com ao menos N compras e mês atual sem nenhuma = dado faltando. */
  cardGapMinPrior: 5,
} as const;

export type WeekendForecast = {
  category: string;
  /** Sexta-feira (YYYY-MM-DD) do fim de semana que começa. */
  friday: string;
  weekends: number;
  active_weekends: number;
  typical: number;
  low: number;
  high: number;
  weekend_share: number;
  month_to_date: number;
  weekend_units_left: number;
  expected_per_weekend: number;
  projected_month: number;
  projected_low: number;
  projected_high: number;
  anchor: { kind: "goal" | "average"; amount: number };
  slack: number;
  /** Quanto cabe por fim de semana para fechar na referência (0 se já não cabe). */
  fair_per_weekend: number;
  /** Gasto esperado nos dias úteis que restam no mês (entra no "quanto cabe"). */
  weekday_rest: number;
  /** Gasto médio por dia útil (seg–qui), usado no fechamento de segunda. */
  weekday_rate: number;
  state: "pressure" | "room";
  data_gap: "card_missing" | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function dow(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const isWeekendDay = (iso: string) => [5, 6, 0].includes(dow(iso));

/** Há compras de cartão nos meses anteriores e nenhuma no mês corrente? */
export function detectCardGap(transactions: NudgeTransaction[], today: string): boolean {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const priorKeys = [1, 2, 3].map((i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  let current = 0;
  const prior = new Map<string, number>();
  for (const t of transactions) {
    if (t.payment_method !== "credit_card") continue;
    const key = t.occurred_at.slice(0, 7);
    if (key === month) current += 1;
    else if (priorKeys.includes(key)) prior.set(key, (prior.get(key) ?? 0) + 1);
  }
  const monthsWithCard = [...prior.values()].filter((n) => n >= WEEKEND_FORECAST_RULES.cardGapMinPrior).length;
  return current === 0 && monthsWithCard >= 2;
}

/** Previsões por categoria para o fim de semana que começa hoje (sexta). */
export function buildWeekendForecasts(
  transactions: NudgeTransaction[],
  today: string,
  goals: Record<string, NudgeGoal> = {},
): WeekendForecast[] {
  if (dow(today) !== 5) return [];
  const rules = WEEKEND_FORECAST_RULES;
  const month = today.slice(0, 7);
  const monthEnd = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  const windowStart = addDays(today, -rules.weekends * 7);
  const cardGap = detectCardGap(transactions, today);

  // Dias restantes do mês (hoje incluso): fins de semana em unidades de 3 dias e dias úteis (seg–qui).
  let weekendDaysLeft = 0;
  let weekdaysLeft = 0;
  for (let d = today; d <= monthEnd; d = addDays(d, 1)) {
    if (isWeekendDay(d)) weekendDaysLeft += 1;
    else weekdaysLeft += 1;
  }
  const unitsLeft = weekendDaysLeft / 3;

  const byCategory = new Map<string, NudgeTransaction[]>();
  for (const t of transactions) {
    const day = t.occurred_at.slice(0, 10);
    if (!t.category || !(Number(t.amount) > 0) || day < windowStart || day >= today) continue;
    byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  }

  const out: WeekendForecast[] = [];
  for (const [category, rows] of byCategory) {
    if (isFixedDateCategory(category)) continue;
    const perWeekend: number[] = Array(rules.weekends).fill(0);
    let weekdaySum = 0;
    for (const t of rows) {
      const day = t.occurred_at.slice(0, 10);
      if (isWeekendDay(day)) {
        // sexta (dow 5) pertence ao fim de semana que começa nela; sáb/dom ao da sexta anterior.
        const fridayOffset = dow(day) === 5 ? 0 : dow(day) === 6 ? 1 : 2;
        const friday = addDays(day, -fridayOffset);
        const idx = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${friday}T12:00:00Z`)) / (7 * 86_400_000)) - 1;
        if (idx >= 0 && idx < rules.weekends) perWeekend[idx] += Number(t.amount);
      } else {
        weekdaySum += Number(t.amount);
      }
    }
    const weekendSum = perWeekend.reduce((a, b) => a + b, 0);
    const total = weekendSum + weekdaySum;
    if (!(total > 0)) continue;
    const active = perWeekend.filter((v) => v > 0).sort((a, b) => a - b);
    if (active.length < rules.minActiveWeekends) continue;
    const share = weekendSum / total;
    if (share < rules.minWeekendShare) continue;
    if (Math.max(...perWeekend) > weekendSum * rules.maxSingleWeekendShare) continue;
    const typical = quantile(active, 0.5);
    if (typical < rules.minTypical) continue;

    const all = [...perWeekend].sort((a, b) => a - b);
    // Esperado por fim de semana: média dos 12 com cada um limitado ao P90 (um pico não manda na projeção).
    const cap = quantile(all, 0.9);
    const expected = perWeekend.reduce((a, v) => a + Math.min(v, cap), 0) / rules.weekends;
    const weekdayRate = weekdaySum / (rules.weekends * 4);
    // O mês corrente cabe inteiro na janela de 12 semanas, então `rows` já o contém.
    const monthToDate = rows
      .filter((t) => t.occurred_at.slice(0, 7) === month)
      .reduce((a, t) => a + Number(t.amount), 0);
    const weekdayRest = weekdayRate * weekdaysLeft;
    const projected = monthToDate + expected * unitsLeft + weekdayRest;
    const projectedLow = monthToDate + quantile(all, 0.25) * unitsLeft + weekdayRest;
    const projectedHigh = monthToDate + quantile(all, 0.75) * unitsLeft + weekdayRest;

    const goal = goals[category];
    let anchor: WeekendForecast["anchor"];
    if (goal && goal.limit > 0) {
      anchor = { kind: "goal", amount: round2(goal.limit) };
    } else {
      const avg = categoryMonthlyAverage(transactions, category, today);
      if (avg == null) continue;
      anchor = { kind: "average", amount: avg };
    }
    const slack = anchor.amount - monthToDate;
    const overage = projected - anchor.amount;
    const pressure = anchor.kind === "goal"
      ? overage > 0
      : projected > anchor.amount * rules.baselineMargin && overage >= rules.minOverage;
    // Com meta (compromisso explícito) a folga também vale a mensagem; sem meta, só o risco.
    const room = anchor.kind === "goal" && slack > 0;
    if (!pressure && !room) continue;

    const fair = unitsLeft > 0 ? Math.max(0, (slack - weekdayRest) / unitsLeft) : 0;
    out.push({
      category,
      friday: today,
      weekends: rules.weekends,
      active_weekends: active.length,
      typical: round2(typical),
      low: round2(quantile(active, 0.25)),
      high: round2(quantile(active, 0.75)),
      weekend_share: Math.round(share * 100) / 100,
      month_to_date: round2(monthToDate),
      weekend_units_left: round2(unitsLeft),
      expected_per_weekend: round2(expected),
      projected_month: round2(projected),
      projected_low: round2(projectedLow),
      projected_high: round2(projectedHigh),
      anchor,
      slack: round2(slack),
      fair_per_weekend: round2(fair),
      weekday_rest: round2(weekdayRest),
      weekday_rate: round2(weekdayRate),
      state: pressure ? "pressure" : "room",
      data_gap: cardGap ? "card_missing" : null,
    });
  }
  // Risco primeiro; dentro do estado, o maior valor típico (o que mais pesa).
  return out.sort((a, b) => (a.state === b.state ? b.typical - a.typical : a.state === "pressure" ? -1 : 1));
}

/** Categorias cobertas por esta previsão (o aviso por dia da semana não repete). */
export function weekendCoveredCategories(forecasts: WeekendForecast[]): Set<string> {
  return new Set(forecasts.map((f) => f.category));
}

export function weekendForecastSituation(
  forecast: WeekendForecast | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  if (!forecast) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const f = forecast;
  const leftCount = Math.max(1, Math.ceil(f.weekend_units_left - 0.01));
  const leftText = leftCount === 1 ? "só este fim de semana" : `${leftCount} fins de semana contando este`;
  const spread = Math.abs(f.high - f.low) < 1
    ? `em geral uns ${brlPt(f.typical)}`
    : `em geral entre ${brlPt(f.low)} e ${brlPt(f.high)} (típico ${brlPt(f.typical)})`;
  const habit = `Nos últimos ${f.weekends} fins de semana você gastou com ${f.category} em ${f.active_weekends}, ${spread}.`;
  const anchorText = f.anchor.kind === "goal" ? `a meta é ${brlPt(f.anchor.amount)}` : `a média dos últimos meses é ${brlPt(f.anchor.amount)}`;
  const gap = f.data_gap === "card_missing"
    ? " Obs.: não encontrei compras de cartão neste mês; se ainda faltam lançar, o valor real pode ser maior."
    : "";

  let title: string;
  let body: string;
  if (f.state === "pressure") {
    title = `Fim de semana: ${f.category} pode estourar o mês`;
    const fair = f.fair_per_weekend > 0
      ? `Para fechar dentro, dá uns ${brlPt(f.fair_per_weekend)} por fim de semana.`
      : "Só com os dias úteis o mês já fica acima; vale segurar o fim de semana.";
    body = [
      habit,
      `${f.category} no mês: ${brlPt(f.month_to_date)} até ontem. No ritmo atual (${leftText}), fecha perto de ${brlPt(f.projected_month)}, entre ${brlPt(f.projected_low)} e ${brlPt(f.projected_high)} (${anchorText}).`,
      fair,
    ].join(" ") + gap;
  } else {
    title = `Quanto cabe de ${f.category} neste fim de semana`;
    body = [
      habit,
      `Sua meta de ${f.category} tem ${brlPt(f.slack)} de folga até o fim do mês (${leftText}).`,
      f.fair_per_weekend > 0
        ? `Dividindo a folga, cabem uns ${brlPt(f.fair_per_weekend)} por fim de semana.`
        : "Os dias úteis já usam a folga restante; este fim de semana pede cuidado.",
    ].join(" ") + gap;
  }
  const confidence = Math.min(0.9, 0.55 + (f.active_weekends / f.weekends) * 0.3) - (f.data_gap ? 0.1 : 0);

  return {
    fingerprint: `${WEEKEND_FORECAST_VERSION}:${f.category}:${f.friday}`,
    type: "weekend_forecast",
    communication_kind: "weekend_spending_risk",
    severity: f.state === "pressure" ? "attention" : "info",
    title,
    body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: f.state === "pressure" ? round2(Math.max(0, f.projected_month - f.anchor.amount)) : f.slack,
    days_until: 0,
    confidence: Math.round(confidence * 100) / 100,
    actionable: true,
    route: "/app/relatorios",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: WEEKEND_FORECAST_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      // Guardado para o fechamento de segunda: previsto x realizado.
      forecast: f,
    },
  };
}
