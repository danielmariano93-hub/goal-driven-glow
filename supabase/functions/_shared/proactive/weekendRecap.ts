// nino_weekend_recap.v1 — fechamento de segunda: previsto x realizado do fim de
// semana (função pura). É o que fecha o ciclo da previsão de sexta: a pessoa vê
// o que o Nino previu, o que aconteceu e o que isso fez com o mês, e aprende com
// o próprio resultado. Só existe quando a previsão de sexta foi de fato entregue:
// o "previsto" é o que a pessoa leu, não um recálculo feito depois.
//
// Quando a pessoa aceitou o limite ("topo"), o fechamento é sobre o COMBINADO:
// cumpriu ou não, e o que isso fez com o mês. Sem juízo moral.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { isWeekdayNudgeWindow, type NudgeGoal, type NudgeTransaction } from "./weekdayNudge.ts";
import { money0 } from "./weekendMessages.ts";
import type { WeekendForecast } from "./weekendForecast.ts";

export const WEEKEND_RECAP_VERSION = "nino_weekend_recap.v1";

export type DeliveredWeekendForecast = { forecast: WeekendForecast };

/** Combinado aceito pela pessoa para aquele fim de semana. */
export type AcceptedCommitment = { target_amount: number };

export type WeekendRecap = {
  category: string;
  friday: string;
  realized: number;
  verdict: "below" | "within" | "above";
  /** expected − realized (positivo = gastou menos que o esperado). */
  vs_typical: number;
  forecast: WeekendForecast;
  /** Mês corrente da segunda (null se o fim de semana virou o mês). */
  month_to_date: number | null;
  slack_now: number | null;
  fair_next: number | null;
  weekends_left: number;
  /** Fechamento do mês trocando o esperado deste fim de semana pelo realizado. */
  projected_after: number;
  /** Limite aceito pela pessoa (null = não houve combinado). */
  commitment_target: number | null;
  commitment_kept: boolean | null;
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
  commitments: Record<string, AcceptedCommitment> = {},
): WeekendRecap[] {
  if (dow(today) !== 1) return [];
  const friday = addDays(today, -3);
  return delivered
    .map((d) => d.forecast)
    .filter((f) => f && f.friday === friday)
    .map((f) => recapOf(f, transactions, today, friday, goals[f.category]?.actual, commitments[f.category]));
}

export function buildWeekendRecap(
  delivered: DeliveredWeekendForecast[],
  transactions: NudgeTransaction[],
  today: string,
): WeekendRecap | null {
  return buildWeekendRecaps(delivered, transactions, today)[0] ?? null;
}

function recapOf(
  forecast: WeekendForecast,
  transactions: NudgeTransaction[],
  today: string,
  friday: string,
  canonicalMonth?: number,
  commitment?: AcceptedCommitment,
): WeekendRecap {
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
  const target = commitment ? Number(commitment.target_amount) : null;

  return {
    category: forecast.category,
    friday,
    realized,
    verdict,
    vs_typical: round2(forecast.expected_per_weekend - realized),
    forecast,
    month_to_date: month,
    slack_now: slackNow,
    fair_next: fairNext,
    weekends_left: weekendsLeft,
    projected_after: round2(forecast.projected_month - forecast.expected_per_weekend + realized),
    commitment_target: target,
    commitment_kept: target != null ? realized <= target : null,
  };
}

const bold = (text: string) => `*${text}*`;
const plain = (text: string) => text.replace(/\*/g, "");

function anchorWord(f: WeekendForecast): string {
  return f.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses";
}

function monthBlock(recap: WeekendRecap): string | null {
  const f = recap.forecast;
  const gap = recap.projected_after - f.anchor.amount;
  const where = gap > 0
    ? `${bold(`${money0(gap)} acima`)} da ${anchorWord(f)} (${money0(f.anchor.amount)})`
    : `${bold(`${money0(-gap)} abaixo`)} da ${anchorWord(f)} (${money0(f.anchor.amount)})`;
  return `📅 Com isso, o mês de ${f.category} fecha em ${bold(money0(recap.projected_after))}, ${where}.`;
}

