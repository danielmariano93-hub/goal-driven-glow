// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Detectores determinísticos de destaques (reports_catalog.v1).
// Cada detector só usa números já calculados pelo motor — nunca cria valor novo.
import { round2 } from "../finance-core/facts.ts";
import { compactBRL, pct } from "../copy/numbers.ts";
import { resultHeadline } from "../copy/resultWording.ts";
import { isFlexibleCategory } from "./engine.ts";
import type { ReportHighlight, ReportPayload } from "./types.ts";

const BRL = (n: number) => compactBRL(n);
const PCT = (n: number) => pct(n, "card");

export function detectHighlights(payload: ReportPayload): ReportHighlight[] {
  const t = payload.totals;
  const out: ReportHighlight[] = [];
  const periodWord = payload.reportType === "weekly" ? "semana" : payload.reportType === "custom" ? "período" : "mês";
  const prefix = `${payload.reportType}:${payload.period.start}`;

  if (t.net < 0) {
    out.push({
      detectorKey: "negative_result",
      type: "risk",
      title: resultHeadline(t.income, t.expense, periodWord),
      body: `O ajuste mais rápido costuma estar nos gastos que dão pra ajustar. Eles somaram ${BRL(t.flexibleTotal)} neste ${periodWord}.`,
      priority: 100,
      confidence: t.income > 0 ? "high" : "medium",
      evidence: { net: t.net, income: t.income, expense: t.expense },
      ctaLabel: "Ver lançamentos",
      ctaRoute: "/app/lancamentos",
      dedupKey: `${prefix}:negative_result`,
      selectionReason: "gastos do período acima das receitas",
    });

  } else if (t.savingsRate !== null && t.savingsRate >= 0.2) {
    out.push({
      detectorKey: "strong_savings",
      type: "win",
      title: `Sobrou dinheiro neste ${periodWord}.`,
      body: `Você terminou com ${BRL(t.net)} livre. Vale direcionar uma parte para a meta mais importante.`,
      priority: 70,
      confidence: "high",
      evidence: { savings_rate: round2(t.savingsRate * 100), net: t.net },
      ctaLabel: "Ver metas",
      ctaRoute: "/app/metas",
      dedupKey: `${prefix}:strong_savings`,
      selectionReason: "taxa de sobra igual ou superior a 20%",
    });
  }

  if (t.expenseDeltaPct !== null && t.expenseDeltaPct >= 20 && t.previousExpense > 0) {
    out.push({
      detectorKey: "expense_spike",
      type: "risk",
      title: `Seus gastos subiram neste ${periodWord}.`,
      body: `Foram ${BRL(t.expense)} agora, contra ${BRL(t.previousExpense)} antes. Vale separar o que foi pontual do que virou rotina.`,
      priority: 92,
      confidence: "high",
      evidence: { current: t.expense, previous: t.previousExpense, delta_pct: t.expenseDeltaPct },
      ctaLabel: "Ver relatórios",
      ctaRoute: "/app/relatorios",
      dedupKey: `${prefix}:expense_spike`,
      selectionReason: "alta de 20% ou mais nas despesas",
    });
  } else if (t.expenseDeltaPct !== null && t.expenseDeltaPct <= -15 && t.previousExpense > 0) {
    out.push({
      detectorKey: "expense_drop",
      type: "win",
      title: `Seus gastos caíram neste ${periodWord}.`,
      body: `Foram ${BRL(t.expense)} agora, contra ${BRL(t.previousExpense)} antes. Vale entender o que mudou para repetir.`,
      priority: 60,
      confidence: "high",
      evidence: { current: t.expense, previous: t.previousExpense, delta_pct: t.expenseDeltaPct },
      dedupKey: `${prefix}:expense_drop`,
      selectionReason: "queda de 15% ou mais nas despesas",
    });
  }

  const top = payload.categories[0];
  if (top && top.share >= 0.3) {
    out.push({
      detectorKey: "category_concentration",
      type: "info",
      title: `${top.category} é o ponto principal do período.`,
      body: `Foram ${BRL(top.total)} nesse grupo. Ajustar aqui muda mais o resultado do que cortar gastos pequenos espalhados.`,
      priority: 80,
      confidence: "high",
      category: top.category,
      evidence: { category: top.category, total: top.total, share: round2(top.share * 100), count: top.count },
      ctaLabel: "Ver categorias",
      ctaRoute: "/app/categorias",
      dedupKey: `${prefix}:category_concentration:${top.category}`,
      selectionReason: "categoria líder acima de 30% das despesas",
    });
  }

  const worsened = payload.categories
    .filter((c) => c.deltaPct !== null && c.deltaPct >= 30 && c.total >= Math.max(100, t.expense * 0.05))
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  if (worsened && worsened.category !== top?.category) {
    out.push({
      detectorKey: "category_growth",
      type: "risk",
      title: `${worsened.category} foi a mudança que mais chamou atenção.`,
      body: `Saiu de ${BRL(worsened.previous)} para ${BRL(worsened.total)}. Vale conferir se foi um evento pontual ou uma mudança de hábito.`,
      priority: 85,
      confidence: "medium",
      category: worsened.category,
      evidence: { category: worsened.category, current: worsened.total, previous: worsened.previous, delta_pct: worsened.deltaPct },
      dedupKey: `${prefix}:category_growth:${worsened.category}`,
      selectionReason: "categoria relevante com alta de 30% ou mais",
    });
  }

  const flexible = payload.categories.find((c) => isFlexibleCategory(c.category) && c.total >= Math.max(80, t.expense * 0.05));
  if (flexible) {
    const cutPct = flexible.share >= 0.18 ? 15 : 10;
    const saving = round2(flexible.total * (cutPct / 100));
    out.push({
      detectorKey: "flexible_saving",
      type: "opportunity",
      title: `Há espaço de ajuste em ${flexible.category}.`,
      body: `Um corte pequeno aqui pode liberar cerca de ${BRL(saving)} sem mexer nas contas essenciais.`,
      priority: 65,
      confidence: "medium",
      category: flexible.category,
      evidence: { category: flexible.category, total: flexible.total, cut_pct: cutPct, saving },
      dedupKey: `${prefix}:flexible_saving:${flexible.category}`,
      selectionReason: "categoria flexível com volume relevante",
    });
  }

  const uncategorized = payload.categories.find((c) => c.category === "Sem categoria");
  if (uncategorized && uncategorized.share >= 0.1) {
    out.push({
      detectorKey: "uncategorized",
      type: "info",
      title: `Lançamentos sem categoria estão atrapalhando a leitura.`,
      body: `São ${BRL(uncategorized.total)} sem classificação. Antes de concluir que você gastou mais, vale organizar esses lançamentos.`,
      priority: 75,
      confidence: "high",
      evidence: { total: uncategorized.total, count: uncategorized.count, share: round2(uncategorized.share * 100) },
      ctaLabel: "Classificar lançamentos",
      ctaRoute: "/app/lancamentos",
      dedupKey: `${prefix}:uncategorized`,
      selectionReason: "10% ou mais das despesas sem categoria",
    });
  }

  if (t.biggestExpense && t.expense > 0 && t.biggestExpense.amount >= t.expense * 0.25) {
    out.push({
      detectorKey: "single_large_expense",
      type: "info",
      title: `Um gasto sozinho mudou a leitura do período.`,
      body: `${t.biggestExpense.description} foi ${BRL(t.biggestExpense.amount)}. Se foi pontual, não trate esse período como sua rotina normal.`,
      priority: 55,
      confidence: "high",
      category: t.biggestExpense.category,
      evidence: { ...t.biggestExpense, share: round2((t.biggestExpense.amount / t.expense) * 100) },
      dedupKey: `${prefix}:single_large_expense`,
      selectionReason: "maior gasto acima de 25% do total",
    });
  }

  if (t.cardOutstanding > 0 && t.cashTotal >= 0 && t.cardOutstanding > t.cashTotal) {
    out.push({
      detectorKey: "card_over_cash",
      type: "risk",
      title: `A fatura em aberto está maior que seu saldo.`,
      body: `O cartão soma ${BRL(t.cardOutstanding)} e hoje há ${BRL(t.cashTotal)} disponível. Vale revisar novas compras antes do vencimento.`,
      priority: 95,
      confidence: "medium",
      evidence: { card_outstanding: t.cardOutstanding, cash_total: t.cashTotal },
      ctaLabel: "Ver cartões",
      ctaRoute: "/app/cartoes",
      dedupKey: `${prefix}:card_over_cash`,
      selectionReason: "exposição de cartão acima do caixa disponível",
    });
  }

  const bestGoal = payload.goals[0];
  if (bestGoal && bestGoal.target > 0 && bestGoal.progress >= 0.5) {
    out.push({
      detectorKey: "goal_progress",
      type: "win",
      title: `${bestGoal.name} já passou da metade.`,
      body: `Faltam ${BRL(round2(bestGoal.target - bestGoal.current))}. Manter o próximo aporte deixa essa meta mais previsível.`,
      priority: 50,
      confidence: "high",
      evidence: { ...bestGoal },
      ctaLabel: "Ver metas",
      ctaRoute: "/app/metas",
      dedupKey: `${prefix}:goal_progress:${bestGoal.name}`,
      selectionReason: "meta ativa com metade ou mais concluída",
    });
  }

  if (t.daysWithExpense === 0) {
    out.push({
      detectorKey: "no_activity",
      type: "info",
      title: `Nenhum gasto registrado neste ${periodWord}`,
      body: `Sem lançamentos não é possível ler padrões. Registrar pelo WhatsApp leva segundos e devolve o relatório com leitura real.`,
      priority: 99,
      confidence: "low",
      evidence: {},
      ctaLabel: "Falar com o Nino",
      ctaRoute: "/app/assessor",
      dedupKey: `${prefix}:no_activity`,
      selectionReason: "período sem despesas registradas",
    });
  }

  return out
    .map((h) => ({ ...h, family: h.family ?? FAMILY_BY_DETECTOR[h.detectorKey] ?? h.detectorKey, source: "period" as const }))
    .sort((a, b) => b.priority - a.priority);
}

