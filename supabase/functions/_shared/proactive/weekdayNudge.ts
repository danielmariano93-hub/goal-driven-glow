// nino_weekday_nudge.v2 — previsibilidade: de manhã, no dia da semana em que a
// pessoa costuma gastar mais numa categoria, mostra para onde o mês caminha
// ("nesse ritmo, fecha em R$ Y; a meta é R$ Z") e o que muda se hoje não gastar.
// Só avisa quando há o que decidir (projeção acima da meta ou da média dos
// últimos meses). Função pura: tudo é calculado aqui a partir das transações,
// a IA não inventa padrão nem valor.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";

export const WEEKDAY_NUDGE_VERSION = "nino_weekday_nudge.v2";

export const WEEKDAY_NUDGE_RULES = {
  weeks: 12,
  /** O dia precisa ser claramente acima dos outros. */
  minRatio: 1.6,
  /** A categoria precisa aparecer nesse dia da semana em pelo menos N das semanas. */
  minOccurrences: 6,
  /** Um único dia não pode ser mais que essa fatia do total do dia da semana. */
  maxSingleDayShare: 0.5,
  /** Sem meta: a projeção precisa passar da média dos últimos meses por esta margem. */
  baselineMargin: 1.1,
  /** Meses fechados usados como referência quando não há meta. */
  baselineMonths: 3,
  /** Mínimo de meses com gasto na categoria para a média valer como referência. */
  baselineMinMonths: 2,
  /** Excesso mínimo (R$) sobre a referência para valer um aviso. */
  minOverage: 30,
  /** Depois disso do mês não há mais o que corrigir. */
  minRemainingDays: 2,
  /** Valor mínimo típico do dia para valer um aviso. */
  minDailyAmount: 30,
  /**
   * Janela de envio (hora local, São Paulo): de manhã até o início da tarde, antes
   * do gasto. Janela maior = mais rodadas horárias para ganhar a vaga única do
   * WhatsApp quando um alerta mais urgente ocupa a primeira.
   */
  sendFromHour: 7,
  sendUntilHour: 14,
} as const;

const WEEKDAY_NAMES = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Categorias cobradas em data fixa (vencimento/ciclo), não por hábito de dia da
 * semana: a "sexta" delas é coincidência de calendário, não comportamento.
 */
const FIXED_DATE_CATEGORIES = new Set([
  "assinaturas", "moradia", "aluguel", "condominio", "contas", "energia", "agua", "internet", "telefone",
  "financiamento", "emprestimo", "impostos", "taxas", "tarifas", "seguros", "seguro", "educacao", "saude", "plano de saude",
  "cartao", "fatura", "dividas", "juros", "investimentos", "transferencias",
]);

export function isFixedDateCategory(category: string): boolean {
  const key = category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return FIXED_DATE_CATEGORIES.has(key);
}

export type NudgeTransaction = { occurred_at: string; amount: number; category: string | null; payment_method?: string | null };

export type WeekdayPattern = {
  weekday: number;
  category: string;
  typical_on_weekday: number;
  typical_other_days: number;
  ratio: number;
  occurrences: number;
  weeks: number;
  weekday_count_in_month: number;
  /** Valor típico nas vezes em que a categoria aparece nesse dia (não diluído pelas semanas sem gasto). */
  when_it_happens: number;
};

export type NudgeGoal = { name: string; limit: number };

export type WeekdayProjection = {
  pattern: WeekdayPattern;
  month_to_date: number;
  projected_month: number;
  /** Se hoje não houver gasto nessa categoria. */
  projected_without_today: number;
  anchor: { kind: "goal" | "average"; amount: number; label: string };
  overage: number;
  remaining_days: number;
};

function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

function weekdaysInMonth(iso: string, weekday: number): number {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === weekday) count += 1;
  }
  return count;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Padrões de hoje que passam em todas as regras (um por categoria). */
