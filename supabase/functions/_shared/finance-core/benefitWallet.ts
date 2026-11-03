// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor do Ticket Alimentação (`benefit_wallet.v1`). Puro e determinístico: sem consulta, sem LLM.
// Benefício NÃO é renda nem caixa livre: este motor só enxerga a carteira do benefício (contexto separado do livro-razão).
//
// Modelo: crédito fixo (`monthly_credit`) em data certa (`credit_day`), com sobra que acumula (`carries_over`) ou não.
// O saldo é ancorado na última LEITURA de saldo informada; depois dela entram os gastos lançados e os créditos
// (os explícitos e os previstos pela data do crédito, que não precisam ser lançados à mão).
// Datas civis `YYYY-MM-DD` (sem fuso).

export const BENEFIT_ENGINE_VERSION = "benefit_wallet.v1";

export type BenefitKind = "credit" | "spend" | "balance_reading" | "adjustment";

export interface BenefitWalletConfig {
  monthly_credit: number;
  /** 1–31. Em mês mais curto, vale o último dia do mês. */
  credit_day: number;
  carries_over: boolean;
}

export interface BenefitEntry {
  id: string;
  kind: BenefitKind;
  amount: number;
  occurred_on: string;
  merchant?: string | null;
}

const DAY_MS = 86_400_000;
const parse = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fmt(parse(iso) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY_MS);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** Data do crédito num mês (0-based), com o dia limitado ao tamanho do mês. */
export function creditDateInMonth(year: number, month0: number, creditDay: number): string {
  return fmt(Date.UTC(year, month0, Math.min(Math.max(1, creditDay), daysInMonth(year, month0))));
}