/** Família de cada detector de período — evita duas leituras do mesmo assunto. */
const FAMILY_BY_DETECTOR: Record<string, string> = {
  negative_result: "resultado",
  strong_savings: "resultado",
  expense_spike: "variacao",
  expense_drop: "variacao",
  category_concentration: "categoria",
  category_growth: "categoria",
  flexible_saving: "economia",
  uncategorized: "categorizacao",
  single_large_expense: "anomalia",
  card_over_cash: "cartao",
  goal_progress: "metas",
  no_activity: "engajamento",
};

/** Quantos destaques o relatório publica. */
export const MAX_REPORT_HIGHLIGHTS = 8;

/**
 * Une os destaques do período com os candidatos do catálogo de insights.
 * Regras: dedup por `dedupKey`, no máximo um destaque por família (o de maior
 * prioridade vence; empate favorece o motor do período) e limite global.
 */
export function mergeHighlights(
  periodHighlights: ReportHighlight[],
  catalogHighlights: ReportHighlight[] = [],
  limit = MAX_REPORT_HIGHLIGHTS,
): ReportHighlight[] {
  const all = [
    ...periodHighlights.map((h) => ({ ...h, source: h.source ?? ("period" as const) })),
    ...catalogHighlights.map((h) => ({ ...h, source: h.source ?? ("catalog" as const) })),
  ];
  const sourceRank = (h: ReportHighlight) => (h.source === "period" ? 0 : 1);
  const ordered = [...all].sort((a, b) => (b.priority - a.priority) || (sourceRank(a) - sourceRank(b)));

  const seenDedup = new Set<string>();
  const seenFamily = new Set<string>();
  const picked: ReportHighlight[] = [];
  for (const h of ordered) {
    const family = h.family ?? h.detectorKey;
    if (seenDedup.has(h.dedupKey)) continue;
    if (seenFamily.has(family)) continue;
    seenDedup.add(h.dedupKey);
    seenFamily.add(family);
    picked.push({ ...h, family });
    if (picked.length >= limit) break;
  }
  return picked;
}

