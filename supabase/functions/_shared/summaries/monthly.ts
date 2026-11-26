// Resumo mensal (mês civil × mês anterior). Puro: recebe os números do relatório canônico (report_v2)
// do mês e do mês anterior, sem recalcular o motor financeiro.
import { compareCents } from "./compare.ts";
import { choose, SUMMARY_THRESHOLDS as T, type Candidate } from "./editorial.ts";
import { addDays, brl, clamp, ddmm, monthName, pct, shiftMonth, daysInMonth, toCents } from "./format.ts";
import { SUMMARY_DATA_VERSION, SUMMARY_TEMPLATE_VERSION, TEXT_LIMITS, type EvolutionBar, type SummaryCategory, type SummaryDTO, type SummaryLine, type SummaryMetric } from "./types.ts";

export interface MonthFigures {
  income: number | null;
  consumption: number | null;
  /** receitas − consumo (o mesmo `overview.result.value`). */
  result: number | null;
  resultPartial: boolean;
  endBalance: number | null;
  debtPaid: number | null;
  hasEntries: boolean;
}

export interface MonthlyInput {
  userId: string;
  timezone: string;
  asOf: string;
  month: string;
  generatedAt: string;
  cur: MonthFigures;
  prev: MonthFigures | null;
  categories: Array<{ name: string; total: number; previous: number | null }>;
  goals: { spending: Array<{ category: string; pct: number; verdict: string }> } | null;
  netWorth: { current: number | null; previous: number | null };
  /** Resultado dos últimos meses (até 6), em ordem. */
  trend: Array<{ month: string; result: number; partial: boolean }>;
  next: { commitments: number | null; estimated: boolean; incomeBaseline: number | null; overdueReceivables: number | null; toReceive: number | null };
  opportunity: { title: string; body: string; basis: string; impact: number } | null;
  cashRisk: { amount: number; date: string } | null;
  quality: { pendingImports: boolean; uncategorizedShare: number | null; notes: string[] };
}

const metric = (o: Omit<SummaryMetric, "unit">): SummaryMetric => ({ unit: "BRL", ...o });

