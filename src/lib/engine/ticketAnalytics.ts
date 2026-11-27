// Análises do Ticket Alimentação (handoff 27/11/2026). Funções puras sobre os lançamentos do Ticket e as despesas de
// comida pagas do bolso. Nada aqui grava dado: a tela só lê. Regras:
//  - consumo do Ticket = gastos lançados na carteira; recarga, leitura de saldo e ajuste não são consumo;
//  - bolso = despesas reais (movement_kind 'transaction') nas categorias de comida, pela data da compra;
//  - dia desconhecido (antes do primeiro dado do ciclo) não entra como zero;
//  - ciclo incompleto aparece, mas fica fora de comparações automáticas.
import { benefitAddDays, daysBetween, type BenefitEntry, type BenefitState, type TicketCycle } from "./benefitWallet";
import { merchantLabel, normalizeMerchant } from "./merchant";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const parse = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** 0 = segunda … 6 = domingo. */
export const weekdayOf = (iso: string) => (new Date(parse(iso)).getUTCDay() + 6) % 7;
export const WEEKDAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] as const;
export const WEEKDAY_FULL = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"] as const;
export const WEEKDAY_PLURAL = ["segundas", "terças", "quartas", "quintas", "sextas", "sábados", "domingos"] as const;

export type FoodSource = "ticket" | "own";
export type SourceFilter = FoodSource | "total";

/** Um gasto de comida, de qualquer fonte. */
export interface FoodRow { id: string; date: string; amount: number; source: FoodSource; merchant: string | null }

export function ticketFoodRows(entries: Array<BenefitEntry & { merchant?: string | null }>): FoodRow[] {
  return entries.filter((e) => e.kind === "spend").map((e) => ({ id: e.id, date: e.occurred_on, amount: Math.abs(Number(e.amount) || 0), source: "ticket" as const, merchant: e.merchant ?? null }));
}

const pick = (rows: FoodRow[], f: SourceFilter) => (f === "total" ? rows : rows.filter((r) => r.source === f));

/** Janela de dias CONHECIDOS de um ciclo: do primeiro dado (se o ciclo for incompleto) até o último dia fechado. */
export function knownWindow(c: TicketCycle, today: string, spentToday: boolean): { from: string; to: string; days: number } | null {
  const from = c.incomplete && c.data_from && c.data_from > c.start ? c.data_from : c.start;
  const lastClosed = spentToday ? today : benefitAddDays(today, -1);
  const to = c.end < lastClosed ? c.end : lastClosed;
  if (to < from) return null;
  return { from, to, days: daysBetween(from, to) + 1 };
}

// ---------------------------------------------------------------- Quando você mais gasta

export interface WeekdayAvg { weekday: number; label: string; total: number; occurrences: number; avg: number | null }
export interface WeekdayAverages { from: string; to: string; days: number; by_weekday: WeekdayAvg[]; total: number }

/** Média por ocorrência do dia da semana, contando os dias sem compra como zero (nunca divide por transações). */
export function weekdayAverages(rows: FoodRow[], filter: SourceFilter, from: string, to: string): WeekdayAverages {
  const occ = Array.from({ length: 7 }, () => 0);
  const tot = Array.from({ length: 7 }, () => 0);
  for (let d = from; d <= to; d = benefitAddDays(d, 1)) occ[weekdayOf(d)] += 1;
  for (const r of pick(rows, filter)) if (r.date >= from && r.date <= to) tot[weekdayOf(r.date)] += r.amount;
  const by = occ.map((n, i) => ({ weekday: i, label: WEEKDAY_SHORT[i], total: round2(tot[i]), occurrences: n, avg: n > 0 ? round2(tot[i] / n) : null }));
  return { from, to, days: occ.reduce((a, b) => a + b, 0), by_weekday: by, total: round2(tot.reduce((a, b) => a + b, 0)) };
}

/** Insight geral do período ("No período"): o dia de maior média contra a média dos outros dias. Exige 4 ocorrências. */
export function weekdayPeak(w: WeekdayAverages): { weekday: number; avg: number; others_avg: number; ratio: number; share_pct: number } | null {
  const valid = w.by_weekday.filter((d) => d.avg !== null && d.occurrences >= 4);
  if (valid.length < 7 || w.total <= 0) return null;
  const top = valid.reduce((b, d) => ((d.avg ?? 0) > (b.avg ?? 0) ? d : b), valid[0]);
  const otherOcc = w.by_weekday.reduce((a, d) => a + (d.weekday === top.weekday ? 0 : d.occurrences), 0);
  const others = otherOcc > 0 ? (w.total - top.total) / otherOcc : 0;
  return { weekday: top.weekday, avg: top.avg ?? 0, others_avg: round2(others), ratio: others > 0 ? round2((top.avg ?? 0) / others) : 0, share_pct: Math.round((top.total / w.total) * 100) };
}

