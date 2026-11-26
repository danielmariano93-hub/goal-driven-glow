// Carrega os dados reais dos resumos a partir das fontes canônicas (sem motor novo):
// livro canônico (consumo por data da compra), relatório do mês (report_v2), saldo do retrato do dia.
// deno-lint-ignore-file no-explicit-any
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { classifyLedger, SMALL_SPEND_CEILING, type V2Entry } from "../finance-core/reportV2.ts";
import { isStructuralCategoryName, loadReportV2 } from "../reportsDashboard/runtimeV2.ts";
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { addDays, daysInMonth, shiftMonth } from "./format.ts";
import type { SummaryRow, WeeklyInput } from "./weekly.ts";
import type { MonthFigures, MonthlyInput } from "./monthly.ts";

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const safe = async <T>(fallback: T, fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch { return fallback; } };

async function debtSplits(sb: any, userId: string) {
  const rows = await safe<any[]>([], async () => (await sb.from("debt_payments").select("transaction_id,amount,amount_applied,interest_amount,fee_amount").eq("user_id", userId).not("transaction_id", "is", null).limit(5000)).data ?? []);
  const out: Record<string, { principal: number; interest: number }> = {};
  for (const r of rows) {
    const interest = n(r.interest_amount) + n(r.fee_amount); const total = n(r.amount);
    const principal = r.amount_applied != null ? n(r.amount_applied) : Math.max(0, total - interest);
    if (total > 0 && principal + interest > 0) out[String(r.transaction_id)] = { principal, interest };
  }
  return out;
}

/** Linhas de consumo por data da compra (parcela antiga carregada não conta como gasto da semana). */
export async function loadConsumptionRows(sb: any, userId: string, throughMonth: string, monthsBack: number): Promise<{ rows: SummaryRow[]; uncategorizedShare: number | null }> {
  const ledger = await loadExecutiveInput(sb, userId, `${shiftMonth(throughMonth, 1)}-01`, monthsBack + 1, { includeDebtPayments: true });
  const cls = classifyLedger(ledger.entries as unknown as V2Entry[], await debtSplits(sb, userId), isStructuralCategoryName, throughMonth);
  const rows: SummaryRow[] = [];
  for (const r of cls.rows) {
    if (!r.chartDay || r.amount === 0) continue;
    rows.push({ id: r.id ?? null, day: r.chartDay, amount: r.amount, category: r.category || "Sem categoria", small: r.klass !== "estrutural" && r.amount > 0 && r.amount <= SMALL_SPEND_CEILING });
  }
  const recent = rows.filter((r) => r.day >= `${throughMonth}-01`);
  const tot = recent.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const unc = recent.filter((r) => r.category === "Sem categoria").reduce((s, r) => s + Math.max(0, r.amount), 0);
  return { rows, uncategorizedShare: tot > 0 ? Math.round((unc / tot) * 1000) / 1000 : null };
}

/**
 * Saldo em contas numa data passada: saldo disponível de hoje (retrato do dia, o mesmo da Home)
 * menos o que entrou e mais o que saiu das contas depois daquela data. Transferência entre contas
 * próprias se anula. Sem retrato de hoje → nulo (nunca zero).
 */
export async function balanceAt(sb: any, userId: string, today: string, available: number | null, dates: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (available == null) { for (const d of dates) out[d] = null; return out; }
  const from = [...dates].sort()[0];
  const tx = await safe<any[]>([], async () => fetchAllPages<any>((a, b) => sb.from("transactions").select("type,amount,occurred_at").eq("user_id", userId).eq("status", "confirmed")
    .not("account_id", "is", null).is("credit_card_id", null).neq("payment_method", "credit_card").gt("occurred_at", from).lte("occurred_at", today)
    .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b), { source: "summary_balance" }));
  for (const d of dates) {
    let flow = 0;
    for (const t of tx) {
      if (String(t.occurred_at).slice(0, 10) <= d) continue;
      flow += t.type === "income" ? n(t.amount) : t.type === "expense" ? -n(t.amount) : 0;
    }
    out[d] = d >= today ? available : Math.round((available - flow) * 100) / 100;
  }
  return out;
}