/** Datas de crédito em (after, upTo]. */
export function creditDatesBetween(creditDay: number, after: string, upTo: string): string[] {
  const out: string[] = [];
  let y = Number(after.slice(0, 4));
  let m = Number(after.slice(5, 7)) - 1;
  const endY = Number(upTo.slice(0, 4));
  const endM = Number(upTo.slice(5, 7)) - 1;
  while (y < endY || (y === endY && m <= endM)) {
    const c = creditDateInMonth(y, m, creditDay);
    if (c > after && c <= upTo) out.push(c);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

export interface CycleBounds {
  start: string;
  next: string;
  total_days: number;
  elapsed_days: number;
  days_left: number;
}

/** Ciclo atual: do último crédito (inclusive) até o próximo (exclusive). */
export function cycleBounds(creditDay: number, today: string): CycleBounds {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const thisMonth = creditDateInMonth(y, m, creditDay);
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 11 : m - 1;
  const nextY = m === 11 ? y + 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  const start = thisMonth <= today ? thisMonth : creditDateInMonth(prevY, prevM, creditDay);
  const next = thisMonth <= today ? creditDateInMonth(nextY, nextM, creditDay) : thisMonth;
  return {
    start,
    next,
    total_days: daysBetween(start, next),
    elapsed_days: daysBetween(start, today),
    days_left: daysBetween(today, next),
  };
}

export interface BalanceResult {
  /** null enquanto não há leitura de saldo. */
  balance: number | null;
  anchor: { date: string; amount: number } | null;
  reading_age_days: number | null;
  /** O saldo calculado ficou negativo (faltam lançamentos); o valor mostrado é limitado a zero. */
  inconsistent: boolean;
}

type Ev = { date: string; order: number; kind: "credit" | "delta"; amount: number };

/** Crédito previsto que o usuário não precisou lançar: uma data de crédito sem crédito explícito num raio de 2 dias. */
function impliedCredits(w: BenefitWalletConfig, entries: BenefitEntry[], after: string, upTo: string): string[] {
  const explicit = entries.filter((e) => e.kind === "credit").map((e) => e.occurred_on);
  return creditDatesBetween(w.credit_day, after, upTo).filter((c) => !explicit.some((d) => Math.abs(daysBetween(c, d)) <= 2));
}

/** Eventos de saldo depois da leitura (exclusive) até `upTo` (inclusive), em ordem cronológica. */
function eventsAfter(w: BenefitWalletConfig, entries: BenefitEntry[], after: string, upTo: string): Ev[] {
  const events: Ev[] = [];
  for (const e of entries) {
    if (e.occurred_on <= after || e.occurred_on > upTo) continue;
    if (e.kind === "spend") events.push({ date: e.occurred_on, order: 1, kind: "delta", amount: -e.amount });
    else if (e.kind === "adjustment") events.push({ date: e.occurred_on, order: 1, kind: "delta", amount: e.amount });
    else if (e.kind === "credit") events.push({ date: e.occurred_on, order: 0, kind: "credit", amount: e.amount });
  }
  for (const c of impliedCredits(w, entries, after, upTo)) events.push({ date: c, order: 0, kind: "credit", amount: w.monthly_credit });
  return events.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
}

/** Saldo em `today`. A leitura vale para o fim do dia: lançamentos do mesmo dia da leitura já estão dentro dela. */
export function computeBalance(w: BenefitWalletConfig, entries: BenefitEntry[], today: string): BalanceResult {
  const readings = entries.filter((e) => e.kind === "balance_reading" && e.occurred_on <= today);
  if (!readings.length) return { balance: null, anchor: null, reading_age_days: null, inconsistent: false };
  let anchor = readings[0];
  for (const r of readings) if (r.occurred_on >= anchor.occurred_on) anchor = r;
  let bal = anchor.amount;
  for (const ev of eventsAfter(w, entries, anchor.occurred_on, today)) {
    if (ev.kind === "credit") bal = w.carries_over ? bal + ev.amount : ev.amount;
    else bal += ev.amount;
  }
  return {
    balance: round2(Math.max(0, bal)),
    anchor: { date: anchor.occurred_on, amount: anchor.amount },
    reading_age_days: daysBetween(anchor.occurred_on, today),
    inconsistent: bal < -0.004,
  };
}

export interface RateResult {
  per_day: number;
  source: "spends" | "readings" | "none";
  days_observed: number;
}

/** Ritmo diário: gastos lançados nos últimos 14 dias; sem gastos lançados, a diferença entre duas leituras de saldo. */
export function computeRate(w: BenefitWalletConfig, entries: BenefitEntry[], today: string, windowDays = 14): RateResult {
  if (!entries.length) return { per_day: 0, source: "none", days_observed: 0 };
  const first = entries.reduce((min, e) => (e.occurred_on < min ? e.occurred_on : min), entries[0].occurred_on);
  const observed = Math.max(0, Math.min(windowDays, daysBetween(first, today) + 1));
  const from = addDays(today, -(windowDays - 1));
  const spends = entries.filter((e) => e.kind === "spend" && e.occurred_on >= from && e.occurred_on <= today);
  if (spends.length > 0 && observed >= 3) {
    const total = spends.reduce((s, e) => s + e.amount, 0);
    return { per_day: round2(total / observed), source: "spends", days_observed: observed };
  }
  const readings = entries.filter((e) => e.kind === "balance_reading" && e.occurred_on <= today).sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1));
  if (readings.length >= 2) {
    const r1 = readings[readings.length - 1];
    const r0 = readings[readings.length - 2];
    const days = daysBetween(r0.occurred_on, r1.occurred_on);
    if (days >= 3) {
      const credits = eventsAfter(w, entries, r0.occurred_on, r1.occurred_on).filter((e) => e.kind === "credit");
      let spent: number;
      if (!credits.length) spent = r0.amount - r1.amount;
      else if (w.carries_over) spent = r0.amount + credits.reduce((s, c) => s + c.amount, 0) - r1.amount;
      else spent = credits[credits.length - 1].amount - r1.amount;
      if (spent > 0) return { per_day: round2(spent / days), source: "readings", days_observed: days };
    }
  }
  return { per_day: 0, source: "none", days_observed: observed };
}

export type BenefitStatus = "ok" | "tight" | "short" | "unknown";

export interface Projection {
  /** Quantos dias o saldo cobre no ritmo dado; null = sem ritmo. */
  covers_days: number | null;
  /** Data em que o saldo acaba; null se cobre até o próximo crédito. */
  depletion_date: string | null;
  uncovered_days: number;
  /** O que sairia do bolso até o próximo crédito. */
  shortfall: number;
  /** O que sobra para o próximo ciclo (a sobra acumula quando a carteira permite). */
  leftover: number;
  status: BenefitStatus;
}

export function project(balance: number, daysLeft: number, perDay: number, today: string): Projection {
  if (!(perDay > 0)) return { covers_days: null, depletion_date: null, uncovered_days: 0, shortfall: 0, leftover: round2(balance), status: "unknown" };
  const covers = balance / perDay;
  const uncovered = Math.max(0, daysLeft - covers);
  const need = perDay * daysLeft;
  return {
    covers_days: round2(covers),
    depletion_date: covers < daysLeft ? addDays(today, Math.ceil(covers)) : null,
    uncovered_days: round2(uncovered),
    shortfall: round2(Math.max(0, need - balance)),
    leftover: round2(Math.max(0, balance - need)),
    status: uncovered >= 3 ? "short" : uncovered > 0 ? "tight" : "ok",
  };
}

