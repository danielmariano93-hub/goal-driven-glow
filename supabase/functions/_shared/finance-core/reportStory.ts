// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Relatórios — a história do período (`report_story.v1`).
//
// Responde três perguntas em sequência, sempre contra o PRÓPRIO padrão da pessoa
// (o "habitual"), não contra um mês qualquer:
//   1. Como foi?       → consumo até hoje vs. habitual, curva acumulada, categorias.
//   2. O que mudou?    → essenciais x ajustáveis, o que mais subiu, padrão por dia da semana.
//   3. Para onde vai?  → compromissos dos próximos 30 dias, a receber, poupança possível,
//                        gasto recuperável, uma ação e a meta.
//
// Módulo puro e determinístico, sem I/O; espelhado para as Edge Functions. Todo número
// sai do livro canônico (`DashEntry`, por competência, líquido de estorno) ou do snapshot
// da Home (`financial_current_snapshots`): nada é estimado por modelo e nada é inventado.
// Onde falta base (menos de 2 meses de histórico, sem categorias essenciais marcadas),
// o campo vem `null` e a tela esconde o bloco.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DashEntry } from "./reportDashboard.ts";

export const REPORT_STORY_VERSION = "report_story.v1";

/** Quantos meses fechados formam o "habitual". */
export const HABITUAL_MONTHS = 3;
/** Mínimo de meses com gasto para chamar algo de "habitual". */
export const HABITUAL_MIN_MONTHS = 2;

export interface HabitualView {
  /** Gasto médio dos meses de referência, na mesma janela de dias. */
  expense: number;
  /** Meses usados (YYYY-MM). */
  months: string[];
  deltaAbs: number;
  deltaPct: number | null;
}

export interface CumulativePoint {
  day: number;
  current: number;
  habitual: number;
}

export interface CategoryHabitualRow {
  id: string | null;
  name: string;
  total: number;
  share: number;
  habitual: number | null;
  deltaPct: number | null;
  essential: boolean;
}

export interface VariationRow {
  key: string;
  label: string;
  total: number;
  habitual: number;
  deltaAbs: number;
  deltaPct: number;
  categoryId: string | null;
  essential: boolean;
}

export interface WeekdayRow {
  /** 0 = segunda … 6 = domingo. */
  dow: number;
  label: string;
  avg: number;
  days: number;
}

export interface WeekdayView {
  /** `adjustable`: sem categorias essenciais (aluguel, dívida), que caem num dia só e não são padrão de comportamento. */
  scope: "adjustable" | "all";
  rows: WeekdayRow[];
  peakDow: number;
  /** Só quando fim de semana pesa pelo menos 20% mais por dia que a semana. */
  weekend: { weekendAvg: number; weekdayAvg: number; pct: number } | null;
}

export interface CostSplit {
  essential: number;
  adjustable: number;
  essentialShare: number;
  flaggedCategories: number;
}

export interface SustainableSavings {
  monthly: number;
  avgIncome: number;
  avgExpense: number;
  months: number;
}

export interface RecoverableView {
  amount: number;
  items: Array<{ name: string; excess: number }>;
}

export interface RecommendedAction {
  merchant: string;
  categoryId: string | null;
  total: number;
  habitual: number;
  excess: number;
  /** Quanto precisa cair para voltar ao habitual (0..1). */
  reductionPct: number;
}

/** Renda do mês contra a renda típica: salário que ainda não caiu não pode virar "resultado negativo". */
export interface IncomeView {
  current: number;
  typical: number;
  incomplete: boolean;
}

/** O quanto dá para confiar nos números do mês: gasto sem categoria e meses de base do habitual. */
export interface StoryQuality {
  uncategorizedAmount: number;
  uncategorizedShare: number;
  habitualMonths: number;
}

/** Assinatura ou conta mensal que ficou mais cara (mesma cobrança, valor maior). */
export interface PriceChange {
  key: string;
  label: string;
  from: number;
  to: number;
  deltaAbs: number;
  deltaPct: number;
}