// ---------------------------------------------------------------- Desempenho comparativo

export interface CycleTotals { ticket: number; own: number; total: number; coverage_pct: number | null; ticket_per_day: number | null; days: number; purchases: number }
export function totalsIn(rows: FoodRow[], from: string, to: string): CycleTotals {
  const inside = rows.filter((r) => r.date >= from && r.date <= to);
  const t = round2(inside.filter((r) => r.source === "ticket").reduce((a, r) => a + r.amount, 0));
  const o = round2(inside.filter((r) => r.source === "own").reduce((a, r) => a + r.amount, 0));
  const days = to >= from ? daysBetween(from, to) + 1 : 0;
  return {
    ticket: t, own: o, total: round2(t + o),
    coverage_pct: t + o > 0 ? round2((t / (t + o)) * 100) : null,
    ticket_per_day: days > 0 ? round2(t / days) : null,
    days, purchases: inside.filter((r) => r.source === "ticket").length,
  };
}

export interface Performance {
  cycle: TicketCycle;
  window: { from: string; to: string };
  current: CycleTotals;
  /** Base de comparação equivalente; null quando não há (sem ciclo anterior ou ele está incompleto). */
  previous: (CycleTotals & { from: string; to: string; same_days: boolean }) | null;
  unavailable_reason: "no_previous" | "previous_incomplete" | null;
}

/** Ciclo aberto: compara com os mesmos dias decorridos do ciclo anterior. Encerrado: ciclo anterior inteiro. */
export function performance(cycles: TicketCycle[], index: number, rows: FoodRow[], today: string, spentToday: boolean): Performance | null {
  const c = cycles[index];
  if (!c) return null;
  const win = knownWindow(c, today, spentToday);
  if (!win) return null;
  const current = totalsIn(rows, win.from, win.to);
  const prev = cycles[index - 1];
  if (!prev) return { cycle: c, window: win, current, previous: null, unavailable_reason: "no_previous" };
  if (prev.incomplete || c.incomplete) return { cycle: c, window: win, current, previous: null, unavailable_reason: "previous_incomplete" };
  const pFrom = prev.start;
  const pTo = c.open ? (() => { const t = benefitAddDays(prev.start, daysBetween(c.start, win.to)); return t < prev.end ? t : prev.end; })() : prev.end;
  const p = totalsIn(rows, pFrom, pTo);
  return { cycle: c, window: win, current, previous: { ...p, from: pFrom, to: pTo, same_days: p.days === current.days }, unavailable_reason: null };
}

/** Variação discreta: p.p. para cobertura, R$ e % para valores. Base zero → "novo"; ambos zero → sem variação. */
export function deltaMoney(cur: number, prev: number | null): { abs: number; pct: number | null; kind: "new" | "none" | "change" } | null {
  if (prev === null) return null;
  if (prev === 0 && cur === 0) return { abs: 0, pct: null, kind: "none" };
  if (prev === 0) return { abs: round2(cur), pct: null, kind: "new" };
  return { abs: round2(cur - prev), pct: Math.round(((cur - prev) / prev) * 100), kind: "change" };
}

// ---------------------------------------------------------------- Onde você mais gasta

export interface MerchantRow {
  key: string; label: string;
  ticket: number; own: number; total: number; count: number; avg: number;
  prev_ticket: number; prev_own: number; prev_total: number; prev_count: number;
  top_weekday: number | null;
}

const merchantKeyOf = (raw: string | null) => {
  const n = normalizeMerchant(raw);
  return n ? { key: n, label: merchantLabel(n) } : { key: "__none__", label: "Não identificado" };
};
export const merchantKey = (raw: string | null) => merchantKeyOf(raw).key;

