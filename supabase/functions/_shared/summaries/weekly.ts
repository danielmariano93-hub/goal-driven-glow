// Resumo semanal (segunda a domingo). Puro: recebe linhas já classificadas pelo livro canônico
// (consumo por data da compra, estorno negativo, sem transferência própria, fatura ou principal de dívida).
import { compareCents } from "./compare.ts";
import { choose, SUMMARY_THRESHOLDS as T, type Candidate } from "./editorial.ts";
import { addDays, brl, clamp, ddmm, monthName, pct, rangeLabel, shiftMonth, daysInMonth } from "./format.ts";
import { SUMMARY_DATA_VERSION, SUMMARY_TEMPLATE_VERSION, TEXT_LIMITS, type SummaryCategory, type SummaryDTO, type SummaryLine, type SummaryMetric } from "./types.ts";

export interface SummaryRow { id?: string | null; /** data da compra (ISO) */ day: string; /** consumo em reais; estorno negativo */ amount: number; category: string; /** pequeno gasto (≤ R$ 50, não estrutural) */ small: boolean }

export interface WeeklyInput {
  userId: string;
  timezone: string;
  /** Hoje no fuso do usuário. */
  asOf: string;
  /** Segunda-feira da semana. */
  weekStart: string;
  generatedAt: string;
  rows: SummaryRow[];
  balances: { end: number | null; prevEnd: number | null };
  future: {
    projectedEnd: number | null; projectedEndDate: string;
    income: { amount: number; date: string; status: "received" | "expected" } | null;
    upcoming: Array<{ date: string; label: string; amount: number; estimated: boolean }>;
    minBalance: { amount: number; date: string } | null;
  };
  goals: Array<{ category: string; pct: number; daysRemaining: number | null; verdict: string }>;
  quality: { uncategorizedShare: number | null; stale: boolean; notes: string[] };
}

const sumCents = (rows: SummaryRow[]) => rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
const inRange = (d: string, a: string, bExcl: string) => d >= a && d < bExcl;
const metric = (o: Omit<SummaryMetric, "unit">): SummaryMetric => ({ unit: "BRL", ...o });

