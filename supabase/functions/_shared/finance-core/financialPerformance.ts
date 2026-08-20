// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de performance financeira (`financial_performance.v1`).
//
// Não responde "+12%". Responde: o que mudou, por que mudou, se é bom ou ruim,
// se é estrutural/comportamental/de calendário, qual a confiança e o que merece
// atenção. Toda saída é um `FinancialPerformanceHighlight` determinístico —
// consumido igualmente por Home, Relatórios, WhatsApp e Proatividade.
import { round2, formatBRL, type TransactionRow } from "./facts.ts";
import { classifyFlexibility, type SpendFlexibility } from "./costStructure.ts";
import {
  computeFinancialComparison,
  type ComparisonMetric,
  type ComparisonMode,
  type Comparability,
  type FinancialComparisonResult,
} from "./financialComparison.ts";
import type { EngineConfidence } from "./engineEnvelope.ts";
import { monthOf, monthPeriod, previousMonth } from "./ninoClock.ts";

export const FINANCIAL_PERFORMANCE_VERSION = "financial_performance.v1";

export type HighlightType =
  | "expense_improvement" | "expense_deterioration"
  | "income_improvement" | "income_drop"
  | "net_result_improvement" | "net_result_deterioration"
  | "savings_rate_improvement"
  | "category_improvement" | "category_deterioration"
  | "fixed_cost_increase" | "fixed_cost_decrease"
  | "behavior_improvement" | "behavior_relapse"
  | "spending_frequency_change" | "average_ticket_change"
  | "card_cycle_improvement" | "card_cycle_deterioration"
  | "financial_stability_improvement" | "financial_stability_deterioration";

export type HighlightDomain =
  | "spending" | "income" | "result" | "behavior" | "card" | "cost_structure" | "stability";

export type StructuralNature = "structural" | "behavioral" | "timing" | "mixed" | "unknown";

export type HighlightDriver = {
  label: string;
  delta_abs: number;
  nature: StructuralNature;
  flexibility: SpendFlexibility;
};

export type FinancialPerformanceHighlight = {
  id: string;
  type: HighlightType;
  domain: HighlightDomain;
  subject: string | null;
  title_fact: string;
  current_value: number;
  previous_value: number;
  delta_abs: number;
  delta_pct: number | null;
  direction: "up" | "down" | "flat";
  /** Frase de leitura, calibrada por confiança. Nunca transforma hipótese em fato. */
  interpretation: string;
  drivers: HighlightDriver[];
  structural_or_timing: StructuralNature;
  materiality: number;
  confidence: EngineConfidence;
  comparability: Comparability;
  sentiment: "positive" | "negative" | "neutral";
  actionable: boolean;
  recommended_action: string | null;
  methodology: string;
  evidence: {
    current_period: { from: string; to: string };
    previous_period: { from: string; to: string };
    observed_change: number;
    normalized_change: number;
    formula_version: string;
  };
  logical_topic_key: string;
  valid_until: string;
};

export type PerformanceInput = {
  txs: TransactionRow[];
  categoryNames: Map<string, string>;
  as_of: string;
  mode?: ComparisonMode;
  /** Categorias com desembolso recorrente esperado (assinaturas, moradia, dívida). */
  recurringCategories?: string[];
  /** Piso de materialidade em R$ (default 50). */
  materialityFloor?: number;
};

export type PerformanceResult = {
  highlights: FinancialPerformanceHighlight[];
  comparisons: FinancialComparisonResult[];
  headline: string;
  formula_version: string;
};

