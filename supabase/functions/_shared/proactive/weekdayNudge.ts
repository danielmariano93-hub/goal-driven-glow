// nino_weekday_nudge.v1 — aviso de manhã no dia em que a pessoa costuma gastar
// mais numa categoria (função pura). Ex.: "às quartas você costuma gastar mais
// com Alimentação". Tudo é calculado aqui, a partir das transações das últimas
// 12 semanas: a IA não inventa padrão nem valor.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";

export const WEEKDAY_NUDGE_VERSION = "nino_weekday_nudge.v1";

export const WEEKDAY_NUDGE_RULES = {
  weeks: 12,
  /** O dia precisa ser claramente acima dos outros. */
  minRatio: 1.6,
  /** A categoria precisa aparecer nesse dia da semana em pelo menos N das semanas. */
  minOccurrences: 4,
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

export type NudgeTransaction = { occurred_at: string; amount: number; category: string | null };

export type WeekdayPattern = {
  weekday: number;
  category: string;
  typical_on_weekday: number;
  typical_other_days: number;
  ratio: number;
  occurrences: number;
  weeks: number;
  weekday_count_in_month: number;
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

/** Padrão mais forte de hoje, se houver. `today` é a data civil local (YYYY-MM-DD). */
export function detectWeekdayPattern(transactions: NudgeTransaction[], today: string): WeekdayPattern | null {
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

  const byCategory = new Map<string, { onDay: number; other: number; dates: Set<string> }>();
  for (const t of window) {
    const entry = byCategory.get(t.category!) ?? { onDay: 0, other: 0, dates: new Set<string>() };
    const day = t.occurred_at.slice(0, 10);
    if (dayOfWeek(day) === weekday) {
      entry.onDay += Number(t.amount);
      entry.dates.add(day);
    } else {
      entry.other += Number(t.amount);
    }
    byCategory.set(t.category!, entry);
  }

  let best: WeekdayPattern | null = null;
  for (const [category, entry] of byCategory) {
    const typicalOnDay = entry.onDay / weekdayDays;
    const typicalOther = entry.other / otherDays;
    if (entry.dates.size < rules.minOccurrences) continue;
    if (typicalOnDay < rules.minDailyAmount) continue;
    const ratio = typicalOther > 0 ? typicalOnDay / typicalOther : Number.POSITIVE_INFINITY;
    if (ratio < rules.minRatio) continue;
    const excess = typicalOnDay - typicalOther;
    if (!best || excess > best.typical_on_weekday - best.typical_other_days) {
      best = {
        weekday,
        category,
        typical_on_weekday: round2(typicalOnDay),
        typical_other_days: round2(typicalOther),
        ratio: Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : 99,
        occurrences: entry.dates.size,
        weeks: rules.weeks,
        weekday_count_in_month: weekdaysInMonth(today, weekday),
      };
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
  pattern: WeekdayPattern | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
  focusGoal?: { name: string } | null,
): FinancialSituation | null {
  if (!pattern) return null;
  if (!isWeekdayNudgeWindow(now)) return null;

  const dayName = WEEKDAY_NAMES[pattern.weekday];
  const label = WEEKDAY_LABEL[pattern.weekday];
  const monthly = round2(pattern.typical_on_weekday * pattern.weekday_count_in_month);
  const half = round2(pattern.typical_on_weekday / 2);
  const ratioText = pattern.ratio >= 99 ? "bem acima" : `${String(pattern.ratio).replace(".", ",")}x`;
  const goalText = focusGoal ? ` — e esse valor pode ir para a meta “${focusGoal.name}”` : "";
  const body = [
    `Às ${dayName} você costuma gastar cerca de ${brlPt(pattern.typical_on_weekday)} com ${pattern.category}, ${ratioText} a média dos outros dias.`,
    `No mês, só nas ${dayName}, isso soma uns ${brlPt(monthly)}.`,
    `Se hoje você segurar metade, sobram ${brlPt(half)}${goalText}.`,
  ].join(" ");
  const confidence = Math.min(0.9, 0.6 + (pattern.occurrences / pattern.weeks) * 0.3);

  return {
    fingerprint: `${WEEKDAY_NUDGE_VERSION}:${pattern.category}:${ctx.as_of}`,
    type: "weekday_nudge",
    communication_kind: "weekday_spending_risk",
    severity: "attention",
    title: `Hoje é ${label}: dia em que ${pattern.category} costuma pesar`,
    body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: monthly,
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
      monthly_on_weekday: monthly,
      half_of_typical_day: half,
    },
  };
}
