// Veredito das metas (`goal_verdict.v1`): "ter meta está fazendo sentido?" e "para quais categorias vale criar meta?".
//
// Conceitos (todos explicáveis em uma frase):
//  - REFERÊNCIA: a média que a pessoa tinha ao criar a meta, congelada (`baseline_value`). Nunca recalculada.
//  - EVITADO (líquido): referência − gasto real, por mês fechado COM meta, somado em TODAS as categorias com meta —
//    inclusive as que subiram. Só categoria que caiu não conta: isso é escolher o que mostrar.
//  - Efeito por categoria: caiu ≥ 10% = ajudou; subiu ≥ 10% = não ajudou; no meio = sem efeito claro.
//  - Confiança pelo número de meses fechados (1 = indício, 2 = razoável, 3+ = firme), nunca pelo valor.
//  - Honestidade: o gasto de categorias SEM meta no mesmo período e o gasto variável total entram como contexto.
//    Evitar numa categoria só vira dinheiro guardado se o total também caiu.
// Módulo puro, sem I/O. Não prova causa: compara com a própria história da pessoa.

import { isObligationCategory, type SpendingEntry } from "./spendingGoals";
import type { GoalSeries } from "./goalHistory";

export const GOAL_VERDICT_VERSION = "goal_verdict.v1";

export type GoalVerdictKind = "sim" | "parcial" | "nao" | "cedo";
export type GoalEffectStatus = "ajudou" | "nao_ajudou" | "sem_efeito" | "cedo";
export type GoalConfidence = "alta" | "media" | "baixa";

export interface GoalCategoryEffect {
  category_id: string;
  category_name: string;
  closed_months: number;
  baseline: number | null;
  after_avg: number | null;
  /** referência − gasto médio (positivo = gastou menos que antes) */
  delta_month: number | null;
  /** gasto médio / referência − 1 (negativo = caiu) */
  change_pct: number | null;
  /** delta_month × meses fechados */
  total_avoided: number | null;
  status: GoalEffectStatus;
  confidence: GoalConfidence;
}

export interface GoalVerdict {
  version: typeof GOAL_VERDICT_VERSION;
  verdict: GoalVerdictKind;
  headline: string;
  summary: string;
  confidence: GoalConfidence;
  confidence_note: string;
  closed_goal_months: number;
  categories_measured: number;
  /** Evitado por mês, líquido (positivo = gastou menos). */
  net_monthly: number | null;
  baseline_monthly: number | null;
  /** Variação do gasto das categorias com meta (negativo = caiu). */
  net_pct: number | null;
  total_avoided: number | null;
  helped: number;
  hurt: number;
  flat: number;
  by_category: GoalCategoryEffect[];
  /** Gasto variável total (todas as categorias de consumo livre) antes das metas × desde as metas. */
  variable_total: { before_avg: number; after_avg: number; change_pct: number; months_before: number; months_after: number } | null;
  /** Variação do gasto de categorias SEM meta no mesmo período (contexto). */
  control_change_pct: number | null;
  caveats: string[];
}