/** Ranking por estabelecimento (agrupado pelo nome normalizado; filiais e nomes diferentes não se fundem). */
export function merchantRanking(rows: FoodRow[], cur: { from: string; to: string }, prev: { from: string; to: string } | null, sortBy: SourceFilter = "total"): MerchantRow[] {
  const map = new Map<string, MerchantRow & { wd: number[] }>();
  const get = (raw: string | null) => {
    const k = merchantKeyOf(raw);
    let m = map.get(k.key);
    if (!m) { m = { key: k.key, label: k.label, ticket: 0, own: 0, total: 0, count: 0, avg: 0, prev_ticket: 0, prev_own: 0, prev_total: 0, prev_count: 0, top_weekday: null, wd: Array(7).fill(0) }; map.set(k.key, m); }
    return m;
  };
  for (const r of rows) {
    if (r.date >= cur.from && r.date <= cur.to) {
      const m = get(r.merchant);
      if (r.source === "ticket") m.ticket += r.amount; else m.own += r.amount;
      m.count += 1; m.wd[weekdayOf(r.date)] += 1;
    } else if (prev && r.date >= prev.from && r.date <= prev.to) {
      const m = get(r.merchant);
      if (r.source === "ticket") m.prev_ticket += r.amount; else m.prev_own += r.amount;
      m.prev_count += 1;
    }
  }
  const out = [...map.values()].filter((m) => m.count > 0).map(({ wd, ...m }) => {
    const total = round2(m.ticket + m.own);
    const top = wd.reduce((b, n, i) => (n > wd[b] ? i : b), 0);
    return { ...m, ticket: round2(m.ticket), own: round2(m.own), total, avg: round2(total / m.count), prev_ticket: round2(m.prev_ticket), prev_own: round2(m.prev_own), prev_total: round2(m.prev_ticket + m.prev_own), top_weekday: wd[top] > 0 ? top : null };
  });
  const val = (m: MerchantRow) => (sortBy === "ticket" ? m.ticket : sortBy === "own" ? m.own : m.total);
  return out.filter((m) => val(m) > 0).sort((a, b) => val(b) - val(a) || b.total - a.total || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- Resumo: ritmo, limite, margem, autonomia

export interface DailyKpis { rate: number | null; limit: number | null; margin: number | null; autonomy_days: number | null; days_left: number; uncovered_days: number | null }
/** Limite = saldo (do início do dia) ÷ dias restantes; margem = limite − ritmo; autonomia = saldo ÷ ritmo. */
export function dailyKpis(state: BenefitState): DailyKpis {
  const rate = state.rate.per_day > 0 ? state.rate.per_day : null;
  const bal = state.day_start_balance;
  const daysLeft = state.cycle.days_left;
  const limit = bal !== null && daysLeft > 0 ? round2(Math.max(0, bal) / daysLeft) : null;
  const autonomy = bal !== null && rate ? round2(Math.max(0, bal) / rate) : null;
  return {
    rate, limit,
    margin: limit !== null && rate !== null ? round2(limit - rate) : null,
    autonomy_days: autonomy,
    days_left: daysLeft,
    uncovered_days: autonomy !== null ? round2(Math.max(0, daysLeft - autonomy)) : null,
  };
}

// ---------------------------------------------------------------- Extrato

export type StatementKind = "purchase" | "credit" | "reading" | "adjustment";
export interface StatementRow { id: string; date: string; source: FoodSource; kind: StatementKind; merchant: string | null; amount: number; note?: string | null; editable: boolean }
export interface StatementFilters { from?: string | null; to?: string | null; source?: SourceFilter; kinds?: StatementKind[]; merchantKey?: string | null; weekday?: number | null; search?: string }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function filterStatement(rows: StatementRow[], f: StatementFilters): StatementRow[] {
  const q = f.search ? fold(f.search) : "";
  return rows.filter((r) =>
    (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
    && (!f.source || f.source === "total" || r.source === f.source)
    && (!f.kinds?.length || f.kinds.includes(r.kind))
    && (!f.merchantKey || merchantKey(r.merchant) === f.merchantKey)
    && (f.weekday == null || weekdayOf(r.date) === f.weekday)
    && (!q || fold(`${r.merchant ?? ""} ${normalizeMerchant(r.merchant) ?? ""}`).includes(q)),
  ).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Totais do filtro: consumo (compras) separado de recargas; crédito nunca soma no consumo. */
export function statementTotals(rows: StatementRow[]) {
  const purchases = rows.filter((r) => r.kind === "purchase");
  const credits = rows.filter((r) => r.kind === "credit");
  return {
    consumption: round2(purchases.reduce((a, r) => a + r.amount, 0)),
    purchases: purchases.length,
    credits_total: round2(credits.reduce((a, r) => a + r.amount, 0)),
    credits: credits.length,
  };
}

// ---------------------------------------------------------------- O que mudou (decomposição frequência × valor médio)

export interface ChangeDecomposition { kind: "new" | "stopped" | "change"; before: number; after: number; freq_effect: number; avg_effect: number; total: number; n0: number; n1: number; m0: number; m1: number }
/** Gasto = frequência × valor médio. Efeito frequência = (N1 − N0) × M0; efeito valor médio = N1 × (M1 − M0).
 *  Soma = gasto atual − anterior. É decomposição contábil, não prova de causa. */
export function decomposeChange(n0: number, total0: number, n1: number, total1: number): ChangeDecomposition {
  const m0 = n0 > 0 ? total0 / n0 : 0;
  const m1 = n1 > 0 ? total1 / n1 : 0;
  const kind = n0 === 0 ? "new" : n1 === 0 ? "stopped" : "change";
  const freq = kind === "change" ? (n1 - n0) * m0 : 0;
  const avg = kind === "change" ? n1 * (m1 - m0) : 0;
  return { kind, before: round2(total0), after: round2(total1), freq_effect: round2(freq), avg_effect: round2(avg), total: round2(total1 - total0), n0, n1, m0: round2(m0), m1: round2(m1) };
}

// ---------------------------------------------------------------- Quando seu bolso pesa mais (etapas do ciclo)

export interface CycleStage { label: string; from: string; to: string; days: number; ticket: number; own: number; total: number; ticket_pct: number | null; own_per_day: number; total_per_day: number }
/** Etapas do ciclo: dias 1–7, 8–14, 15–21 e 22 até o fim, cortadas na janela conhecida. Médias por dia porque as
 *  etapas têm tamanhos diferentes. */
export function cycleStages(rows: FoodRow[], cycleStart: string, win: { from: string; to: string }): { stages: CycleStage[]; final_own_share: number | null } {
  const bounds: Array<[string, number, number | null]> = [["Dias 1–7", 0, 6], ["Dias 8–14", 7, 13], ["Dias 15–21", 14, 20], ["Dia 22 ao fim", 21, null]];
  const stages: CycleStage[] = [];
  for (const [label, a, b] of bounds) {
    const s = benefitAddDays(cycleStart, a);
    const e = b === null ? win.to : benefitAddDays(cycleStart, b);
    const from = s < win.from ? win.from : s;
    const to = e > win.to ? win.to : e;
    if (to < from) continue;
    const t = totalsIn(rows, from, to);
    stages.push({ label, from, to, days: t.days, ticket: t.ticket, own: t.own, total: t.total, ticket_pct: t.coverage_pct, own_per_day: round2(t.own / t.days), total_per_day: round2(t.total / t.days) });
  }
  const ownTotal = stages.reduce((a, s) => a + s.own, 0);
  const last = stages[stages.length - 1];
  return { stages, final_own_share: ownTotal > 0 && last && last.label === "Dia 22 ao fim" ? Math.round((last.own / ownTotal) * 100) : null };
}

/** Associação temporal: quanto do bolso saiu em dias em que o Ticket começou o dia com menos que um dia típico de
 *  consumo. `balanceAt(d)` devolve o saldo do Ticket no fim do dia `d` (null quando não dá para reconstruir). */
export function ownAfterDepletion(rows: FoodRow[], win: { from: string; to: string }, typicalDay: number, balanceAt: (d: string) => number | null) {
  let known = 0; let unknown = 0; let ownLow = 0; let ownTotal = 0; let lowDays = 0;
  for (let d = win.from; d <= win.to; d = benefitAddDays(d, 1)) {
    const start = balanceAt(benefitAddDays(d, -1));
    const own = rows.filter((r) => r.source === "own" && r.date === d).reduce((a, r) => a + r.amount, 0);
    ownTotal += own;
    if (start === null) { unknown += 1; continue; }
    known += 1;
    if (start < typicalDay) { lowDays += 1; ownLow += own; }
  }
  return { reliable: unknown === 0 && known > 0, low_days: lowDays, own_low: round2(ownLow), own_total: round2(ownTotal), share: ownTotal > 0 ? Math.round((ownLow / ownTotal) * 100) : null };
}

// ---------------------------------------------------------------- Previsão por dia da semana (P2, com teste retroativo)

export const WEEKDAY_FORECAST_VERSION = "ticket_weekday_forecast.v1";
/** Consumo previsto de `from` a `to` pela média de cada dia da semana nas `weeks` semanas fechadas antes de `from`. */
export function weekdayForecast(rows: FoodRow[], from: string, to: string, weeks = 8): number | null {
  const histTo = benefitAddDays(from, -1);
  const ticketDates = rows.filter((r) => r.source === "ticket").map((r) => r.date).sort();
  if (!ticketDates.length) return null;
  const histFromWanted = benefitAddDays(from, -weeks * 7);
  const histFrom = ticketDates[0] > histFromWanted ? ticketDates[0] : histFromWanted;
  if (daysBetween(histFrom, histTo) + 1 < 28) return null;
  const avgs = weekdayAverages(rows, "ticket", histFrom, histTo).by_weekday.map((d) => d.avg ?? 0);
  let sum = 0;
  for (let d = from; d <= to; d = benefitAddDays(d, 1)) sum += avgs[weekdayOf(d)];
  return round2(sum);
}
/** Ritmo constante: média dos 14 dias fechados antes de `from` × dias restantes (mesma regra do ritmo do Resumo). */
export function constantForecast(rows: FoodRow[], from: string, to: string): number | null {
  const a = benefitAddDays(from, -14); const b = benefitAddDays(from, -1);
  const first = rows.filter((r) => r.source === "ticket").reduce<string | null>((m, r) => (m === null || r.date < m ? r.date : m), null);
  if (!first || first > a) return null;
  const rate = totalsIn(rows, a, b).ticket / 14;
  return round2(rate * (daysBetween(from, to) + 1));
}
export interface ForecastBacktest { version: string; cut_day: number; cases: Array<{ start: string; end: string; actual: number; constant: number; weekday: number }>; mae_constant: number | null; mae_weekday: number | null; better: boolean }
/** Teste fora da amostra: em cada ciclo encerrado e completo, prevê do dia `cutDay` ao fim com cada modelo e compara
 *  com o que de fato foi gasto. O modelo por dia da semana só "ganha" com pelo menos 2 ciclos e erro menor em todos. */
export function backtestForecast(cycles: TicketCycle[], rows: FoodRow[], cutDay = 10): ForecastBacktest {
  const cases: ForecastBacktest["cases"] = [];
  for (const c of cycles) {
    if (c.open || c.incomplete) continue;
    const from = benefitAddDays(c.start, cutDay - 1);
    if (from > c.end) continue;
    const wk = weekdayForecast(rows, from, c.end);
    const ct = constantForecast(rows, from, c.end);
    if (wk === null || ct === null) continue;
    cases.push({ start: c.start, end: c.end, actual: totalsIn(rows, from, c.end).ticket, constant: ct, weekday: wk });
  }
  const mae = (k: "constant" | "weekday") => (cases.length ? round2(cases.reduce((a, x) => a + Math.abs(x[k] - x.actual), 0) / cases.length) : null);
  const better = cases.length >= 2 && cases.every((x) => Math.abs(x.weekday - x.actual) < Math.abs(x.constant - x.actual));
  return { version: WEEKDAY_FORECAST_VERSION, cut_day: cutDay, cases, mae_constant: mae("constant"), mae_weekday: mae("weekday"), better };
}

// ---------------------------------------------------------------- Oportunidade: trocar a fonte

/** Comida paga do bolso em lugares onde o Ticket já foi aceito neste ciclo, limitada ao que deve sobrar no Ticket.
 *  Não é economia de consumo: o gasto total não muda, só sai do Ticket em vez do bolso. */
export function sourceSwap(ranking: MerchantRow[], projectedLeftover: number | null): { amount: number; merchants: string[]; capped: boolean } | null {
  const where = ranking.filter((m) => m.key !== "__none__" && m.ticket > 0 && m.own > 0);
  const own = round2(where.reduce((a, m) => a + m.own, 0));
  if (own < 20 || projectedLeftover === null || projectedLeftover <= 0) return null;
  const amount = round2(Math.min(own, projectedLeftover));
  return { amount, merchants: where.sort((a, b) => b.own - a.own).slice(0, 3).map((m) => m.label), capped: amount < own };
}
