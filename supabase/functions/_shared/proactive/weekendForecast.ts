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
import {
  categoryMonthlyAverage,
  isFixedDateCategory,
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
  /** Folga só vira mensagem se um fim de semana típico consome ao menos essa fatia dela. */
  minSlackShare: 0.3,
  /** Degrau realista: fração do gasto esperado proposta para este fim de semana. */
  stepRatio: 0.6,
  /** Abaixo dessa fração do padrão, o que cabe por fim de semana é "apertado". */
  tightRatio: 0.25,
  /** Abaixo dessa fração, a meta está desalinhada com a rotina: perguntar se quer revisar. */
  misalignedRatio: 0.1,
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
  /** Limite sugerido para ESTE fim de semana (degrau realista); null quando não há redução possível. */
  target: number | null;
  /** Fechamento do mês se este fim de semana ficar no limite (recalculado, não estimado). */
  projected_if_target: number | null;
  /** O que caberia por fim de semana é pequeno demais frente ao padrão (< 25%). */
  tight: boolean;
  /** A meta pede um corte tão grande (< 10% do padrão) que a pergunta útil é revisá-la. */
  misaligned: boolean;
  /** Média mensal dos últimos meses fechados (contexto da meta). */
  avg3m: number | null;
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

const OPEN_GOAL_STATUS = new Set(["on_track", "attention", "at_risk", "exceeded", "limit_reached"]);

/** Metas abertas que cobrem hoje, a partir da leitura canônica (`readGoals`): limite e gasto do mês. */
export function goalsFromReadings(
  readings: Array<{ category_name: string; status: string; limit: number; actual: number; period: { start: string; end: string } }>,
  today: string,
): Record<string, NudgeGoal> {
  const out: Record<string, NudgeGoal> = {};
  for (const r of readings) {
    if (!OPEN_GOAL_STATUS.has(r.status) || r.period.start > today || r.period.end < today || !(r.limit > 0)) continue;
    out[r.category_name] = { name: r.category_name, limit: round2(r.limit), actual: round2(r.actual) };
  }
  return out;
}

/** Sexta do fim de semana de referência: hoje (sex), a próxima (seg–qui) ou a que acabou de passar (sáb/dom). */
export function weekendFridayOf(today: string): string {
  const d = dow(today);
  if (d === 5) return today;
  if (d === 6) return addDays(today, -1);
  if (d === 0) return addDays(today, -2);
  return addDays(today, 5 - d);
}

/** Previsões por categoria para o fim de semana que começa hoje (sexta). */
export function buildWeekendForecasts(
  transactions: NudgeTransaction[],
  today: string,
  goals: Record<string, NudgeGoal> = {},
  /** `anyDay`: leitura sob demanda (tela de hábitos) em qualquer dia; a mensagem proativa segue só na sexta. */
  opts: { anyDay?: boolean } = {},
): WeekendForecast[] {
  if (dow(today) !== 5 && !opts.anyDay) return [];
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
    // Com meta, o gasto do mês é o da leitura canônica da meta (estornos e datas já aplicados);
    // sem meta, o mês corrente cabe inteiro na janela de 12 semanas e `rows` já o contém.
    const monthToDate = goals[category]?.actual != null
      ? Number(goals[category].actual)
      : rows.filter((t) => t.occurred_at.slice(0, 7) === month).reduce((a, t) => a + Number(t.amount), 0);
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
    // Com meta (compromisso explícito) a folga também vale a mensagem, mas só quando um
    // fim de semana típico pesa na folga restante; sem meta, só o risco.
    const room = anchor.kind === "goal" && slack > 0 && expected >= slack * rules.minSlackShare;
    if (!pressure && !room) continue;

    const fair = unitsLeft > 0 ? Math.max(0, (slack - weekdayRest) / unitsLeft) : 0;
    const tight = expected > 0 && fair < expected * rules.tightRatio;
    const misaligned = pressure && anchor.kind === "goal" && expected > 0 && fair < expected * rules.misalignedRatio;
    const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);
    // Degrau: o maior entre "40% abaixo do esperado" e o que já fecha na referência.
    const rawTarget = pressure ? Math.max(round10(expected * rules.stepRatio), fair > 0 ? round10(fair) : 0) : fair > 0 ? round10(fair) : 0;
    const target = rawTarget > 0 && rawTarget < expected ? rawTarget : null;
    out.push({
      category,
      friday: weekendFridayOf(today),
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
      target,
      projected_if_target: target != null ? round2(projected - expected + target) : null,
      tight,
      misaligned,
      avg3m: categoryMonthlyAverage(transactions, category, today),
      state: pressure ? "pressure" : "room",
      data_gap: cardGap ? "card_missing" : null,
    });
  }
  // Risco primeiro, com meta alinhada antes da desalinhada (a que o usuário consegue agir);
  // depois o maior excesso sobre a referência.
  const excess = (f: WeekendForecast) => f.projected_month - f.anchor.amount;
  return out.sort((a, b) => {
    if (a.state !== b.state) return a.state === "pressure" ? -1 : 1;
    if (a.misaligned !== b.misaligned) return a.misaligned ? 1 : -1;
    return excess(b) - excess(a);
  });
}

/** Categorias cobertas por esta previsão (o aviso por dia da semana não repete). */
export function weekendCoveredCategories(forecasts: WeekendForecast[]): Set<string> {
  return new Set(forecasts.map((f) => f.category));
}