export interface ReportStory {
  version: typeof REPORT_STORY_VERSION;
  /** Mês contado (YYYY-MM) e até que dia (janela de comparação). */
  month: string;
  windowDays: number;
  habitual: HabitualView | null;
  income: IncomeView | null;
  quality: StoryQuality | null;
  priceChanges: PriceChange[];
  cumulative: CumulativePoint[] | null;
  categories: CategoryHabitualRow[];
  variations: VariationRow[];
  weekday: WeekdayView | null;
  split: CostSplit | null;
  sustainableSavings: SustainableSavings | null;
  recoverable: RecoverableView | null;
  action: RecommendedAction | null;
}

export interface StoryInput {
  entries: DashEntry[];
  today: string;
  start: string;
  end: string;
  /** Categorias que a pessoa marcou como essenciais (`category_essential_flags`). */
  essentialCategoryIds: string[];
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const monthOf = (iso: string) => iso.slice(0, 7);

function daysInMonth(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

function shiftMonth(ym: string, delta: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** 0 = segunda … 6 = domingo. */
function weekdayIndex(iso: string): number {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}

const WEEKDAY_LABEL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Mediana: um mês atípico (13º, venda, fatura gigante) não puxa o "habitual" para longe do que é normal. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Só estabelecimentos reconhecíveis entram em "variações" e na ação. PIX/transferência para
 * pessoa e descrição longa de intermediário ("Pagamento de pix qr code ... sociedade de crédito")
 * não são lugar onde se corta gasto, e expor o nome de uma pessoa no relatório não ajuda ninguém.
 */
export function isDisplayableMerchant(label: string | null | undefined): boolean {
  const text = String(label ?? "").trim();
  if (text.length < 2 || text.length > 28) return false;
  return !/\b(pix|ted|doc|transfer\w*|enviado|recebido|pagamento|sociedade|financiamento)\b/i.test(text);
}

const isSpend = (e: DashEntry) => e.kind === "expense" && e.amount > 0;
const chartDayOf = (e: DashEntry): string | null => (e.chart_carried ? null : (e.chart_date ?? e.date));

// ---------------------------------------------------------------------------
// Núcleo
// ---------------------------------------------------------------------------

/**
 * Só existe história para um mês de calendário (do dia 1 até o dia pedido). Para
 * outros recortes (30 dias, trimestre, intervalo livre) o "habitual" deixa de ter
 * uma definição honesta e a tela mantém os blocos clássicos.
 */
export function storyApplies(start: string, end: string): boolean {
  return start.slice(8, 10) === "01" && monthOf(start) === monthOf(end) && end >= start;
}

export function buildReportStory(input: StoryInput): ReportStory | null {
  const { entries, start, end } = input;
  if (!storyApplies(start, end)) return null;

  const month = monthOf(start);
  const windowDays = Math.min(Number(end.slice(8, 10)), daysInMonth(month));
  const essential = new Set(input.essentialCategoryIds);
  const haveFlags = essential.size > 0;

  const monthEntries = entries.filter((e) => isSpend(e) && monthOf(e.date) === month && e.date >= start && e.date <= end);
  if (monthEntries.length === 0) return null;
  const total = monthEntries.reduce((a, e) => a + e.amount, 0);

  // ---- Habitual: mesmos dias dos meses fechados anteriores -----------------
  const candidateMonths = Array.from({ length: HABITUAL_MONTHS }, (_, i) => shiftMonth(month, -(i + 1)));
  const spendByMonth = new Map<string, DashEntry[]>();
  for (const e of entries) {
    if (!isSpend(e)) continue;
    const m = monthOf(e.date);
    if (!candidateMonths.includes(m)) continue;
    const list = spendByMonth.get(m) ?? [];
    list.push(e);
    spendByMonth.set(m, list);
  }
  const refMonths = candidateMonths.filter((m) => (spendByMonth.get(m)?.length ?? 0) > 0).sort();
  const hasHabitual = refMonths.length >= HABITUAL_MIN_MONTHS;
  const dayInWindow = (m: string, e: DashEntry) => Number(e.date.slice(8, 10)) <= Math.min(windowDays, daysInMonth(m));
  const inWindow = (m: string) => (spendByMonth.get(m) ?? []).filter((e) => dayInWindow(m, e));

  let habitual: HabitualView | null = null;
  if (hasHabitual) {
    const avg = median(refMonths.map((m) => inWindow(m).reduce((sum, e) => sum + e.amount, 0)));
    if (avg > 0) {
      habitual = {
        expense: round2(avg),
        months: refMonths,
        deltaAbs: round2(total - avg),
        deltaPct: Math.round(((total - avg) / avg) * 1000) / 1000,
      };
    }
  }

  // ---- Curva acumulada (atual x habitual) ----------------------------------
  let cumulative: CumulativePoint[] | null = null;
  if (habitual) {
    const perDay = (list: DashEntry[]) => {
      const days = new Array<number>(32).fill(0);
      for (const e of list) days[Number(e.date.slice(8, 10))] += e.amount;
      return days;
    };
    const cur = perDay(monthEntries);
    const refs = refMonths.map((m) => perDay(inWindow(m)));
    let runCur = 0;
    const runRef = refs.map(() => 0);
    cumulative = [];
    for (let d = 1; d <= windowDays; d += 1) {
      runCur += cur[d];
      refs.forEach((r, i) => { runRef[i] += r[d]; });
      cumulative.push({ day: d, current: round2(runCur), habitual: round2(median(runRef)) });
    }
  }

  // ---- Categorias x habitual -----------------------------------------------
  const habitualBy = <K extends string>(keyOf: (e: DashEntry) => K | null): Map<K, number> => {
    const out = new Map<K, number>();
    if (!habitual) return out;
    const perMonth = refMonths.map((m) => {
      const acc = new Map<K, number>();
      for (const e of inWindow(m)) {
        const k = keyOf(e);
        if (k == null) continue;
        acc.set(k, (acc.get(k) ?? 0) + e.amount);
      }
      return acc;
    });
    const keys = new Set<K>(perMonth.flatMap((m) => [...m.keys()]));
    for (const k of keys) out.set(k, median(perMonth.map((m) => m.get(k) ?? 0)));
    return out;
  };

  const catKey = (e: DashEntry) => e.category_id ?? "__none__";
  const catHabitual = habitualBy(catKey);
  const catCurrent = new Map<string, { name: string; total: number }>();
  for (const e of monthEntries) {
    const k = catKey(e);
    const c = catCurrent.get(k) ?? { name: e.category || "Sem categoria", total: 0 };
    c.total += e.amount;
    catCurrent.set(k, c);
  }
  const allCategories: CategoryHabitualRow[] = [...catCurrent.entries()]
    .map(([k, c]) => {
      const h = habitual ? catHabitual.get(k) ?? 0 : null;
      return {
        id: k === "__none__" ? null : k,
        name: c.name,
        total: round2(c.total),
        share: total > 0 ? c.total / total : 0,
        habitual: h != null && h > 0 ? round2(h) : null,
        deltaPct: h != null && h > 0 ? Math.round(((c.total - h) / h) * 1000) / 1000 : null,
        essential: k !== "__none__" && essential.has(k),
      };
    })
    .sort((a, b) => b.total - a.total);
  const categories = allCategories.slice(0, 6);

  // ---- Variações por estabelecimento ---------------------------------------
  const variations: VariationRow[] = [];
  if (habitual) {
    const merchHabitual = habitualBy((e) => e.merchant_key);
    const merchCurrent = new Map<string, { label: string; total: number; byCat: Map<string, number> }>();
    for (const e of monthEntries) {
      if (!e.merchant_key || !isDisplayableMerchant(e.merchant)) continue;
      const c = merchCurrent.get(e.merchant_key) ?? { label: e.merchant || e.merchant_key, total: 0, byCat: new Map() };
      c.total += e.amount;
      const ck = catKey(e);
      c.byCat.set(ck, (c.byCat.get(ck) ?? 0) + e.amount);
      merchCurrent.set(e.merchant_key, c);
    }
    for (const [key, c] of merchCurrent) {
      const h = merchHabitual.get(key) ?? 0;
      const deltaAbs = c.total - h;
      if (h <= 0 || deltaAbs < 30 || deltaAbs / h < 0.15) continue;
      const topCat = [...c.byCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "__none__";
      variations.push({
        key, label: c.label, total: round2(c.total), habitual: round2(h), deltaAbs: round2(deltaAbs),
        deltaPct: Math.round((deltaAbs / h) * 1000) / 1000,
        categoryId: topCat === "__none__" ? null : topCat,
        essential: topCat !== "__none__" && essential.has(topCat),
      });
    }
    variations.sort((a, b) => b.deltaAbs - a.deltaAbs);
  }

  // ---- Dia da semana --------------------------------------------------------
  let weekday: WeekdayView | null = null;
  if (windowDays >= 14) {
    const sums = new Array<number>(7).fill(0);
    const counts = new Array<number>(7).fill(0);
    for (let d = 1; d <= windowDays; d += 1) counts[weekdayIndex(`${month}-${String(d).padStart(2, "0")}`)] += 1;
    for (const e of entries) {
      if (!isSpend(e)) continue;
      if (haveFlags && e.category_id != null && essential.has(e.category_id)) continue;
      const day = chartDayOf(e);
      if (day == null || day < start || day > end) continue;
      sums[weekdayIndex(day)] += e.amount;
    }
    const rows: WeekdayRow[] = sums.map((s, dow) => ({
      dow, label: WEEKDAY_LABEL[dow], days: counts[dow], avg: counts[dow] > 0 ? round2(s / counts[dow]) : 0,
    }));
    if (rows.some((r) => r.avg > 0)) {
      const peakDow = rows.reduce((best, r) => (r.avg > rows[best].avg ? r.dow : best), 0);
      const weekdayAvg = rows.slice(0, 5).reduce((a, r) => a + r.avg, 0) / 5;
      const weekendAvg = (rows[5].avg + rows[6].avg) / 2;
      const pct = weekdayAvg > 0 ? weekendAvg / weekdayAvg - 1 : 0;
      weekday = {
        scope: haveFlags ? "adjustable" : "all",
        rows, peakDow,
        weekend: weekdayAvg > 0 && pct >= 0.2 ? { weekendAvg: round2(weekendAvg), weekdayAvg: round2(weekdayAvg), pct: Math.round(pct * 100) / 100 } : null,
      };
    }
  }

  // ---- Essenciais x ajustáveis ---------------------------------------------
  let split: CostSplit | null = null;
  if (haveFlags) {
    const ess = monthEntries.filter((e) => e.category_id != null && essential.has(e.category_id)).reduce((a, e) => a + e.amount, 0);
    if (ess > 0 && total > 0) {
      split = {
        essential: round2(ess), adjustable: round2(total - ess), essentialShare: Math.round((ess / total) * 1000) / 1000,
        flaggedCategories: essential.size,
      };
    }
  }

  // ---- Poupança sustentável: média dos meses fechados ----------------------
  let sustainableSavings: SustainableSavings | null = null;
  {
    const closed = candidateMonths.map((m) => {
      let inc = 0; let exp = 0;
      for (const e of entries) {
        if (monthOf(e.date) !== m) continue;
        if (e.kind === "income") inc += e.amount; else if (e.amount > 0) exp += e.amount;
      }
      return { m, inc, exp };
    }).filter((x) => x.inc > 0 && x.exp > 0);
    if (closed.length >= HABITUAL_MIN_MONTHS) {
      const avgIncome = median(closed.map((x) => x.inc));
      const avgExpense = median(closed.map((x) => x.exp));
      sustainableSavings = {
        monthly: round2(Math.max(0, avgIncome - avgExpense)),
        avgIncome: round2(avgIncome), avgExpense: round2(avgExpense), months: closed.length,
      };
    }
  }

  // ---- Renda do mês x renda típica -----------------------------------------
  let incomeView: IncomeView | null = null;
  {
    const incomeOf = (m: string) => entries.filter((e) => e.kind === "income" && monthOf(e.date) === m && e.date >= `${m}-01`).reduce((a, e) => a + e.amount, 0);
    const typical = median(candidateMonths.map(incomeOf).filter((v) => v > 0));
    const current = entries.filter((e) => e.kind === "income" && monthOf(e.date) === month && e.date >= start && e.date <= end).reduce((a, e) => a + e.amount, 0);
    if (typical > 0 || current > 0) {
      incomeView = {
        current: round2(current), typical: round2(typical),
        incomplete: typical > 0 && end >= input.today && current < typical * 0.5,
      };
    }
  }

  // ---- Gasto recuperável e ação --------------------------------------------
  let recoverable: RecoverableView | null = null;
  let action: RecommendedAction | null = null;
  if (habitual && haveFlags) {
    const items = allCategories
      .filter((c) => !c.essential && c.habitual != null && c.deltaPct != null && c.deltaPct >= 0.1 && c.total - c.habitual >= 20)
      .map((c) => ({ name: c.name, excess: round2(c.total - (c.habitual as number)) }))
      .sort((a, b) => b.excess - a.excess);
    if (items.length > 0) recoverable = { amount: round2(items.reduce((a, i) => a + i.excess, 0)), items: items.slice(0, 3) };
    const top = variations.find((v) => !v.essential);
    if (top) {
      action = {
        merchant: top.label, categoryId: top.categoryId, total: top.total, habitual: top.habitual,
        excess: top.deltaAbs, reductionPct: Math.round((top.deltaAbs / top.total) * 100) / 100,
      };
    }
  }

  // ---- Qualidade do dado ----------------------------------------------------
  const uncategorized = monthEntries.filter((e) => e.category_id == null).reduce((a, e) => a + e.amount, 0);
  const quality: StoryQuality | null = total > 0
    ? { uncategorizedAmount: round2(uncategorized), uncategorizedShare: Math.round((uncategorized / total) * 1000) / 1000, habitualMonths: refMonths.length }
    : null;

  // ---- Preços que subiram: mesma cobrança recorrente, valor maior -----------
  const priceChanges: PriceChange[] = [];
  {
    type Month = { total: number; count: number };
    const byMerchant = new Map<string, { label: string; months: Map<string, Month> }>();
    for (const e of entries) {
      if (!isSpend(e) || !e.merchant_key || !isDisplayableMerchant(e.merchant)) continue;
      const m = monthOf(e.date);
      if (m !== month && !candidateMonths.includes(m)) continue;
      const row = byMerchant.get(e.merchant_key) ?? { label: e.merchant ?? e.merchant_key, months: new Map<string, Month>() };
      const cell = row.months.get(m) ?? { total: 0, count: 0 };
      cell.total += e.amount; cell.count += 1;
      row.months.set(m, cell);
      byMerchant.set(e.merchant_key, row);
    }
    for (const [key, row] of byMerchant) {
      const cur = row.months.get(month);
      const prior = candidateMonths.map((m) => row.months.get(m)).filter((c): c is Month => Boolean(c));
      if (!cur || prior.length < HABITUAL_MIN_MONTHS) continue;
      // Cobrança de assinatura: 1–2 lançamentos por mês e valor estável. Uso variável (Uber, mercado) não entra.
      if (cur.count > 2 || prior.some((c) => c.count > 2)) continue;
      const totals = prior.map((c) => c.total);
      if (Math.max(...totals) / Math.max(1, Math.min(...totals)) > 1.08) continue;
      const from = median(totals);
      const delta = cur.total - from;
      // Reajuste plausível: de 5% a 60%. Mais que isso é outra compra, não o mesmo preço.
      if (from <= 0 || delta < 3 || delta / from < 0.05 || delta / from > 0.6) continue;
      priceChanges.push({ key, label: row.label, from: round2(from), to: round2(cur.total), deltaAbs: round2(delta), deltaPct: Math.round((delta / from) * 1000) / 1000 });
    }
    priceChanges.sort((a, b) => b.deltaAbs - a.deltaAbs);
  }

  return {
    version: REPORT_STORY_VERSION,
    month, windowDays, habitual, income: incomeView, quality, priceChanges: priceChanges.slice(0, 3), cumulative,
    categories, variations: variations.slice(0, 5), weekday, split, sustainableSavings, recoverable, action,
  };
}

// ---------------------------------------------------------------------------
// Futuro: compromissos, a receber, meta (a partir do snapshot da Home)
// ---------------------------------------------------------------------------

export interface FutureGroup {
  key: "cards" | "debts" | "recurring";
  label: string;
  amount: number;
}

export interface ExpectedIncome {
  amount: number;
  date: string;
  label: string;
  /** `configured`: renda informada no perfil; demais: estimada do histórico. */
  source: string;
}

/** Como o mês deve fechar, em saldo (a base de gasto da Home é outra, então ela não entra aqui). */
export interface BalanceOutlook {
  /** Saldo de hoje + renda prevista − compromissos − fatura do cartão. */
  freeAfterCommitments: number | null;
  /** Mesmo cálculo, descontado o gasto variável previsto. */
  projectedEnd: number | null;
  expectedIncome: ExpectedIncome | null;
}

export interface SpendingGoalRow {
  id: string;
  categoryId: string | null;
  category: string;
  spent: number;
  limit: number;
  /** 0..1+ (não limitado: estourar a meta aparece como mais de 100%). */
  pct: number;
  status: "on_track" | "attention" | "at_risk" | "exceeded" | "limit_reached";
  projected: number | null;
  daysRemaining: number | null;
}

export interface FutureView {
  asOf: string;
  horizonStart: string;
  horizonEnd: string;
  /** Saldo disponível hoje (o mesmo da Home). */
  balance: number | null;
  /** Saldo previsto no fim do mês (o mesmo da Home). */
  projectedEndBalance: number | null;
  outlook: BalanceOutlook | null;
  spendingGoals: SpendingGoalRow[];
  commitments: { total: number; groups: FutureGroup[]; hasEstimates: boolean } | null;
  receivable: { total: number; fromPeople: number; scheduled: number } | null;
  goal: { name: string; target: number; contributed: number; remaining: number; pct: number } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

const GROUPS: Array<{ key: FutureGroup["key"]; label: string; sources: string[] }> = [
  { key: "cards", label: "Parcelas e fatura do cartão", sources: ["card_statement", "card_installment"] },
  { key: "debts", label: "Dívidas", sources: ["debt_installment"] },
  { key: "recurring", label: "Recorrências e planejados", sources: ["recurring", "planned", "donation_goal"] },
];

/**
 * Lê o snapshot da Home (`financial_current_snapshots.payload.snapshot`). Devolve `null`
 * quando o snapshot não é de hoje: agenda de 30 dias de ontem descreveria outra janela.
 */
export function buildFutureView(snapshot: any, today: string, receivableFromPeople: number, savingsGoalIds: string[]): FutureView | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const agenda = snapshot.commitmentAgenda;
  const horizonStart = typeof agenda?.horizonStart === "string" ? agenda.horizonStart : today;
  const horizonEnd = typeof agenda?.horizonEnd === "string" ? agenda.horizonEnd : fromMs(toMs(today) + 30 * DAY);
  const pending: any[] = Array.isArray(agenda?.pendingItems) ? agenda.pendingItems : [];
  const inHorizon = (i: any) => typeof i?.date === "string" && i.date >= today && i.date <= horizonEnd;

  const expenses = pending.filter((i) => i?.type === "expense" && inHorizon(i) && (num(i.amount) ?? 0) > 0);
  const groups: FutureGroup[] = GROUPS
    .map((g) => ({ key: g.key, label: g.label, amount: round2(expenses.filter((i) => g.sources.includes(i.source)).reduce((a, i) => a + (num(i.amount) ?? 0), 0)) }))
    .filter((g) => g.amount > 0);
  const commitments = groups.length > 0
    ? { total: round2(groups.reduce((a, g) => a + g.amount, 0)), groups, hasEstimates: Boolean(agenda?.hasEstimates) }
    : null;

  const scheduled = round2(pending.filter((i) => i?.type === "income" && inHorizon(i)).reduce((a, i) => a + (num(i.amount) ?? 0), 0));
  const people = round2(Math.max(0, receivableFromPeople));
  const receivable = scheduled + people > 0 ? { total: round2(scheduled + people), fromPeople: people, scheduled } : null;

  // Só metas de poupança: meta de doação (dízimo) tem "alvo" simbólico e não é reserva.
  const savings = new Set(savingsGoalIds);
  const goals: any[] = (Array.isArray(snapshot.goalProgress) ? snapshot.goalProgress : []).filter((g: any) => savings.has(String(g?.id)));
  const pick = goals.find((g) => /reserva|emerg/i.test(String(g?.name ?? ""))) ?? goals.find((g) => (num(g?.target) ?? 0) > 0) ?? null;
  const target = num(pick?.target) ?? 0;
  const contributed = num(pick?.contributed) ?? num(pick?.total) ?? 0;
  const goal = pick && target > 0
    ? { name: String(pick.name ?? "Meta"), target: round2(target), contributed: round2(contributed), remaining: round2(Math.max(0, target - contributed)), pct: Math.min(1, Math.round((contributed / target) * 1000) / 1000) }
    : null;

  // Saldo do fim do mês e renda prevista: os mesmos números da Home.
  const proj = snapshot.projection && typeof snapshot.projection === "object" ? snapshot.projection : null;
  const incomeEvents: any[] = Array.isArray(proj?.estimatedIncomeEvents) ? proj.estimatedIncomeEvents : [];
  const nextIncome = incomeEvents.filter((i) => typeof i?.date === "string" && i.date >= today && (num(i.amount) ?? 0) > 0).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const outlook: BalanceOutlook | null = proj
    ? {
        freeAfterCommitments: num(proj.freeAfterKnownCommitments),
        projectedEnd: num(proj.projectedEndBalance),
        expectedIncome: nextIncome ? { amount: round2(num(nextIncome.amount) ?? 0), date: nextIncome.date, label: String(nextIncome.label ?? "Renda prevista"), source: String(nextIncome.source ?? "") } : null,
      }
    : null;

  // Metas de gasto por categoria que estão valendo hoje (ciclos já encerrados ou ainda não começados ficam de fora).
  const LIVE = new Set(["on_track", "attention", "at_risk", "exceeded", "limit_reached"]);
  const spendingGoals: SpendingGoalRow[] = (Array.isArray(snapshot.activeCategoryGoals) ? snapshot.activeCategoryGoals : [])
    .filter((g: any) => LIVE.has(String(g?.status)) && typeof g?.period?.start === "string" && g.period.start <= today && g.period.end >= today && (num(g?.targetAmount) ?? 0) > 0)
    .map((g: any) => ({
      id: String(g.goal?.id ?? `${g.categoryName}-${g.period.start}`),
      categoryId: g.goal?.category_id ? String(g.goal.category_id) : null,
      category: String(g.categoryName ?? "Categoria"),
      spent: round2(num(g.actualSpend) ?? 0),
      limit: round2(num(g.targetAmount) ?? 0),
      pct: Math.round(((num(g.actualSpend) ?? 0) / (num(g.targetAmount) as number)) * 1000) / 1000,
      status: String(g.status) as SpendingGoalRow["status"],
      projected: num(g.projectedSpend) != null ? round2(num(g.projectedSpend) as number) : null,
      daysRemaining: num(g.daysRemaining),
    }))
    .sort((a: SpendingGoalRow, b: SpendingGoalRow) => b.pct - a.pct)
    .slice(0, 4);

  return {
    asOf: today, horizonStart, horizonEnd, outlook, spendingGoals,
    balance: num(snapshot.availableToday),
    projectedEndBalance: num(snapshot.projectedMonthEndAvailable),
    commitments, receivable, goal,
  };
}