async function pendingImports(sb: any, userId: string, from: string, toExcl: string): Promise<boolean> {
  const rows = await safe<any[]>([], async () => (await sb.from("document_imports").select("status,period_start,period_end,created_at").eq("user_id", userId)
    .not("status", "in", "(confirmed,canceled,expired,failed,rolled_back,partially_confirmed)").limit(50)).data ?? []);
  // Sem período informado: só conta se a importação foi criada durante o mês ou até 10 dias depois dele.
  const late = addDays(toExcl, 10);
  return rows.some((r) => (!r.period_start || !r.period_end)
    ? String(r.created_at ?? "").slice(0, 10) >= from && String(r.created_at ?? "").slice(0, 10) < late
    : String(r.period_start) < toExcl && String(r.period_end) >= from);
}

export async function loadWeeklyInput(sb: any, userId: string, opts: { today: string; weekStart: string; timezone: string; now?: Date }): Promise<WeeklyInput> {
  const { today, weekStart } = opts;
  const cutoff = today < addDays(weekStart, 7) ? today : addDays(weekStart, 6);
  const [rep, cons] = await Promise.all([
    loadReportV2(sb, userId, today, { month: today.slice(0, 7), compare: "previous" }),
    loadConsumptionRows(sb, userId, cutoff.slice(0, 7), 2),
  ]);
  const available = rep.overview?.balance.available ?? null;
  // Saldo: o mesmo "Disponível hoje" da tela inicial; a referência é o saldo de abertura do mês (ponte do caixa).
  const opening = rep.overview?.cashBridge?.opening ?? null;
  const cash = rep.projections.cash;
  const items = rep.projections.commitments?.items ?? [];
  const inc = cash?.expectedIncome ?? null;
  // Menor saldo previsto: o motor só publica o saldo do fim do mês e o cenário sem renda; risco = fim do mês negativo.
  const minBal = cash ? (cash.projectedEnd < 0 ? { amount: cash.projectedEnd, date: `${today.slice(0, 7)}-${String(daysInMonth(today.slice(0, 7))).padStart(2, "0")}` } : null) : null;
  const goals = (rep.evolution.goals.spending ?? []).map((g) => ({ category: g.category, pct: g.pct, daysRemaining: g.daysRemaining, verdict: g.verdict }));
  return {
    userId, timezone: opts.timezone, asOf: today, weekStart, generatedAt: (opts.now ?? new Date()).toISOString(),
    rows: cons.rows,
    balances: { today: available, monthOpening: opening },
    future: {
      projectedEnd: cash?.projectedEnd ?? null,
      projectedEndDate: `${today.slice(0, 7)}-${String(daysInMonth(today.slice(0, 7))).padStart(2, "0")}`,
      income: inc ? { amount: inc.amount, date: inc.date, status: inc.date <= today ? "received" : "expected" } : null,
      upcoming: items.map((it) => ({ date: it.date, label: it.label, amount: it.amount, estimated: it.estimated })),
      minBalance: minBal,
    },
    goals,
    quality: { uncategorizedShare: cons.uncategorizedShare, stale: rep.meta.coverage.snapshotFresh === false && available == null, notes: [] },
  };
}

function figures(rep: Awaited<ReturnType<typeof loadReportV2>>, endBalance: number | null): MonthFigures {
  const o = rep.overview;
  return {
    income: o ? o.income.realized : null,
    consumption: o ? o.consumption : null,
    result: o ? o.result.value : null,
    resultPartial: o ? o.result.partial : false,
    endBalance,
    debtPaid: o ? o.debtPaid : null,
    hasEntries: !!o && (o.consumption !== 0 || o.income.realized !== 0),
  };
}