function extraLine(recap: WeekendRecap): string {
  const word = recap.commitment_kept != null
    ? recap.commitment_kept ? "dentro do combinado" : "acima do combinado"
    : recap.verdict === "below" ? "abaixo do seu padrão" : recap.verdict === "above" ? "acima do seu padrão" : "dentro do seu padrão";
  return `${recap.category} ${money0(recap.realized)} (${word})`;
}

export function composeRecapMessage(list: WeekendRecap[]): { title: string; body: string; whatsapp: { title: string; body: string } } | null {
  if (!list.length) return null;
  const r = list[0];
  const f = r.forecast;
  const extras = list.slice(1, 3);
  const content: string[] = [];
  let title: string;

  if (r.commitment_target != null) {
    const target = r.commitment_target;
    content.push(`Você combinou ficar em ${bold(money0(target))} com ${r.category} e gastou ${bold(money0(r.realized))}.`);
    if (r.commitment_kept) {
      title = `✅ Combinado cumprido: ${r.category}`;
      const saved = Math.max(0, f.expected_per_weekend - r.realized);
      content.push(`🎉 Cumpriu! Foram ${bold(`${money0(saved)} a menos`)} do que o seu padrão (${money0(f.expected_per_weekend)}).`);
    } else {
      title = `🔎 Como foi o fim de semana: ${r.category}`;
      content.push(`Ficou ${bold(`${money0(r.realized - target)} acima`)} do combinado. Acontece: ainda dá para compensar nos próximos.`);
    }
  } else {
    title = `🔎 Como foi o fim de semana: ${r.category}`;
    const mark = r.verdict === "below" ? "✅" : r.verdict === "above" ? "⚠️" : "👌";
    const word = r.verdict === "below" ? "abaixo do seu padrão" : r.verdict === "above" ? "acima do seu padrão" : "dentro do seu padrão";
    content.push(`${mark} Você gastou ${bold(money0(r.realized))} com ${r.category}, ${word} (uns ${money0(f.expected_per_weekend)}).`);
  }
  content.push(monthBlock(r)!);
  if (r.fair_next != null && r.weekends_left > 0 && r.fair_next > 0 && r.commitment_kept !== true && r.verdict !== "below") {
    content.push(`💡 Para ${r.weekends_left === 1 ? "o próximo fim de semana" : `os ${r.weekends_left} fins de semana que restam`}, cabem uns ${bold(money0(r.fair_next))} por fim de semana.`);
  }
  // Uma linha só: o renderizador do WhatsApp junta quebras simples dentro do mesmo bloco.
  if (extras.length) content.push(`Outras categorias: ${extras.map(extraLine).join(" · ")}.`);
  if (list.some((x) => x.forecast.data_gap === "card_missing")) {
    content.push("ℹ️ Compras de cartão podem ainda não ter entrado, então o valor pode estar menor que o real.");
  }
  const body = content.join("\n\n");
  return { title: plain(title), body: plain(body), whatsapp: { title: plain(title), body } };
}

export function weekendRecapSituation(
  recaps: WeekendRecap | WeekendRecap[] | null,
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  const list = Array.isArray(recaps) ? recaps : recaps ? [recaps] : [];
  if (!list.length) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const message = composeRecapMessage(list);
  if (!message) return null;
  const recap = list[0];

  return {
    fingerprint: `${WEEKEND_RECAP_VERSION}:${recap.category}:${recap.friday}`,
    type: "weekend_recap",
    communication_kind: "weekend_spending_risk",
    severity: list.some((r) => r.verdict === "above" && r.commitment_kept !== true) ? "attention" : "info",
    title: message.title,
    body: message.body,
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
      whatsapp: message.whatsapp,
      // Para o pipeline gravar o resultado dos combinados depois da entrega.
      commitment_outcomes: list
        .filter((r) => r.commitment_target != null)
        .map((r) => ({ category: r.category, friday: r.friday, realized: r.realized, kept: r.commitment_kept })),
    },
  };
}