export interface GoalCandidate {
  category_id: string;
  category_name: string;
  avg_month: number;
  share_variable: number;
  trend_pct: number | null;
  behavior: "habito" | "concentrado" | "misto";
  charges_per_month: number;
  top_merchant: { label: string; share: number } | null;
  priority: "alta" | "media";
  recommended_limit: number;
  potential_month: number;
  reasons: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const pct = (r: number) => `${Math.round(Math.abs(r) * 100)}%`;

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 60; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

const HELPED_AT = -0.10;
const HURT_AT = 0.10;

const confidenceOfMonths = (n: number): GoalConfidence => (n >= 3 ? "alta" : n === 2 ? "media" : "baixa");
const downgrade = (c: GoalConfidence): GoalConfidence => (c === "alta" ? "media" : "baixa");

export function effectOfSeries(s: GoalSeries): GoalCategoryEffect {
  const closed = s.months.filter((m) => m.status === "met" || m.status === "missed");
  const n = closed.length;
  if (!n || s.baseline == null || s.baseline <= 0) {
    return { category_id: s.category_id, category_name: s.category_name, closed_months: n, baseline: s.baseline, after_avg: null, delta_month: null, change_pct: null, total_avoided: null, status: "cedo", confidence: "baixa" };
  }
  const after = closed.reduce((a, m) => a + m.actual, 0) / n;
  const delta = s.baseline - after;
  const change = after / s.baseline - 1;
  return {
    category_id: s.category_id,
    category_name: s.category_name,
    closed_months: n,
    baseline: round2(s.baseline),
    after_avg: round2(after),
    delta_month: round2(delta),
    change_pct: round2(change),
    total_avoided: round2(delta * n),
    status: change <= HELPED_AT ? "ajudou" : change >= HURT_AT ? "nao_ajudou" : "sem_efeito",
    confidence: confidenceOfMonths(n),
  };
}

export function buildGoalVerdict(args: {
  series: GoalSeries[];
  entries: SpendingEntry[];
  categories: Array<{ id: string; name: string }>;
  current: string;
  controlChange: number | null;
}): GoalVerdict {
  const effects = args.series.map(effectOfSeries).sort((a, b) => (b.delta_month ?? -1e9) - (a.delta_month ?? -1e9));
  const measured = effects.filter((e) => e.closed_months > 0 && e.baseline != null && e.delta_month != null);
  const months = measured.reduce((a, e) => a + e.closed_months, 0);
  const helped = measured.filter((e) => e.status === "ajudou").length;
  const hurt = measured.filter((e) => e.status === "nao_ajudou").length;
  const flat = measured.filter((e) => e.status === "sem_efeito").length;
  const caveats: string[] = [];

  const base = {
    version: GOAL_VERDICT_VERSION as typeof GOAL_VERDICT_VERSION,
    closed_goal_months: months,
    categories_measured: measured.length,
    helped, hurt, flat,
    by_category: effects,
    control_change_pct: args.controlChange,
  };

  if (!measured.length || months < 2) {
    return {
      ...base, verdict: "cedo", headline: "Ainda é cedo para dizer.",
      summary: `Para saber se ter meta ajuda, preciso de pelo menos 2 meses fechados com meta (hoje: ${months}). Quando fechar o próximo mês, eu comparo com o que você gastava antes.`,
      confidence: "baixa", confidence_note: "Poucos meses para concluir.",
      net_monthly: null, baseline_monthly: null, net_pct: null, total_avoided: null, variable_total: null, caveats,
    };
  }

  const net = round2(measured.reduce((a, e) => a + (e.delta_month ?? 0), 0));
  const baselineSum = round2(measured.reduce((a, e) => a + (e.baseline ?? 0), 0));
  const netPct = baselineSum > 0 ? round2(-net / baselineSum) : 0;
  const totalAvoided = round2(measured.reduce((a, e) => a + (e.total_avoided ?? 0), 0));

  let verdict: GoalVerdictKind;
  if (netPct <= -0.10 && helped > hurt) verdict = "sim";
  else if (netPct < -0.03) verdict = "parcial";
  else verdict = "nao";

  let confidence: GoalConfidence = months >= 8 && measured.length >= 3 ? "alta" : months >= 4 ? "media" : "baixa";

  // O resultado depende de uma categoria só?
  const top = measured[0];
  if (net > 0 && top && (top.delta_month ?? 0) > 0 && (top.delta_month ?? 0) / net > 0.5 && measured.length > 1) {
    caveats.push(`Mais da metade do ganho vem de ${top.category_name}; sem ela o efeito seria bem menor.`);
  }

  // Contexto: o resto dos gastos andou junto?
  const control = args.controlChange;
  if (control != null && netPct < 0) {
    if (control <= -0.05 && control <= netPct * 0.6) {
      caveats.push(`Seus gastos sem meta também caíram ${pct(control)} no mesmo período: parte da queda pode não ser da meta.`);
      confidence = downgrade(confidence);
    } else if (control >= 0.05) {
      caveats.push(`Enquanto isso, seus gastos sem meta subiram ${pct(control)}: a queda nas categorias com meta não parece ser só uma fase boa.`);
    }
  }

  // Evitado só vira dinheiro guardado se o gasto variável total também caiu.
  const variable = variableTotals(args.entries, args.categories, args.series, args.current);
  const variableFell = variable ? variable.before_avg - variable.after_avg : null;
  const shifted = variable != null && net > 0 && (variableFell ?? 0) < net * 0.5;
  if (shifted && verdict === "sim") verdict = "parcial";
  if (shifted && netPct > -0.10) caveats.push(`O seu gasto variável total caiu só ${brl(Math.max(0, variableFell ?? 0))} por mês, menos do que o ganho nas categorias com meta: parte do que você evitou pode ter ido para outras categorias.`);
  if (months < 4) caveats.push("Poucos meses de meta ainda: leia como indício, não como certeza.");

  const confidence_note = confidence === "alta" ? "Base firme: vários meses e várias categorias." : confidence === "media" ? "Base razoável: pode mudar nos próximos meses." : "Base pequena: é um indício, não uma conclusão.";

  let headline: string;
  let summary: string;
  if (shifted && netPct <= -0.10) {
    headline = "Em parte: caiu nas categorias com meta, mas o seu gasto total quase não mudou.";
    summary = `Nas categorias com meta você gasta ${brl(net)} a menos por mês (${pct(netPct)} a menos, já contando as que subiram), mas o seu gasto variável total caiu só ${brl(Math.max(0, variableFell ?? 0))} por mês: boa parte do que você evitou apareceu em outras categorias. Em ${months} meses com meta, foram ${brl(totalAvoided)} evitados nas categorias com meta.`;
  } else if (verdict === "sim") {
    headline = "Sim: ter metas está fazendo sentido.";
    summary = `Nas categorias com meta você gasta ${brl(net)} a menos por mês do que gastava antes (${pct(netPct)} a menos), já contando as que não melhoraram${variableFell != null && variableFell > 0 ? `, e o seu gasto variável total também caiu (${brl(variableFell)} por mês)` : ""}. Em ${months} meses com meta, isso soma ${brl(totalAvoided)} evitados.`;
  } else if (verdict === "parcial") {
    headline = "Em parte: ajudou, mas não em tudo.";
    summary = `Nas categorias com meta você gasta ${brl(net)} a menos por mês (${pct(netPct)} a menos), mas ${hurt > 0 ? `${hurt} ${hurt === 1 ? "categoria subiu" : "categorias subiram"}` : "o efeito ainda é pequeno"}. Em ${months} meses com meta, foram ${brl(totalAvoided)} evitados.`;
  } else if (net < 0 && Math.abs(netPct) >= 0.03) {
    headline = "Por enquanto, não.";
    summary = `Nas categorias com meta você está gastando ${brl(-net)} a mais por mês do que antes (${pct(netPct)} a mais). Vale rever os tetos ou o que mudou nessas categorias.`;
  } else {
    headline = "Por enquanto, não dá para ver efeito.";
    summary = "O gasto nas categorias com meta está praticamente igual ao de antes das metas.";
  }

  return { ...base, verdict, headline, summary, confidence, confidence_note, net_monthly: net, baseline_monthly: baselineSum, net_pct: netPct, total_avoided: totalAvoided, variable_total: variable, caveats };
}

/** Gasto variável total (categorias de consumo livre): 3 meses antes da 1ª meta × meses fechados desde então. */
function variableTotals(entries: SpendingEntry[], categories: Array<{ id: string; name: string }>, series: GoalSeries[], current: string) {
  const first = series.map((s) => s.first_month).sort()[0];
  if (!first) return null;
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!e.category_id) continue;
    const name = names.get(e.category_id);
    if (!name || isObligationCategory(name) || EXCLUDE_RX.test(name)) continue;
    totals.set(e.month, (totals.get(e.month) ?? 0) + e.amount);
  }
  const lastClosed = shiftMonth(current, -1);
  const beforeMonths = monthRange(shiftMonth(first, -3), shiftMonth(first, -1)).filter((m) => (totals.get(m) ?? 0) > 0);
  const afterMonths = (first <= lastClosed ? monthRange(first, lastClosed) : []).filter((m) => (totals.get(m) ?? 0) > 0);
  if (!beforeMonths.length || !afterMonths.length) return null;
  const avg = (ms: string[]) => ms.reduce((a, m) => a + Math.max(0, totals.get(m) ?? 0), 0) / ms.length;
  const b = avg(beforeMonths);
  const a = avg(afterMonths);
  return { before_avg: round2(b), after_avg: round2(a), change_pct: b > 0 ? round2(a / b - 1) : 0, months_before: beforeMonths.length, months_after: afterMonths.length };
}