export interface BenefitState {
  version: typeof BENEFIT_ENGINE_VERSION;
  today: string;
  cycle: CycleBounds;
  balance: number | null;
  /** Há leitura, mas não é de hoje: o saldo é estimado. */
  estimated: boolean;
  reading_age_days: number | null;
  needs_reading: boolean;
  inconsistent: boolean;
  rate: RateResult;
  /** Quanto dá para gastar por dia até o próximo crédito. */
  ideal_per_day: number | null;
  projection: Projection | null;
  /** Gastos lançados no ciclo atual. */
  spent_in_cycle: number;
  /** Quanto sobrou do ciclo anterior; null se não dá para saber. */
  carry_in: number | null;
}

export function computeBenefitState(w: BenefitWalletConfig, entries: BenefitEntry[], today: string): BenefitState {
  const cycle = cycleBounds(w.credit_day, today);
  const bal = computeBalance(w, entries, today);
  const rate = computeRate(w, entries, today);
  const spentInCycle = round2(entries.filter((e) => e.kind === "spend" && e.occurred_on >= cycle.start && e.occurred_on <= today).reduce((s, e) => s + e.amount, 0));
  let carryIn: number | null = null;
  if (w.carries_over) {
    const atStart = computeBalance(w, entries, addDays(cycle.start, -1));
    if (atStart.balance !== null) carryIn = atStart.balance;
  } else {
    carryIn = 0;
  }
  const balance = bal.balance;
  return {
    version: BENEFIT_ENGINE_VERSION,
    today,
    cycle,
    balance,
    estimated: bal.anchor !== null && (bal.reading_age_days ?? 0) > 0,
    reading_age_days: bal.reading_age_days,
    needs_reading: balance === null,
    inconsistent: bal.inconsistent,
    rate,
    ideal_per_day: balance === null ? null : round2(balance / Math.max(1, cycle.days_left)),
    projection: balance === null ? null : project(balance, cycle.days_left, rate.per_day, today),
    spent_in_cycle: spentInCycle,
    carry_in: carryIn,
  };
}

/** "E se eu gastar R$ X por dia?" */
export function whatIf(state: BenefitState, perDay: number): Projection | null {
  if (state.balance === null) return null;
  return project(state.balance, state.cycle.days_left, perDay, state.today);
}

/** Saldo dia a dia no ciclo atual (null antes da primeira leitura). */
export function balanceSeries(w: BenefitWalletConfig, entries: BenefitEntry[], today: string): Array<{ date: string; balance: number | null }> {
  const { start } = cycleBounds(w.credit_day, today);
  const out: Array<{ date: string; balance: number | null }> = [];
  for (let d = start; d <= today; d = addDays(d, 1)) out.push({ date: d, balance: computeBalance(w, entries, d).balance });
  return out;
}

export const WEEKDAY_LABELS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] as const;

export interface WeekdayPattern {
  by_weekday: Array<{ weekday: number; label: string; total: number; avg_per_occurrence: number; share_pct: number }>;
  total: number;
  /** null enquanto não há dados suficientes (menos de 14 dias de histórico ou menos de 6 gastos). */
  peak: { weekday: number; label: string; share_pct: number; avg_per_occurrence: number; others_avg: number; ratio: number } | null;
}

/** Gasto por dia da semana nas últimas `weeks` semanas (precisa de gastos lançados, não só leituras de saldo). */
export function weekdayPattern(entries: BenefitEntry[], today: string, weeks = 8): WeekdayPattern {
  const from = addDays(today, -(weeks * 7 - 1));
  const spends = entries.filter((e) => e.kind === "spend" && e.occurred_on >= from && e.occurred_on <= today);
  const totals = Array.from({ length: 7 }, () => 0);
  for (const s of spends) totals[(new Date(parse(s.occurred_on)).getUTCDay() + 6) % 7] += s.amount;
  const total = totals.reduce((a, b) => a + b, 0);
  const by = totals.map((t, i) => ({
    weekday: i,
    label: WEEKDAY_LABELS[i],
    total: round2(t),
    avg_per_occurrence: round2(t / weeks),
    share_pct: total > 0 ? Math.round((t / total) * 100) : 0,
  }));
  const firstSpend = spends.reduce((min, e) => (e.occurred_on < min ? e.occurred_on : min), today);
  const enough = spends.length >= 6 && daysBetween(firstSpend, today) >= 13;
  let peak: WeekdayPattern["peak"] = null;
  if (enough && total > 0) {
    const top = by.reduce((best, d) => (d.total > best.total ? d : best), by[0]);
    const othersAvg = (total - top.total) / (weeks * 6);
    peak = {
      weekday: top.weekday,
      label: top.label,
      share_pct: top.share_pct,
      avg_per_occurrence: top.avg_per_occurrence,
      others_avg: round2(othersAvg),
      ratio: othersAvg > 0 ? round2(top.avg_per_occurrence / othersAvg) : 0,
    };
  }
  return { by_weekday: by, total: round2(total), peak };
}