export function detectWeekdayPatterns(transactions: NudgeTransaction[], today: string): WeekdayPattern[] {
  const rules = WEEKDAY_NUDGE_RULES;
  const weekday = dayOfWeek(today);
  const start = addDays(today, -rules.weeks * 7);
  const window = transactions.filter((t) => {
    const day = t.occurred_at.slice(0, 10);
    return day >= start && day < today && t.category && Number(t.amount) > 0;
  });
  const totalDays = rules.weeks * 7;
  const weekdayDays = rules.weeks;
  const otherDays = totalDays - weekdayDays;

  const byCategory = new Map<string, { onDay: number; other: number; dates: Set<string>; perDate: Map<string, number> }>();
  for (const t of window) {
    const entry = byCategory.get(t.category!) ?? { onDay: 0, other: 0, dates: new Set<string>(), perDate: new Map<string, number>() };
    const day = t.occurred_at.slice(0, 10);
    if (dayOfWeek(day) === weekday) {
      entry.onDay += Number(t.amount);
      entry.dates.add(day);
      entry.perDate.set(day, (entry.perDate.get(day) ?? 0) + Number(t.amount));
    } else {
      entry.other += Number(t.amount);
    }
    byCategory.set(t.category!, entry);
  }

  const found: WeekdayPattern[] = [];
  for (const [category, entry] of byCategory) {
    const typicalOnDay = entry.onDay / weekdayDays;
    const typicalOther = entry.other / otherDays;
    if (isFixedDateCategory(category)) continue;
    if (entry.dates.size < rules.minOccurrences) continue;
    if (Math.max(...entry.perDate.values()) > entry.onDay * rules.maxSingleDayShare) continue;
    if (typicalOnDay < rules.minDailyAmount) continue;
    const ratio = typicalOther > 0 ? typicalOnDay / typicalOther : Number.POSITIVE_INFINITY;
    if (ratio < rules.minRatio) continue;
    found.push({
      weekday,
      category,
      typical_on_weekday: round2(typicalOnDay),
      typical_other_days: round2(typicalOther),
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : 99,
      occurrences: entry.dates.size,
      weeks: rules.weeks,
      weekday_count_in_month: weekdaysInMonth(today, weekday),
      when_it_happens: round2(entry.onDay / entry.dates.size),
    });
  }
  return found;
}

/** Padrão mais forte de hoje, se houver. `today` é a data civil local (YYYY-MM-DD). */
export function detectWeekdayPattern(transactions: NudgeTransaction[], today: string): WeekdayPattern | null {
  let best: WeekdayPattern | null = null;
  for (const p of detectWeekdayPatterns(transactions, today)) {
    if (!best || p.typical_on_weekday - p.typical_other_days > best.typical_on_weekday - best.typical_other_days) best = p;
  }
  return best;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function shiftMonthKey(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Média mensal da categoria nos últimos meses fechados (só meses com gasto). */
export function categoryMonthlyAverage(transactions: NudgeTransaction[], category: string, today: string): number | null {
  const rules = WEEKDAY_NUDGE_RULES;
  const current = monthKey(today);
  const totals = new Map<string, number>();
  for (let i = 1; i <= rules.baselineMonths; i += 1) totals.set(shiftMonthKey(current, -i), 0);
  for (const t of transactions) {
    if (t.category !== category || !(Number(t.amount) > 0)) continue;
    const key = monthKey(t.occurred_at);
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Number(t.amount));
  }
  const withSpend = [...totals.values()].filter((v) => v > 0);
  if (withSpend.length < rules.baselineMinMonths) return null;
  return round2(withSpend.reduce((a, b) => a + b, 0) / withSpend.length);
}

/**
 * Para onde o mês da categoria caminha: gasto até ontem + os dias que faltam
 * (hoje incluso) pelo perfil do dia da semana. Só devolve algo quando passa da
 * referência (meta, ou média dos últimos meses) — sem o que decidir, silêncio.
 */
export function buildWeekdayProjection(
  transactions: NudgeTransaction[],
  today: string,
  goals: Record<string, NudgeGoal> = {},
  /** Categorias já cobertas por outro aviso (ex.: previsão do fim de semana). */
  exclude: ReadonlySet<string> = new Set(),
): WeekdayProjection | null {
  const rules = WEEKDAY_NUDGE_RULES;
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const remainingDays = daysInMonth - d + 1;
  if (remainingDays < rules.minRemainingDays) return null;
  const month = monthKey(today);

  let best: WeekdayProjection | null = null;
  for (const pattern of detectWeekdayPatterns(transactions, today)) {
    if (exclude.has(pattern.category)) continue;
    const monthToDate = round2(transactions
      .filter((t) => t.category === pattern.category && monthKey(t.occurred_at) === month && t.occurred_at.slice(0, 10) < today)
      .reduce((acc, t) => acc + Number(t.amount), 0));
    let expectedRest = 0;
    for (let day = d; day <= daysInMonth; day += 1) {
      const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
      expectedRest += wd === pattern.weekday ? pattern.typical_on_weekday : pattern.typical_other_days;
    }
    const projected = round2(monthToDate + expectedRest);
    const withoutToday = round2(projected - pattern.typical_on_weekday);

    const goal = goals[pattern.category];
    let anchor: WeekdayProjection["anchor"];
    let overage: number;
    if (goal && goal.limit > 0) {
      anchor = { kind: "goal", amount: round2(goal.limit), label: "meta" };
      overage = round2(projected - goal.limit);
      if (overage <= 0) continue;
    } else {
      const avg = categoryMonthlyAverage(transactions, pattern.category, today);
      if (avg == null) continue;
      anchor = { kind: "average", amount: avg, label: `média dos últimos ${rules.baselineMonths} meses` };
      overage = round2(projected - avg);
      if (projected <= avg * rules.baselineMargin) continue;
    }
    if (overage < rules.minOverage) continue;
    if (!best || overage > best.overage) {
      best = { pattern, month_to_date: monthToDate, projected_month: projected, projected_without_today: withoutToday, anchor, overage, remaining_days: remainingDays };
    }
  }
  return best;
}

/** Hora local (São Paulo) de um instante. */
export function saoPauloHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)) % 24;
}