// ───────── Categorias que merecem uma meta ─────────
// Critério: categoria de consumo livre, SEM meta, que pesa (≥ R$ 150/mês e ≥ 4% do gasto variável — ou ≥ 2% se estiver
// subindo ≥ 20%). Essenciais (mercado, farmácia, contas da casa) só entram subindo. Obrigações (moradia, dívida,
// dízimo, saúde, educação…), "Outros" e rolê (reembolsável) nunca. Prioridade alta = ≥ 10% do variável, ou ≥ 5% e subindo.

/** Reembolsável, não classificado e contas da casa (energia, água, internet…): não é onde o usuário decide reduzir. */
const EXCLUDE_RX = /^outros?$|sem categoria|divis[aã]o do rol|reembolso|energia|\bluz\b|[aá]gua|internet|g[aá]s\b|telefone|celular/i;
/** Essenciais variáveis: só aparecem se estiverem subindo. */
const ESSENTIAL_RX = /mercado|supermercado|farm[aá]cia/i;
const MIN_AVG = 150;
const MIN_SHARE = 0.04;
/** Categoria que está subindo vale a atenção mesmo sendo menor. */
const MIN_SHARE_RISING = 0.02;

function roundLimit(value: number): number {
  if (value <= 0) return 0;
  const step = value < 300 ? 10 : value < 2000 ? 50 : 100;
  return Math.round(value / step) * step;
}