export interface MerchantRow {
  merchant: string;
  total: number;
  share_pct: number;
}

/** Para onde foi no ciclo atual: ranking por estabelecimento (sem nome vira "Sem nome"; o excedente vira "Outros"). */
export function merchantBreakdown(entries: BenefitEntry[], from: string, to: string, limit = 5): MerchantRow[] {
  const groups = new Map<string, { label: string; total: number }>();
  for (const e of entries) {
    if (e.kind !== "spend" || e.occurred_on < from || e.occurred_on > to) continue;
    const label = (e.merchant ?? "").trim() || "Sem nome";
    const key = label.toLocaleLowerCase("pt-BR");
    const g = groups.get(key) ?? { label, total: 0 };
    g.total += e.amount;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const head = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((s, r) => s + r.total, 0);
  const out = head.map((r) => ({ merchant: r.label, total: round2(r.total), share_pct: total > 0 ? Math.round((r.total / total) * 100) : 0 }));
  if (rest > 0) out.push({ merchant: "Outros", total: round2(rest), share_pct: total > 0 ? Math.round((rest / total) * 100) : 0 });
  return out;
}

export interface Suggestion {
  id: "weekday_cap" | "half_delivery" | "daily_cap";
  title: string;
  body: string;
  /** Economia estimada por mês; null quando é uma meta, não uma economia. */
  monthly_saving: number | null;
}

const DELIVERY_RX = /ifood|rappi|uber ?eats|99 ?food|delivery/i;
const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/,00$/, "")}`;

/** Sugestões determinísticas e ancoradas nos dados (nenhuma texto de IA, nenhum número inventado). */
export function suggestions(state: BenefitState, pattern: WeekdayPattern, merchants: MerchantRow[]): Suggestion[] {
  const out: Suggestion[] = [];
  const peak = pattern.peak;
  if (peak && peak.share_pct >= 25 && peak.ratio >= 1.5 && peak.others_avg > 0) {
    const cap = roundTo5(peak.others_avg * 1.6);
    const saving = Math.max(0, peak.avg_per_occurrence - cap) * 4.3;
    if (saving >= 10) {
      out.push({
        id: "weekday_cap",
        title: `Teto de ${brl(cap)} às ${peak.label === "sáb" ? "sábados" : peak.label === "dom" ? "domingos" : `${peak.label === "seg" ? "segundas" : peak.label === "ter" ? "terças" : peak.label === "qua" ? "quartas" : peak.label === "qui" ? "quintas" : "sextas"}`}`,
        body: `Hoje esse dia custa em média ${brl(peak.avg_per_occurrence)}, ${peak.ratio.toFixed(1).replace(".", ",")} vezes a média dos outros dias (${brl(peak.others_avg)}). Com esse teto, você segura cerca de ${brl(Math.round(saving / 5) * 5)} por mês.`,
        monthly_saving: Math.round(saving / 5) * 5,
      });
    }
  }
  const delivery = merchants.filter((m) => DELIVERY_RX.test(m.merchant)).reduce((s, m) => s + m.total, 0);
  if (delivery >= 20) {
    out.push({
      id: "half_delivery",
      title: "Metade do delivery",
      body: `Foram ${brl(delivery)} em delivery neste ciclo. Cortar pela metade deixa ${brl(Math.round(delivery / 2))} de folga.`,
      monthly_saving: Math.round(delivery / 2),
    });
  }
  if (state.ideal_per_day !== null && state.projection && state.projection.status !== "ok") {
    out.push({
      id: "daily_cap",
      title: `${brl(Math.floor(state.ideal_per_day))} por dia fecha o ciclo`,
      body: `Com esse teto o saldo dura até o próximo crédito, em ${state.cycle.next.slice(8, 10)}/${state.cycle.next.slice(5, 7)}.`,
      monthly_saving: null,
    });
  }
  return out;
}