export function isWeekdayNudgeWindow(now: Date): boolean {
  const hour = saoPauloHour(now);
  return hour >= WEEKDAY_NUDGE_RULES.sendFromHour && hour < WEEKDAY_NUDGE_RULES.sendUntilHour;
}

/**
 * Situação do aviso matinal. Só existe dentro da janela da manhã: fora dela a
 * rodada horária simplesmente não gera o aviso (nada fica na fila para a noite).
 */
export function weekdayNudgeSituation(
  projection: WeekdayProjection | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  if (!projection) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const { pattern } = projection;

  const dayName = WEEKDAY_NAMES[pattern.weekday];
  const label = WEEKDAY_LABEL[pattern.weekday];
  const habit = `Em ${pattern.occurrences} das últimas ${pattern.weeks} ${dayName} você gastou com ${pattern.category}, uns ${brlPt(pattern.when_it_happens)} por vez.`;
  const anchorText = projection.anchor.kind === "goal"
    ? `a meta é ${brlPt(projection.anchor.amount)}`
    : `a ${projection.anchor.label} é ${brlPt(projection.anchor.amount)}`;
  const month = `${pattern.category} no mês: ${brlPt(projection.month_to_date)} até ontem. Nesse ritmo, fecha em ${brlPt(projection.projected_month)} (${anchorText}), uns ${brlPt(projection.overage)} acima.`;
  const stillOver = projection.projected_without_today > projection.anchor.amount;
  const today = stillOver
    ? `Sem gastar com isso hoje, fecha em ${brlPt(projection.projected_without_today)}.`
    : `Sem gastar com isso hoje, o mês fecha em ${brlPt(projection.projected_without_today)}, dentro do esperado.`;
  const body = [habit, month, today].join(" ");
  const confidence = Math.min(0.9, 0.6 + (pattern.occurrences / pattern.weeks) * 0.3);

  return {
    fingerprint: `${WEEKDAY_NUDGE_VERSION}:${pattern.category}:${ctx.as_of}`,
    type: "weekday_nudge",
    communication_kind: "weekday_spending_risk",
    severity: "attention",
    title: `Hoje é ${label}: ${pattern.category} pode estourar o mês`,
    body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: projection.overage,
    days_until: 0,
    confidence: Math.round(confidence * 100) / 100,
    actionable: true,
    route: "/app/relatorios",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: WEEKDAY_NUDGE_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      pattern,
      month_to_date: projection.month_to_date,
      projected_month: projection.projected_month,
      projected_without_today: projection.projected_without_today,
      anchor: projection.anchor,
      overage: projection.overage,
    },
  };
}