export function buildGoalCandidates(args: {
  entries: SpendingEntry[];
  categories: Array<{ id: string; name: string }>;
  goalCategoryIds: Set<string>;
  current: string;
  maxItems?: number;
}): GoalCandidate[] {
  const names = new Map(args.categories.map((c) => [c.id, c.name]));
  const lastClosed = shiftMonth(args.current, -1);
  const window = monthRange(shiftMonth(lastClosed, -5), lastClosed);
  const inWindow = new Set(window);

  // Meses com algum dado de consumo (não penaliza quem começou a usar o app há pouco).
  const perCat = new Map<string, { totals: Map<string, number>; n: number; merchants: Map<string, { label: string; amount: number }> }>();
  const monthsWithData = new Set<string>();
  for (const e of args.entries) {
    if (!e.category_id || !inWindow.has(e.month)) continue;
    const name = names.get(e.category_id);
    if (!name || isObligationCategory(name) || EXCLUDE_RX.test(name)) continue;
    monthsWithData.add(e.month);
    const row = perCat.get(e.category_id) ?? { totals: new Map(), n: 0, merchants: new Map() };
    row.totals.set(e.month, (row.totals.get(e.month) ?? 0) + e.amount);
    if (e.amount > 0) {
      row.n += 1;
      const m = row.merchants.get(e.merchant_key) ?? { label: e.merchant_label, amount: 0 };
      m.amount += e.amount;
      row.merchants.set(e.merchant_key, m);
    }
    perCat.set(e.category_id, row);
  }
  const months = window.filter((m) => monthsWithData.has(m));
  if (months.length < 3) return [];

  const avgOf = (row: { totals: Map<string, number> }, ms: string[]) =>
    ms.length ? ms.reduce((a, m) => a + Math.max(0, row.totals.get(m) ?? 0), 0) / ms.length : 0;
  const rows = [...perCat.entries()].map(([id, row]) => ({ id, row, avg: avgOf(row, months) }));
  const totalAvg = rows.reduce((a, r) => a + r.avg, 0);
  if (totalAvg <= 0) return [];
  rows.sort((a, b) => b.avg - a.avg);

  const recent = months.slice(-3);
  const previous = months.slice(-6, -3);
  const out: GoalCandidate[] = [];
  for (const { id, row, avg } of rows) {
    const share = avg / totalAvg;
    if (args.goalCategoryIds.has(id)) continue;
    const name = names.get(id) ?? "Categoria";
    const prevAvg = avgOf(row, previous);
    const recentAvg = avgOf(row, recent);
    const trend = previous.length && prevAvg >= 50 ? round2(recentAvg / prevAvg - 1) : null;
    const rising = trend != null && trend >= 0.2;
    if (avg < MIN_AVG || share < (rising ? MIN_SHARE_RISING : MIN_SHARE)) continue;
    if (ESSENTIAL_RX.test(name) && !rising) continue;

    const charges = row.n / months.length;
    const topM = [...row.merchants.values()].sort((a, b) => b.amount - a.amount)[0];
    const sumM = [...row.merchants.values()].reduce((a, m) => a + m.amount, 0);
    const topShare = topM && sumM > 0 ? topM.amount / sumM : 0;
    const behavior: GoalCandidate["behavior"] = charges >= 8 ? "habito" : charges < 4 || topShare >= 0.5 ? "concentrado" : "misto";

    const base3 = recentAvg > 0 ? recentAvg : avg;
    const limit = roundLimit(base3 * 0.9);
    const reasons = [`Média de ${brl(avg)} por mês, ${pct(share)} do seu gasto variável.`];
    if (trend != null && Math.abs(trend) >= 0.15) reasons.push(trend > 0 ? `Subiu ${pct(trend)} nos últimos 3 meses.` : `Caiu ${pct(trend)} nos últimos 3 meses.`);
    if (behavior === "habito") reasons.push(`Muitas compras pequenas (cerca de ${Math.round(charges)} por mês): é onde meta e lembrete mais funcionam.`);
    else if (behavior === "concentrado") reasons.push("Poucos lançamentos grandes: um teto ajuda a decidir antes de comprar.");
    if (topM && topShare >= 0.35) reasons.push(`${topM.label} pesa ${pct(topShare)} da categoria.`);

    out.push({
      category_id: id,
      category_name: name,
      avg_month: round2(avg),
      share_variable: round2(share),
      trend_pct: trend,
      behavior,
      charges_per_month: round2(charges),
      top_merchant: topM && topShare >= 0.35 ? { label: topM.label, share: round2(topShare) } : null,
      priority: share >= 0.10 || (rising && share >= 0.05) ? "alta" : "media",
      recommended_limit: limit,
      potential_month: round2(Math.max(0, base3 - limit)),
      reasons,
    });
  }
  out.sort((a, b) => (a.priority === b.priority ? b.avg_month - a.avg_month : a.priority === "alta" ? -1 : 1));
  return out.slice(0, args.maxItems ?? 4);
}
