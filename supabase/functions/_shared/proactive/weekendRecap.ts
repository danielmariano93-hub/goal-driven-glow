// nino_weekend_recap.v1 — fechamento de segunda: previsto x realizado do fim de
// semana (função pura). É o que fecha o ciclo da previsão de sexta: a pessoa vê
// o que o Nino previu, o que aconteceu e o que isso fez com o mês, e aprende com
// o próprio resultado. Só existe quando a previsão de sexta foi de fato entregue:
// o "previsto" é o que a pessoa leu, não um recálculo feito depois.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";
import { isWeekdayNudgeWindow, type NudgeGoal, type NudgeTransaction } from "./weekdayNudge.ts";
import type { WeekendForecast } from "./weekendForecast.ts";

export const WEEKEND_RECAP_VERSION = "nino_weekend_recap.v1";

export type DeliveredWeekendForecast = { forecast: WeekendForecast };

export type WeekendRecap = {
  category: string;
  friday: string;
  realized: number;
  verdict: "below" | "within" | "above";
  /** typical − realized (positivo = gastou menos que o típico). */
  vs_typical: number;
  forecast: WeekendForecast;
  /** Mês corrente da segunda (null se o fim de semana virou o mês). */
  month_to_date: number | null;
  slack_now: number | null;
  fair_next: number | null;
  weekends_left: number;
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

/** Dias úteis (seg–qui) que ainda restam no mês, a partir de amanhã. */
function weekdaysLeftInMonth(today: string): number {
  const month = today.slice(0, 7);
  let n = 0;
  for (let d = addDays(today, 1); d.slice(0, 7) === month; d = addDays(d, 1)) if (![5, 6, 0].includes(dow(d))) n += 1;
  return n;
}

/** Sextas que ainda começam fim de semana neste mês, depois de hoje (segunda). */
function fridaysLeftInMonth(today: string): number {
  const month = today.slice(0, 7);
  let n = 0;
  for (let d = addDays(today, 1); d.slice(0, 7) === month; d = addDays(d, 1)) if (dow(d) === 5) n += 1;
  return n;
}

/** Fechamento de cada categoria que a previsão de sexta mostrou (na ordem em que foi mostrada). */
export function buildWeekendRecaps(
  delivered: DeliveredWeekendForecast[],
  transactions: NudgeTransaction[],
  today: string,
  goals: Record<string, NudgeGoal> = {},
): WeekendRecap[] {
  if (dow(today) !== 1) return [];
  const friday = addDays(today, -3);
  return delivered
    .map((d) => d.forecast)
    .filter((f) => f && f.friday === friday)
    .map((f) => recapOf(f, transactions, today, friday, goals[f.category]?.actual));
}

export function buildWeekendRecap(
  delivered: DeliveredWeekendForecast[],
  transactions: NudgeTransaction[],
  today: string,
): WeekendRecap | null {
  return buildWeekendRecaps(delivered, transactions, today)[0] ?? null;
}

function recapOf(forecast: WeekendForecast, transactions: NudgeTransaction[], today: string, friday: string, canonicalMonth?: number): WeekendRecap {
  const sunday = addDays(friday, 2);

  let realized = 0;
  let monthToDate = 0;
  const sameMonth = friday.slice(0, 7) === today.slice(0, 7);
  for (const t of transactions) {
    if (t.category !== forecast.category || !(Number(t.amount) > 0)) continue;
    const day = t.occurred_at.slice(0, 10);
    if (day >= friday && day <= sunday) realized += Number(t.amount);
    if (sameMonth && day.slice(0, 7) === today.slice(0, 7) && day < today) monthToDate += Number(t.amount);
  }
  realized = round2(realized);
  const verdict = realized < forecast.low ? "below" : realized > forecast.high ? "above" : "within";
  const weekendsLeft = fridaysLeftInMonth(today);

  const month = sameMonth ? round2(canonicalMonth != null ? canonicalMonth : monthToDate) : null;
  const slackNow = month != null ? round2(forecast.anchor.amount - month) : null;
  const fairNext = slackNow != null && weekendsLeft > 0
    ? round2(Math.max(0, (slackNow - (forecast.weekday_rate ?? 0) * weekdaysLeftInMonth(today)) / weekendsLeft))
    : null;

  return {
    category: forecast.category,
    friday,
    realized,
    verdict,
    vs_typical: round2(forecast.typical - realized),
    forecast,
    month_to_date: month,
    slack_now: slackNow,
    fair_next: fairNext,
    weekends_left: weekendsLeft,
  };
}

function verdictLine(recap: WeekendRecap): string {
  const f = recap.forecast;
  const word = recap.verdict === "below" ? "abaixo da faixa" : recap.verdict === "above" ? "acima da faixa" : "dentro da faixa";
  const diff = recap.vs_typical >= 0 ? `${brlPt(recap.vs_typical)} a menos que o típico` : `${brlPt(Math.abs(recap.vs_typical))} a mais que o típico`;
  const month = recap.month_to_date != null && recap.slack_now != null
    ? recap.slack_now >= 0
      ? `; no mês ${brlPt(recap.month_to_date)}, restam ${brlPt(recap.slack_now)} até ${f.anchor.kind === "goal" ? "a meta" : "a média"}`
      : `; no mês ${brlPt(recap.month_to_date)}, ${brlPt(Math.abs(recap.slack_now))} acima ${f.anchor.kind === "goal" ? "da meta" : "da média"}`
    : "";
  return `${recap.category}: ${brlPt(recap.realized)}, ${word} (${diff})${month}.`;
}

export function weekendRecapSituation(
  recaps: WeekendRecap | WeekendRecap[] | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  const list = Array.isArray(recaps) ? recaps : recaps ? [recaps] : [];
  if (!list.length) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const recap = list[0];
  const extras = list.slice(1, 3);
  const { forecast: f } = recap;
  const range = Math.abs(f.high - f.low) < 1 ? `por volta de ${brlPt(f.typical)}` : `${brlPt(f.low)} a ${brlPt(f.high)}`;
  const cat = recap.category;

  let title: string;
  let lead: string;
  if (recap.verdict === "below") {
    title = `Fim de semana: ${cat} ficou abaixo do que você costuma gastar`;
    lead = `Você gastou ${brlPt(recap.realized)} com ${cat} (a faixa dos seus últimos fins de semana era ${range}, típico ${brlPt(f.typical)}). Foram ${brlPt(Math.abs(recap.vs_typical))} a menos que o típico.`;
  } else if (recap.verdict === "within") {
    title = `Fim de semana dentro do esperado em ${cat}`;
    lead = `Você gastou ${brlPt(recap.realized)} com ${cat}, dentro da faixa dos seus últimos fins de semana (${range}).`;
  } else {
    title = `Fim de semana: ${cat} passou da sua faixa`;
    lead = `Você gastou ${brlPt(recap.realized)} com ${cat}, acima da faixa dos seus últimos fins de semana (${range}); o típico é ${brlPt(f.typical)}.`;
  }
  if (extras.length) title = "Como foi o fim de semana";

  const anchorWord = f.anchor.kind === "goal" ? "meta" : "média dos últimos meses";
  let monthLine = "";
  if (recap.month_to_date != null && recap.slack_now != null) {
    monthLine = recap.slack_now >= 0
      ? ` ${cat} no mês: ${brlPt(recap.month_to_date)}; restam ${brlPt(recap.slack_now)} até a ${anchorWord} de ${brlPt(f.anchor.amount)}.`
      : ` ${cat} no mês: ${brlPt(recap.month_to_date)}, ${brlPt(Math.abs(recap.slack_now))} acima da ${anchorWord} de ${brlPt(f.anchor.amount)}.`;
  }
  const next = recap.fair_next != null && recap.weekends_left > 0 && recap.verdict !== "below"
    ? ` Para o resto do mês, cabem uns ${brlPt(recap.fair_next)} por fim de semana.`
    : "";
  const more = extras.length ? `\n\nOutras categorias:\n${extras.map(verdictLine).join("\n")}` : "";
  const gap = list.some((r) => r.forecast.data_gap === "card_missing")
    ? " Obs.: compras de cartão podem ainda não ter entrado, então o valor pode estar menor que o real."
    : "";

  return {
    fingerprint: `${WEEKEND_RECAP_VERSION}:${cat}:${recap.friday}`,
    type: "weekend_recap",
    communication_kind: "weekend_spending_risk",
    severity: list.some((r) => r.verdict === "above") ? "attention" : "info",
    title,
    body: `${lead}${monthLine}${next}${more}${gap}`.trim(),
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: Math.abs(recap.vs_typical),
    days_until: 0,
    confidence: 0.8,
    actionable: false,
    route: "/app/relatorios",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: WEEKEND_RECAP_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      recap,
      recaps: list,
    },
  };
}