export function buildMonthlySummary(i: MonthlyInput): SummaryDTO {
  const m = i.month;
  const prevM = shiftMonth(m, -1);
  const nextM = shiftMonth(m, 1);
  const start = `${m}-01`;
  const endExcl = `${nextM}-01`;
  const lastDay = `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;
  const isPartial = i.asOf <= lastDay || i.quality.pendingImports;
  const cutoff = i.asOf <= lastDay ? i.asOf : lastDay;
  const vsPrev = `vs. ${monthName(prevM)}`;
  const p = i.prev;

  const res = toCents(i.cur.result); const resRef = p ? toCents(p.result) : null;
  const resCmp = compareCents(res, resRef, vsPrev);
  const hero = metric({ id: "operating_result", label: "Resultado do mês", amount_cents: res, status: res == null ? "unavailable" : i.cur.resultPartial ? "partial" : "ok", reference_amount_cents: resRef, delta_cents: resCmp.delta_cents, delta_pct: null, delta_text: resCmp.delta_cents == null ? resCmp.text : `${brl(resCmp.delta_cents, { sign: true })} ${vsPrev}`, comparison_label: vsPrev, tone: res != null && res < 0 ? "risk" : "neutral", source: "report_v2.overview.result", reason: res == null ? "Sem receitas ou consumo no mês" : null, note: "receitas recebidas − consumo do mês" + (i.cur.resultPartial ? " · renda ainda não entrou por inteiro" : "") });

  const inc = toCents(i.cur.income); const incRef = p ? toCents(p.income) : null;
  const con = toCents(i.cur.consumption); const conRef = p ? toCents(p.consumption) : null;
  const bal = toCents(i.cur.endBalance); const balRef = p ? toCents(p.endBalance) : null;
  const ci = compareCents(inc, incRef, vsPrev); const cc = compareCents(con, conRef, vsPrev, { spend: true }); const cb = compareCents(bal, balRef, vsPrev);
  const kpis: SummaryMetric[] = [
    metric({ id: "income", label: "Receitas", amount_cents: inc, status: inc == null ? "unavailable" : "ok", reference_amount_cents: incRef, delta_cents: ci.delta_cents, delta_pct: ci.delta_pct, delta_text: ci.text, comparison_label: vsPrev, tone: "neutral", source: "report_v2.overview.income.realized", reason: null, note: "recebidas no mês" }),
    metric({ id: "consumption", label: "Consumo", amount_cents: con, status: con == null ? "unavailable" : "ok", reference_amount_cents: conRef, delta_cents: cc.delta_cents, delta_pct: cc.delta_pct, delta_text: cc.text, comparison_label: vsPrev, tone: "neutral", source: "report_v2.overview.consumption", reason: null, note: "líquido de estornos" }),
    metric({ id: "end_balance", label: isPartial && i.asOf <= lastDay ? "Saldo em contas" : "Saldo final", amount_cents: bal, status: bal == null ? "unavailable" : "ok", reference_amount_cents: balRef, delta_cents: cb.delta_cents, delta_pct: cb.delta_pct, delta_text: cb.text, comparison_label: vsPrev, tone: "neutral", source: "account_balance_snapshots", reason: bal == null ? "Sem saldo de conta registrado" : null, note: `em ${ddmm(cutoff)}` }),
  ];

  const top = [...i.categories].filter((c) => c.total !== 0).sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1)).slice(0, 3);
  const barsValid = top.length > 0 && top.every((c) => c.total > 0);
  const maxCat = Math.max(1, ...top.map((c) => Math.round(c.total * 100)));
  const categories: SummaryCategory[] = top.map((c) => {
    const cur = Math.round(c.total * 100); const ref = c.previous == null ? null : Math.round(c.previous * 100);
    const cmp = compareCents(cur, ref, "", { spend: true });
    return { name: c.name, amount_cents: cur, reference_cents: ref, delta_cents: cmp.delta_cents, delta_text: cmp.text.trim(), bar: barsValid ? cur / maxCat : null };
  });

  // M05 Evolução.
  const sg = i.goals?.spending ?? [];
  const within = sg.filter((g) => g.verdict !== "estourou").length;
  const nw = toCents(i.netWorth.current); const nwRef = toCents(i.netWorth.previous);
  const nwCmp = compareCents(nw, nwRef, vsPrev);
  const debt = toCents(i.cur.debtPaid);
  const evoLines: SummaryLine[] = [
    { label: "Metas de gasto no limite", value: sg.length ? `${within} de ${sg.length}` : "nenhuma", tone: "neutral" },
    { label: "Dívidas amortizadas", value: debt == null ? "não disponível" : debt === 0 ? "nenhuma no mês" : brl(debt), note: debt ? "principal pago, fora do consumo" : null },
    { label: "Patrimônio registrado", value: nw == null ? "não disponível" : brl(nw), note: nw == null ? null : nwCmp.text },
  ];
  const bars: EvolutionBar[] = i.trend.slice(-6).map((t) => ({ label: monthName(t.month).slice(0, 3), value_cents: Math.round(t.result * 100), partial: t.partial }));

  // M06 Próximo mês.
  const nc = toCents(i.next.commitments);
  const incomeBase = toCents(i.next.incomeBaseline);
  const share = nc != null && incomeBase != null && incomeBase > 0 ? nc / incomeBase : null;
  const future: SummaryLine[] = [
    { label: `Compromissos de ${monthName(nextM)}`, value: nc == null ? "não disponível" : nc === 0 ? "nenhum registrado" : brl(nc), note: nc ? `cartões, parcelas e contas fixas${i.next.estimated ? " · inclui estimativas" : ""}` : null },
    { label: "Peso na renda mensal", value: share == null ? (incomeBase == null ? "sem renda" : "não disponível") : pct(share, false), tone: share != null && share >= T.commitmentPressurePct ? "attention" : "neutral", note: incomeBase ? `renda mensal de referência: ${brl(incomeBase)}` : "informe sua renda mensal no app" },
    { label: "A receber de outras pessoas", value: i.next.toReceive == null || i.next.toReceive === 0 ? "nada pendente" : brl(Math.round(i.next.toReceive * 100)), note: i.next.overdueReceivables ? `${brl(Math.round(i.next.overdueReceivables * 100))} já vencidos, fora da conta acima` : null },
  ];

  // Insight e ação.
  const cands: Candidate[] = [];
  if (i.cashRisk && i.cashRisk.amount < 0) cands.push({ kind: "cash_risk", phrase: "cash_risk", vars: { date: ddmm(i.cashRisk.date), min: brl(Math.round(i.cashRisk.amount * 100)), amount: brl(Math.round(-i.cashRisk.amount * 100)) }, tone: "risk", severity: 3, deadline: i.cashRisk.date, impactCents: Math.round(i.cashRisk.amount * 100), evidence: 0.9, id: "M.cash_risk" });
  const uncat = i.quality.uncategorizedShare;
  if (i.quality.pendingImports || (uncat != null && uncat >= T.uncategorizedShare)) cands.push({ kind: "data_quality", phrase: "data_quality", vars: { reason: i.quality.pendingImports ? "Ainda há importações pendentes deste mês." : `${Math.round((uncat ?? 0) * 100)}% do consumo está sem categoria.` }, tone: "attention", severity: 2, deadline: null, impactCents: 0, evidence: 1, id: "M.data_quality" });
  if (share != null && share >= T.commitmentPressurePct && nc != null) cands.push({ kind: "commitment_pressure", phrase: "commitment_pressure", vars: { month: monthName(nextM), pct: pct(share, false), amount: brl(nc) }, tone: "attention", severity: share >= 0.8 ? 2 : 1, deadline: `${nextM}-01`, impactCents: nc, evidence: i.next.estimated ? 0.6 : 0.9, id: "M.commitment" });
  const materialCons = cc.delta_cents != null && conRef != null && conRef > 0 && Math.abs(cc.delta_cents) >= T.materialCents && Math.abs(cc.delta_cents) / conRef >= T.materialPct;
  if (materialCons && cc.delta_cents! > 0) {
    const up = categories.filter((c) => (c.delta_cents ?? 0) > 0).sort((a, b) => (b.delta_cents ?? 0) - (a.delta_cents ?? 0))[0];
    cands.push({ kind: "consumption_change", phrase: up ? "consumption_up" : "consumption_up_nocat", vars: { delta: brl(cc.delta_cents!), ref: `em ${monthName(prevM)}`, total: brl(con!), refTotal: brl(conRef!), cat: up?.name ?? "", catDelta: up ? brl(up.delta_cents!, { sign: true }) : "" }, tone: "attention", severity: 1, deadline: null, impactCents: cc.delta_cents!, evidence: 0.8, id: "M.consumption_up" });
  }
  const monthOpen = i.asOf <= lastDay;
  for (const g of sg) if (g.verdict === "estourou" || (monthOpen && g.verdict === "vai_estourar")) cands.push({ kind: "goal_risk", phrase: monthOpen ? "goal_risk" : "goal_over", vars: { cat: g.category, pct: pct(g.pct, false), days: Math.max(0, Number(lastDay.slice(8)) - Number(cutoff.slice(8))), month: monthName(m), next: monthName(nextM) }, tone: "attention", severity: g.verdict === "estourou" ? 2 : 1, deadline: null, impactCents: 0, evidence: 0.8, id: `M.goal:${g.category}` });
  // Melhora sustentada: resultado melhor que o mês anterior e consumo abaixo, com resultado positivo.
  if (res != null && resRef != null && res > resRef && res > 0 && cc.delta_cents != null && cc.delta_cents < 0 && materialCons) {
    cands.push({ kind: "sustained_improvement", phrase: "improvement_month", vars: { delta: brl(res - resRef), result: brl(res), ref: brl(resRef), detail: `O consumo ficou ${brl(-cc.delta_cents)} abaixo de ${monthName(prevM)}.`, month: monthName(m) }, tone: "good", severity: 0, deadline: null, impactCents: res - resRef, evidence: 0.8, id: "M.improvement" });
  }
  if (i.opportunity && i.opportunity.impact > 0) cands.push({ kind: "opportunity", phrase: "opportunity", vars: { title: i.opportunity.title, body: i.opportunity.body, basis: i.opportunity.basis }, tone: "neutral", severity: 0, deadline: null, impactCents: Math.round(i.opportunity.impact * 100), evidence: 0.6, id: "M.opportunity" });
  const noData = !i.cur.hasEntries;
  const neutral: Candidate = noData
    ? { kind: "neutral", phrase: "no_data", vars: { start: ddmm(start), end: ddmm(cutoff) }, tone: "neutral", severity: 0, deadline: null, impactCents: 0, evidence: 1, id: "M.no_data" }
    : { kind: "neutral", phrase: "neutral_month", vars: { income: inc == null ? "não disponível" : brl(inc), consumption: con == null ? "não disponível" : brl(con) }, tone: "neutral", severity: 0, deadline: null, impactCents: 0, evidence: 1, id: "M.neutral" };
  const { insight, action } = choose(noData ? cands.filter((c) => c.kind === "cash_risk") : cands, neutral);

  const flags: string[] = [];
  if (isPartial) flags.push("partial_period");
  if (i.quality.pendingImports) flags.push("pending_imports");
  if (!p) flags.push("no_history");
  if (bal == null) flags.push("no_balance");
  if (i.cur.resultPartial) flags.push("income_pending");
  const caveat = i.quality.pendingImports
    ? "Fechamento parcial: há importações pendentes, e os números podem mudar."
    : i.asOf <= lastDay ? `Mês em andamento: números até ${ddmm(cutoff)}.` : i.quality.notes[0] ?? "Compras no cartão contam no mês da fatura. Valores previstos são estimativas.";

  return {
    report_id: `monthly:${i.userId}:${m}${i.asOf <= lastDay ? `:${cutoff}` : ""}`,
    user_id: i.userId, type: "monthly", period_start: start, period_end_exclusive: endExcl, as_of: cutoff, timezone: i.timezone, is_partial: isPartial,
    comparison_start: `${prevM}-01`, comparison_end_exclusive: start, generated_at: i.generatedAt, data_version: SUMMARY_DATA_VERSION, template_version: SUMMARY_TEMPLATE_VERSION,
    title: clamp(`Resumo de ${monthName(m)} de ${m.slice(0, 4)}`, TEXT_LIMITS.title),
    subtitle: i.asOf <= lastDay ? `Mês em andamento · dados até ${ddmm(cutoff)} · comparado a ${monthName(prevM)}` : `Mês fechado · comparado a ${monthName(prevM)}`,
    hero,
    hero_side: { label: `Resultado de ${monthName(prevM)}`, value: resRef == null ? "sem histórico" : brl(resRef), note: p && p.consumption != null ? `com consumo de ${brl(toCents(p.consumption)!)}` : null },
    kpis, categories, categories_title: "Onde você mais gastou", categories_empty: categories.length ? null : "Nenhum lançamento registrado no mês.",
    future_title: `Olhando para ${monthName(nextM)}`, future, evolution: { lines: evoLines, bars }, insight, action, quality_flags: flags, caveat: clamp(caveat, TEXT_LIMITS.caveat),
    metrics: [hero, ...kpis],
  };
}