export async function loadMonthlyInput(sb: any, userId: string, opts: { today: string; month: string; timezone: string; now?: Date }): Promise<MonthlyInput> {
  const { today, month } = opts;
  const prevM = shiftMonth(month, -1);
  const nextM = shiftMonth(month, 1);
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const prevLast = `${prevM}-${String(daysInMonth(prevM)).padStart(2, "0")}`;
  const open = today <= lastDay;
  const [rep, prevRep, todayRep, cycles, pending, cons] = await Promise.all([
    loadReportV2(sb, userId, today, { month, compare: "previous" }),
    loadReportV2(sb, userId, today, { month: prevM, compare: "previous" }),
    open ? Promise.resolve(null) : loadReportV2(sb, userId, today, { month: today.slice(0, 7), compare: "previous" }),
    safe<any[]>([], async () => (await sb.from("category_spending_goal_cycles").select("category_id,target_snapshot,actual_spend,final_status,start_date,end_date").eq("user_id", userId).eq("start_date", `${month}-01`)).data ?? []),
    pendingImports(sb, userId, `${month}-01`, `${nextM}-01`),
    loadConsumptionRows(sb, userId, month, 2),
  ]);
  const live = todayRep ?? rep;
  const available = live.overview?.balance.available ?? null;
  const bal = await balanceAt(sb, userId, today, available, [open ? today : lastDay, prevLast]);

  // Metas: mês aberto → status canônico de hoje; mês fechado → ciclos gravados daquele mês.
  let goals: MonthlyInput["goals"] = null;
  if (open) goals = { spending: rep.evolution.goals.spending.map((g) => ({ category: g.category, pct: g.pct, verdict: g.verdict })) };
  else if (cycles.length) {
    const catIds = [...new Set(cycles.map((c) => c.category_id).filter(Boolean))];
    const cats = await safe<any[]>([], async () => (await sb.from("categories").select("id,name").in("id", catIds)).data ?? []);
    const name = new Map(cats.map((c) => [String(c.id), String(c.name)]));
    goals = { spending: cycles.filter((c) => n(c.target_snapshot) > 0).map((c) => { const pct = Math.round((n(c.actual_spend) / n(c.target_snapshot)) * 1000) / 1000; return { category: name.get(String(c.category_id)) ?? "Categoria", pct, verdict: pct > 1 ? "estourou" : "no_ritmo" }; }) };
  }

  const nw = live.evolution.netWorth;
  const series = nw?.series ?? [];
  const nwAt = (m: string) => series.filter((s) => s.month <= m).slice(-1)[0]?.value ?? null;
  const months = live.evolution.months.filter((x) => x.month <= month).slice(-6);
  // O mensal sai no dia 2: o "próximo mês" costuma ser o mês corrente, que não está na grade de meses futuros.
  // Nesse caso, soma os vencimentos datados que ainda caem nele (a partir de hoje).
  const commits = live.projections.commitments;
  const nextCommit = commits?.months.find((x) => x.month === nextM) ?? null;
  const itemsInNext = (commits?.items ?? []).filter((it) => it.date.slice(0, 7) === nextM && it.date >= today);
  const commitTotal = nextCommit
    ? Math.round((nextCommit.cards + nextCommit.debts + nextCommit.recurring) * 100) / 100
    : commits && nextM === today.slice(0, 7) ? Math.round(itemsInNext.reduce((s, it) => s + it.amount, 0) * 100) / 100 : null;
  const commitEstimated = nextCommit ? !!commits?.hasEstimates : itemsInNext.some((it) => it.estimated);
  const rec = live.projections.receivables;
  const opp = rep.recommendations.items.find((r) => r.nature === "saving" && r.monthlyImpact > 0) ?? null;
  const cash = live.projections.cash;
  const cashRisk = open && cash && cash.projectedEnd < 0 ? { amount: cash.projectedEnd, date: lastDay } : null;

  return {
    userId, timezone: opts.timezone, asOf: today, month, generatedAt: (opts.now ?? new Date()).toISOString(),
    cur: figures(rep, bal[open ? today : lastDay] ?? null),
    prev: prevRep.overview ? figures(prevRep, bal[prevLast] ?? null) : null,
    categories: (rep.behavior?.categories ?? []).map((c) => ({ name: c.name, total: c.total, previous: rep.behavior?.previousLabel ? c.previous : null })),
    goals,
    netWorth: { current: open ? (nw?.current ?? null) : nwAt(month), previous: nwAt(prevM) },
    trend: months.map((x) => ({ month: x.month, result: x.result, partial: x.partial || x.open })),
    next: { commitments: commitTotal, estimated: commitEstimated, incomeBaseline: live.projections.committedIncome?.income ?? live.projections.savings?.incomeBaseline ?? null, overdueReceivables: rec?.overdue ?? null, toReceive: rec?.toDue ?? null },
    opportunity: opp ? { title: opp.title, body: opp.body, basis: opp.basis, impact: opp.monthlyImpact } : null,
    cashRisk,
    quality: { pendingImports: pending, uncategorizedShare: null, notes: [] },
    open: open ? {
      expectedIncome: rep.overview?.income.expected ?? (rep.projections.cash?.expectedIncome ? { amount: rep.projections.cash.expectedIncome.amount, date: rep.projections.cash.expectedIncome.date } : null),
      // Consumo do mês anterior nos mesmos dias = soma das categorias comparadas (o relatório já compara os mesmos dias).
      prevSameDaysConsumption: rep.behavior?.previousRange ? Math.round(rep.behavior.categories.reduce((s2, c) => s2 + c.previous, 0) * 100) / 100 : null,
    } : null,
    rows: cons.rows,
  };
}