function confidenceWording(confidence: EngineConfidence, fact: string): string {
  if (confidence === "high") return fact;
  if (confidence === "medium") return `Os dados indicam que ${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
  return `Há um sinal de que ${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
}

function natureOf(
  label: string,
  deltaAbs: number,
  current: number,
  previous: number,
  recurringCategories: string[],
): { nature: StructuralNature; flexibility: SpendFlexibility } {
  const flexibility = classifyFlexibility(label);
  const isRecurring = recurringCategories.some((c) => c.toLowerCase() === label.toLowerCase())
    || flexibility === "estrutural";
  // Queda total de um desembolso recorrente = calendário, não melhora de hábito.
  if (deltaAbs < 0 && isRecurring && current === 0 && previous > 0) {
    return { nature: "timing", flexibility };
  }
  if (isRecurring) return { nature: "structural", flexibility };
  if (flexibility === "flexivel") return { nature: "behavioral", flexibility };
  return { nature: "unknown", flexibility };
}

function dominantNature(drivers: HighlightDriver[]): StructuralNature {
  if (!drivers.length) return "unknown";
  const weight = new Map<StructuralNature, number>();
  for (const d of drivers) {
    weight.set(d.nature, (weight.get(d.nature) ?? 0) + Math.abs(d.delta_abs));
  }
  const sorted = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  if (sorted.length > 1 && sorted[0][1] / total < 0.6) return "mixed";
  return sorted[0][0];
}

function validUntil(asOf: string): string {
  const end = monthPeriod(monthOf(asOf)).to;
  return end > asOf ? end : asOf;
}

export function computeFinancialPerformance(input: PerformanceInput): PerformanceResult {
  const mode: ComparisonMode = input.mode ?? "MTD_EQUIVALENT";
  const floor = input.materialityFloor ?? 50;
  const recurringCategories = input.recurringCategories ?? [];
  const base = { txs: input.txs, categoryNames: input.categoryNames, as_of: input.as_of, mode };

  const metrics: ComparisonMetric[] = ["expense", "income", "net", "savings_rate", "transaction_count", "average_ticket"];
  const comparisons = metrics.map((metric) => computeFinancialComparison({ ...base, metric }));
  const byMetric = new Map(comparisons.map((c) => [c.metric, c]));
  const highlights: FinancialPerformanceHighlight[] = [];

  const expense = byMetric.get("expense")!;
  const income = byMetric.get("income")!;
  const net = byMetric.get("net")!;

  const expenseDrivers: HighlightDriver[] = expense.drivers.map((d) => {
    const { nature, flexibility } = natureOf(d.label, d.delta_abs, d.current, d.previous, recurringCategories);
    return { label: d.label, delta_abs: d.delta_abs, nature, flexibility };
  });

  // --- Despesa total -------------------------------------------------------
  if (Math.abs(expense.delta_abs) >= floor) {
    const improved = expense.delta_abs < 0;
    const nature = dominantNature(expenseDrivers.filter((d) => (improved ? d.delta_abs < 0 : d.delta_abs > 0)));
    const timingShare = expenseDrivers
      .filter((d) => d.nature === "timing")
      .reduce((s, d) => s + Math.abs(d.delta_abs), 0);
    const normalized = round2(expense.delta_abs + (improved ? timingShare : -0));
    const fact = improved
      ? `Seu gasto caiu ${formatBRL(Math.abs(expense.delta_abs))} nesse recorte.`
      : `Seu gasto subiu ${formatBRL(Math.abs(expense.delta_abs))} nesse recorte.`;
    let interpretation = confidenceWording(expense.confidence, fact);
    if (improved && (nature === "timing" || nature === "mixed") && timingShare > 0) {
      interpretation += ` Parte disso (${formatBRL(timingShare)}) vem de compromissos que ainda não apareceram no período, não de mudança de hábito.`;
    }
    highlights.push({
      id: `perf-expense-${input.as_of}`,
      type: improved ? "expense_improvement" : "expense_deterioration",
      domain: "spending",
      subject: null,
      title_fact: improved ? "Gasto abaixo do período comparado" : "Gasto acima do período comparado",
      current_value: expense.current.value,
      previous_value: expense.previous.value,
      delta_abs: expense.delta_abs,
      delta_pct: expense.delta_pct,
      direction: expense.direction,
      interpretation,
      drivers: expenseDrivers.slice(0, 5),
      structural_or_timing: nature,
      materiality: Math.abs(expense.delta_abs),
      confidence: expense.confidence,
      comparability: expense.comparability,
      sentiment: improved && nature !== "timing" ? "positive" : improved ? "neutral" : "negative",
      actionable: !improved,
      recommended_action: improved ? null : "Ver quais categorias puxaram o aumento",
      methodology: expense.methodology,
      evidence: {
        current_period: expense.evidence.current_period,
        previous_period: expense.evidence.previous_period,
        observed_change: expense.delta_abs,
        normalized_change: normalized,
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: "performance:expense:total",
      valid_until: validUntil(input.as_of),
    });
  }

  // --- Receita -------------------------------------------------------------
  if (Math.abs(income.delta_abs) >= floor) {
    const up = income.delta_abs > 0;
    highlights.push({
      id: `perf-income-${input.as_of}`,
      type: up ? "income_improvement" : "income_drop",
      domain: "income",
      subject: null,
      title_fact: up ? "Entradas maiores no período" : "Entradas menores no período",
      current_value: income.current.value,
      previous_value: income.previous.value,
      delta_abs: income.delta_abs,
      delta_pct: income.delta_pct,
      direction: income.direction,
      interpretation: confidenceWording(
        income.confidence,
        `Suas entradas ${up ? "subiram" : "caíram"} ${formatBRL(Math.abs(income.delta_abs))} nesse recorte.`,
      ),
      drivers: [],
      structural_or_timing: "unknown",
      materiality: Math.abs(income.delta_abs),
      confidence: income.confidence,
      comparability: income.comparability,
      sentiment: up ? "positive" : "negative",
      actionable: !up,
      recommended_action: up ? null : "Conferir se alguma entrada prevista ainda não caiu",
      methodology: income.methodology,
      evidence: {
        current_period: income.evidence.current_period,
        previous_period: income.evidence.previous_period,
        observed_change: income.delta_abs,
        normalized_change: income.delta_abs,
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: "performance:income:total",
      valid_until: validUntil(input.as_of),
    });
  }

  // --- Resultado -----------------------------------------------------------
  if (Math.abs(net.delta_abs) >= floor) {
    const better = net.delta_abs > 0;
    const expenseFell = expense.delta_abs < 0;
    const incomeFellMore = income.delta_abs < 0 && Math.abs(income.delta_abs) >= Math.abs(expense.delta_abs);
    let interpretation = confidenceWording(
      net.confidence,
      `Seu resultado ${better ? "melhorou" : "piorou"} ${formatBRL(Math.abs(net.delta_abs))} nesse recorte.`,
    );
    if (expenseFell && incomeFellMore) {
      interpretation += " O gasto caiu, mas a entrada caiu ainda mais — não é uma melhora de saúde financeira.";
    }
    highlights.push({
      id: `perf-net-${input.as_of}`,
      type: better ? "net_result_improvement" : "net_result_deterioration",
      domain: "result",
      subject: null,
      title_fact: better ? "Resultado melhor que o período comparado" : "Resultado pior que o período comparado",
      current_value: net.current.value,
      previous_value: net.previous.value,
      delta_abs: net.delta_abs,
      delta_pct: net.delta_pct,
      direction: net.direction,
      interpretation,
      drivers: expenseDrivers.slice(0, 3),
      structural_or_timing: dominantNature(expenseDrivers),
      materiality: Math.abs(net.delta_abs),
      confidence: incomeFellMore ? "medium" : net.confidence,
      comparability: net.comparability,
      sentiment: better && !incomeFellMore ? "positive" : better ? "neutral" : "negative",
      actionable: !better,
      recommended_action: better ? null : "Ver o plano para fechar o mês no positivo",
      methodology: net.methodology,
      evidence: {
        current_period: net.evidence.current_period,
        previous_period: net.evidence.previous_period,
        observed_change: net.delta_abs,
        normalized_change: net.delta_abs,
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: "performance:net:total",
      valid_until: validUntil(input.as_of),
    });
  }

  // --- Categorias ----------------------------------------------------------
  for (const d of expense.drivers.slice(0, 4)) {
    if (Math.abs(d.delta_abs) < Math.max(floor, expense.previous.value * 0.05)) continue;
    const { nature, flexibility } = natureOf(d.label, d.delta_abs, d.current, d.previous, recurringCategories);
    const improved = d.delta_abs < 0;
    const isFixed = flexibility === "estrutural";
    const type: HighlightType = isFixed
      ? (improved ? "fixed_cost_decrease" : "fixed_cost_increase")
      : (improved ? "category_improvement" : "category_deterioration");
    let interpretation = confidenceWording(
      expense.confidence,
      `${d.label} ${improved ? "caiu" : "subiu"} ${formatBRL(Math.abs(d.delta_abs))} no mesmo recorte.`,
    );
    if (nature === "timing") {
      interpretation += " Esse desembolso costuma acontecer no período e ainda não apareceu — é diferença de calendário.";
    } else if (nature === "behavioral" && improved) {
      interpretation += " Essa é uma redução de gasto flexível, ou seja, mudança de comportamento.";
    }
    highlights.push({
      id: `perf-cat-${d.key}-${input.as_of}`,
      type,
      domain: isFixed ? "cost_structure" : "spending",
      subject: d.label,
      title_fact: `${d.label}: ${improved ? "queda" : "alta"} de ${formatBRL(Math.abs(d.delta_abs))}`,
      current_value: d.current,
      previous_value: d.previous,
      delta_abs: d.delta_abs,
      delta_pct: d.delta_pct,
      direction: d.delta_abs > 0 ? "up" : d.delta_abs < 0 ? "down" : "flat",
      interpretation,
      drivers: [{ label: d.label, delta_abs: d.delta_abs, nature, flexibility }],
      structural_or_timing: nature,
      materiality: Math.abs(d.delta_abs),
      confidence: expense.confidence,
      comparability: expense.comparability,
      sentiment: nature === "timing" ? "neutral" : improved ? "positive" : "negative",
      actionable: !improved,
      recommended_action: improved ? null : `Definir um teto para ${d.label}`,
      methodology: expense.methodology,
      evidence: {
        current_period: expense.evidence.current_period,
        previous_period: expense.evidence.previous_period,
        observed_change: d.delta_abs,
        normalized_change: nature === "timing" ? 0 : d.delta_abs,
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: `performance:category:${d.key}`,
      valid_until: validUntil(input.as_of),
    });
  }

  // --- Comportamento: frequência e ticket ---------------------------------
  const freq = byMetric.get("transaction_count")!;
  if (Math.abs(freq.delta_abs) >= 5 && freq.previous.value > 0) {
    highlights.push({
      id: `perf-frequency-${input.as_of}`,
      type: "spending_frequency_change",
      domain: "behavior",
      subject: null,
      title_fact: `Frequência de compras ${freq.delta_abs > 0 ? "maior" : "menor"}`,
      current_value: freq.current.value,
      previous_value: freq.previous.value,
      delta_abs: freq.delta_abs,
      delta_pct: freq.delta_pct,
      direction: freq.direction,
      interpretation: confidenceWording(
        freq.confidence,
        `Você fez ${Math.abs(freq.delta_abs)} ${freq.delta_abs > 0 ? "compras mais" : "compras menos"} que no período comparado.`,
      ),
      drivers: [],
      structural_or_timing: "behavioral",
      materiality: Math.abs(freq.delta_abs),
      confidence: freq.confidence,
      comparability: freq.comparability,
      sentiment: "neutral",
      actionable: false,
      recommended_action: null,
      methodology: freq.methodology,
      evidence: {
        current_period: freq.evidence.current_period,
        previous_period: freq.evidence.previous_period,
        observed_change: freq.delta_abs,
        normalized_change: freq.delta_abs,
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: "performance:behavior:frequency",
      valid_until: validUntil(input.as_of),
    });
  }

  // --- Estabilidade: resultado melhorando em sequência ---------------------
  const months = [monthOf(input.as_of), previousMonth(monthOf(input.as_of))];
  months.push(previousMonth(months[1]), previousMonth(previousMonth(months[1])));
  const monthlyNets = months.slice(1).map((m) => {
    const p = monthPeriod(m);
    const r = computeFinancialComparison({
      ...base, metric: "net", mode: "CUSTOM_PERIOD",
      current_period: p, comparison_period: monthPeriod(previousMonth(m)),
    });
    return { month: m, value: r.current.value, delta: r.delta_abs };
  });
  const streak = monthlyNets.filter((m) => m.delta > 0).length;
  if (streak >= 3) {
    highlights.push({
      id: `perf-stability-${input.as_of}`,
      type: "financial_stability_improvement",
      domain: "stability",
      subject: null,
      title_fact: "Resultado melhorou em três períodos seguidos",
      current_value: monthlyNets[0].value,
      previous_value: monthlyNets[monthlyNets.length - 1].value,
      delta_abs: round2(monthlyNets[0].value - monthlyNets[monthlyNets.length - 1].value),
      delta_pct: null,
      direction: "up",
      interpretation: "Seu resultado melhorou pelo terceiro período consecutivo — isso já é tendência, não sorte. ✨",
      drivers: [],
      structural_or_timing: "behavioral",
      materiality: Math.abs(round2(monthlyNets[0].value - monthlyNets[monthlyNets.length - 1].value)),
      confidence: "medium",
      comparability: "medium",
      sentiment: "positive",
      actionable: false,
      recommended_action: null,
      methodology: "Comparei o resultado de cada mês fechado com o mês imediatamente anterior nos últimos três meses.",
      evidence: {
        current_period: monthPeriod(monthlyNets[0].month),
        previous_period: monthPeriod(monthlyNets[monthlyNets.length - 1].month),
        observed_change: round2(monthlyNets[0].value - monthlyNets[monthlyNets.length - 1].value),
        normalized_change: round2(monthlyNets[0].value - monthlyNets[monthlyNets.length - 1].value),
        formula_version: FINANCIAL_PERFORMANCE_VERSION,
      },
      logical_topic_key: "performance:stability:streak",
      valid_until: validUntil(input.as_of),
    });
  }

  const ranked = highlights.sort((a, b) => {
    const conf = (h: FinancialPerformanceHighlight) =>
      h.confidence === "high" ? 3 : h.confidence === "medium" ? 2 : h.confidence === "low" ? 1 : 0;
    return (conf(b) * 1000 + b.materiality) - (conf(a) * 1000 + a.materiality);
  });

  const positive = ranked.find((h) => h.sentiment === "positive");
  const negative = ranked.find((h) => h.sentiment === "negative");
  const headline = negative && positive
    ? "Você melhorou em alguns pontos, mas ainda tem ponto de atenção neste recorte."
    : positive
      ? "Seu recorte atual está melhor que o período comparado."
      : negative
        ? "Seu recorte atual está pior que o período comparado."
        : "Seu período está estável em relação ao comparado.";

  return { highlights: ranked, comparisons, headline, formula_version: FINANCIAL_PERFORMANCE_VERSION };
}