export function buildWeeklySummary(i: WeeklyInput): SummaryDTO {
  const start = i.weekStart;
  const endExcl = addDays(start, 7);
  const isPartial = i.asOf < endExcl;
  // Corte: domingo da semana fechada, ou hoje na semana corrente.
  const cutoff = i.asOf < endExcl ? i.asOf : addDays(endExcl, -1);
  const days = Math.round((Date.parse(`${cutoff}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
  const curEnd = addDays(cutoff, 1);
  const refStart = addDays(start, -7);
  const refEnd = addDays(refStart, days);
  const refLabel = days >= 7 ? "vs. 7 dias anteriores" : `vs. mesmos ${days} dias da semana anterior`;

  const cur = i.rows.filter((r) => inRange(r.day, start, curEnd));
  const ref = i.rows.filter((r) => inRange(r.day, refStart, refEnd));
  const hasHistory = i.rows.some((r) => r.day < start);
  const curC = sumCents(cur);
  const refC = hasHistory ? sumCents(ref) : null;
  const cmp = compareCents(curC, refC, refLabel, { spend: true });

  // Mês até a data do corte × mesmos dias do mês anterior.
  const ym = cutoff.slice(0, 7);
  const prevYm = shiftMonth(ym, -1);
  const dayN = Number(cutoff.slice(8, 10));
  const prevLast = `${prevYm}-${String(Math.min(dayN, daysInMonth(prevYm))).padStart(2, "0")}`;
  const mtd = sumCents(i.rows.filter((r) => inRange(r.day, `${ym}-01`, curEnd)));
  const hasPrevMonth = i.rows.some((r) => r.day < `${ym}-01`);
  const mtdRef = hasPrevMonth ? sumCents(i.rows.filter((r) => inRange(r.day, `${prevYm}-01`, addDays(prevLast, 1)))) : null;
  const mtdCmp = compareCents(mtd, mtdRef, `vs. 1 a ${dayN}/${prevYm.slice(5, 7)}`, { spend: true });

  const smallCur = sumCents(cur.filter((r) => r.small));
  const smallRef = hasHistory ? sumCents(ref.filter((r) => r.small)) : null;
  const smallCmp = compareCents(smallCur, smallRef, "vs. semana anterior", { spend: true });

  const balEnd = i.balances.end == null ? null : Math.round(i.balances.end * 100);
  const balPrev = i.balances.prevEnd == null ? null : Math.round(i.balances.prevEnd * 100);
  const balCmp = compareCents(balEnd, balPrev, "vs. fim da semana anterior");

  // Categorias da semana (top 3 por valor) com a diferença contra o período de comparação.
  const byCat = new Map<string, { cur: number; ref: number }>();
  for (const r of cur) { const e = byCat.get(r.category) ?? { cur: 0, ref: 0 }; e.cur += Math.round(r.amount * 100); byCat.set(r.category, e); }
  for (const r of ref) { const e = byCat.get(r.category); if (e) e.ref += Math.round(r.amount * 100); }
  const top = [...byCat.entries()].filter(([, v]) => v.cur !== 0).sort((a, b) => b[1].cur - a[1].cur || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
  const barsValid = top.length > 0 && top.every(([, v]) => v.cur > 0);
  const maxCat = Math.max(1, ...top.map(([, v]) => v.cur));
  const categories: SummaryCategory[] = top.map(([name, v]) => {
    const c = compareCents(v.cur, hasHistory ? v.ref : null, "", { spend: true });
    return { name, amount_cents: v.cur, reference_cents: hasHistory ? v.ref : null, delta_cents: c.delta_cents, delta_text: c.text.trim(), bar: barsValid ? v.cur / maxCat : null };
  });

  // Risco de caixa confirmado: saldo mínimo projetado negativo antes da próxima entrada.
  const risk = i.future.minBalance && i.future.minBalance.amount < 0 ? i.future.minBalance : null;
  const consumoMetric = metric({ id: "weekly_consumption", label: "Consumo da semana", amount_cents: curC, status: isPartial ? "partial" : "ok", reference_amount_cents: refC, delta_cents: cmp.delta_cents, delta_pct: cmp.delta_pct, delta_text: cmp.text, comparison_label: refLabel, tone: "neutral", source: "ledger.purchase_date", reason: null });
  const hero = risk
    ? metric({ id: "projected_min_balance", label: "Menor saldo previsto", amount_cents: Math.round(risk.amount * 100), status: "ok", reference_amount_cents: null, delta_cents: null, delta_pct: null, delta_text: `em ${ddmm(risk.date)}, antes da próxima entrada`, comparison_label: null, tone: "risk", source: "report_v2.projections.cash", reason: null })
    : consumoMetric;

  const kpis: SummaryMetric[] = [
    metric({ id: "mtd_consumption", label: `Consumo em ${monthName(ym)}`, amount_cents: mtd, status: "ok", reference_amount_cents: mtdRef, delta_cents: mtdCmp.delta_cents, delta_pct: mtdCmp.delta_pct, delta_text: mtdCmp.text, comparison_label: `1 a ${dayN}`, tone: "neutral", source: "ledger.purchase_date", reason: null, note: `1 a ${ddmm(cutoff)}` }),
    metric({ id: "account_balance", label: "Saldo em contas", amount_cents: balEnd, status: balEnd == null ? "unavailable" : "ok", reference_amount_cents: balPrev, delta_cents: balCmp.delta_cents, delta_pct: balCmp.delta_pct, delta_text: balCmp.text, comparison_label: "fim da semana anterior", tone: "neutral", source: "account_balance_snapshots", reason: balEnd == null ? "Sem saldo de conta registrado" : null, note: `em ${ddmm(cutoff)}` }),
    metric({ id: "small_spend", label: "Pequenos gastos", amount_cents: smallCur, status: "ok", reference_amount_cents: smallRef, delta_cents: smallCmp.delta_cents, delta_pct: smallCmp.delta_pct, delta_text: smallCmp.text, comparison_label: "semana anterior", tone: "neutral", source: "ledger.small_spend", reason: null, note: `${cur.filter((r) => r.small && r.amount > 0).length} compras de até R$ 50` }),
  ];

  // Futuro (W06).
  const upEnd = addDays(cutoff, 8);
  const upcoming = i.future.upcoming.filter((u) => u.date > cutoff && u.date < upEnd).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  const upC = upcoming.reduce((s, u) => s + Math.round(u.amount * 100), 0);
  const inc = i.future.income;
  const future: SummaryLine[] = [
    { label: `Saldo previsto em ${ddmm(i.future.projectedEndDate)}`, value: i.future.projectedEnd == null ? "não disponível" : brl(Math.round(i.future.projectedEnd * 100)), tone: i.future.projectedEnd != null && i.future.projectedEnd < 0 ? "risk" : "neutral", note: i.future.projectedEnd == null ? null : "conta a renda prevista e os vencimentos conhecidos" },
    { label: "Próxima renda", value: inc ? brl(Math.round(inc.amount * 100)) : "sem renda prevista", note: inc ? `${inc.status === "received" ? "recebida em" : "prevista para"} ${ddmm(inc.date)}${inc.status === "received" ? "" : " · ainda não recebida"}` : "o saldo previsto não conta com entrada" },
    { label: "Vencimentos em 7 dias", value: upcoming.length ? brl(upC) : "nenhum", note: upcoming.length ? clamp(upcoming.slice(0, 2).map((u) => `${u.label} ${ddmm(u.date)}`).join(" · ") + (upcoming.length > 2 ? ` · +${upcoming.length - 2}` : ""), 60) : null },
  ];

  // Insight e ação.
  const cands: Candidate[] = [];
  const noData = cur.length === 0;
  if (risk) cands.push({ kind: "cash_risk", phrase: "cash_risk", vars: { date: ddmm(risk.date), min: brl(Math.round(risk.amount * 100)), amount: brl(Math.round(-risk.amount * 100)) }, tone: "risk", severity: 3, deadline: risk.date, impactCents: Math.round(risk.amount * 100), evidence: 0.9, id: "W.cash_risk" });
  const uncat = i.quality.uncategorizedShare;
  if (i.quality.stale || (uncat != null && uncat >= T.uncategorizedShare)) {
    const reason = i.quality.stale ? "Há contas sem atualização recente." : `${Math.round((uncat ?? 0) * 100)}% do consumo está sem categoria.`;
    cands.push({ kind: "data_quality", phrase: "data_quality", vars: { reason }, tone: "attention", severity: 2, deadline: null, impactCents: 0, evidence: 1, id: "W.data_quality" });
  }
  if (upcoming.length && balEnd != null && upC > balEnd) {
    const t = upcoming.reduce((a, b) => (b.amount > a.amount ? b : a));
    cands.push({ kind: "commitment_pressure", phrase: "commitment_week", vars: { amount: brl(upC), count: upcoming.length, date: ddmm(addDays(cutoff, 7)), top: t.label, topAmount: brl(Math.round(t.amount * 100)) }, tone: "attention", severity: 2, deadline: upcoming[0].date, impactCents: upC, evidence: 0.9, id: "W.commitment_week" });
  }
  const material = cmp.delta_cents != null && refC != null && refC > 0 && Math.abs(cmp.delta_cents) >= T.materialCents && Math.abs(cmp.delta_cents) / refC >= T.materialPct;
  const refWord = days >= 7 ? "na semana anterior" : "no mesmo trecho da semana anterior";
  if (material && cmp.delta_cents! > 0) {
    const up = categories.filter((c) => (c.delta_cents ?? 0) > 0).sort((a, b) => (b.delta_cents ?? 0) - (a.delta_cents ?? 0))[0];
    cands.push({ kind: "consumption_change", phrase: up ? "consumption_up" : "consumption_up_nocat", vars: { delta: brl(cmp.delta_cents!), ref: refWord, total: brl(curC), refTotal: brl(refC!), cat: up?.name ?? "", catDelta: up ? brl(up.delta_cents!, { sign: true }) : "" }, tone: "attention", severity: 1, deadline: null, impactCents: cmp.delta_cents!, evidence: 0.8, id: "W.consumption_up" });
  }
  const mtdDown = mtdCmp.delta_cents != null && mtdRef != null && mtdRef > 0 && mtdCmp.delta_cents < 0 && -mtdCmp.delta_cents / mtdRef >= T.materialPct;
  if (material && cmp.delta_cents! < 0) {
    if (mtdDown) cands.push({ kind: "sustained_improvement", phrase: "improvement", vars: { detail: `Semana ${brl(-cmp.delta_cents!)} abaixo da anterior e mês ${brl(-mtdCmp.delta_cents!)} abaixo do mesmo trecho de ${monthName(prevYm)}.` }, tone: "good", severity: 0, deadline: null, impactCents: cmp.delta_cents!, evidence: 0.8, id: "W.improvement" });
    else cands.push({ kind: "consumption_change", phrase: "consumption_down", vars: { delta: brl(-cmp.delta_cents!), ref: refWord, total: brl(curC), refTotal: brl(refC!) }, tone: "neutral", severity: 0, deadline: null, impactCents: cmp.delta_cents!, evidence: 0.7, id: "W.consumption_down" });
  }
  for (const g of i.goals) {
    if (g.pct >= T.goalRiskPct && (g.daysRemaining ?? 0) > 0 && g.verdict !== "no_ritmo") cands.push({ kind: "goal_risk", phrase: "goal_risk", vars: { cat: g.category, pct: pct(g.pct, false), days: g.daysRemaining ?? 0 }, tone: "attention", severity: g.verdict === "estourou" ? 2 : 1, deadline: null, impactCents: 0, evidence: 0.8, id: `W.goal:${g.category}` });
  }
  const neutral: Candidate = noData
    ? { kind: "neutral", phrase: "no_data", vars: { start: ddmm(start), end: ddmm(cutoff) }, tone: "neutral", severity: 0, deadline: null, impactCents: 0, evidence: 1, id: "W.no_data" }
    : { kind: "neutral", phrase: "neutral_week", vars: { total: brl(curC), refTotal: refC == null ? "sem base" : brl(refC) }, tone: "neutral", severity: 0, deadline: null, impactCents: 0, evidence: 1, id: "W.neutral" };
  const { insight, action } = choose(noData && !risk ? [] : cands, neutral);

  const flags: string[] = [];
  if (isPartial) flags.push("partial_period");
  if (!hasHistory) flags.push("no_history");
  if (balEnd == null) flags.push("no_balance");
  if (i.quality.stale) flags.push("stale_accounts");
  if (uncat != null && uncat >= T.uncategorizedShare) flags.push("uncategorized");
  const caveat = isPartial
    ? `Semana em andamento: números até ${ddmm(cutoff)}. Saldo previsto é estimativa, não garantia.`
    : i.quality.notes[0] ? clamp(i.quality.notes[0], TEXT_LIMITS.caveat) : "Valores previstos são estimativas com base nos dados registrados até a data de corte.";

  return {
    report_id: `weekly:${i.userId}:${start}${isPartial ? `:${cutoff}` : ""}`,
    user_id: i.userId, type: "weekly", period_start: start, period_end_exclusive: endExcl, as_of: cutoff, timezone: i.timezone, is_partial: isPartial,
    comparison_start: refStart, comparison_end_exclusive: refEnd, generated_at: i.generatedAt, data_version: SUMMARY_DATA_VERSION, template_version: SUMMARY_TEMPLATE_VERSION,
    title: clamp(`Resumo da semana · ${rangeLabel(start, addDays(endExcl, -1))}`, TEXT_LIMITS.title),
    subtitle: isPartial ? `Semana em andamento · dados até ${ddmm(cutoff)}` : "Semana fechada · segunda a domingo",
    hero,
    hero_side: risk
      ? { label: "Consumo da semana", value: brl(curC), note: cmp.delta_cents == null ? cmp.text : `${brl(cmp.delta_cents, { sign: true })}${cmp.delta_pct == null ? "" : ` (${pct(cmp.delta_pct)})`} vs. anterior` }
      : { label: days >= 7 ? "7 dias anteriores" : `Mesmos ${days} dias da semana anterior`, value: refC == null ? "sem histórico" : brl(refC), note: refC == null ? "primeira semana com lançamentos" : `${ddmm(refStart)} a ${ddmm(addDays(refEnd, -1))}` },
    kpis, categories, categories_title: "Onde você mais gastou", categories_empty: categories.length ? null : "Nenhum lançamento registrado na semana.",
    future_title: "Olhando para frente", future, evolution: null, insight, action, quality_flags: flags, caveat: clamp(caveat, TEXT_LIMITS.caveat),
    metrics: risk ? [hero, consumoMetric, ...kpis] : [hero, ...kpis],
  };
}
