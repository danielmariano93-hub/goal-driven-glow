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
