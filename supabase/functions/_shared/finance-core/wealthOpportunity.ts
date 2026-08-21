// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Wealth Opportunity (`wealth_opportunity.v1`).
// ============================================
// Responde "quanto eu poderia ter acumulado?" e "quanto consigo guardar por
// mês?" usando a BASELINE DO PRÓPRIO USUÁRIO (mediana robusta do consumo
// flexível), nunca uma régua externa e nunca "economia × 12".
//
// Princípios:
//  - Só consumo flexível entra como excesso recuperável — estrutura de vida
//    (moradia, saúde, dívida, educação, energia) nunca é "corte".
//  - Cenários são cenários: 25% / 50% / 70% do excesso recuperável.
//  - Patrimônio contrafactual é capitalizado mês a mês por aporte; rendimento
//    só existe quando explicitamente pedido.
//  - Nenhum julgamento moral: a saída é fato + estimativa + cenário.
import { round2 } from "./facts.ts";
import {
  confidenceFromSample,
  makeEnvelope,
  makeEvidence,
  medianOf,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope.ts";
import type { LongitudinalFacts, LongitudinalMonth } from "./longitudinal.ts";

export const WEALTH_OPPORTUNITY_VERSION = "wealth_opportunity.v1";

export interface WealthScenario {
  key: "conservador" | "realista" | "forte";
  label: string;
  /** Fatia do excesso recuperável considerada no cenário. */
  share: number;
  monthly_saving: number;
  total_saved: number;
  potential_net_worth: number;
  /** Aporte potencial mês a mês (mesma ordem dos meses fechados analisados). */
  monthly_contributions: number[];
}


export interface WealthSource {
  label: string;
  observed_monthly: number;
  baseline_monthly: number;
  recoverable_monthly: number;
}

export interface WealthOpportunityFacts {
  period: EnginePeriod;
  months_analyzed: number;
  /** Consumo flexível observado no período (total). */
  observed_spending: number;
  /** Consumo flexível esperado pela baseline pessoal (mediana × meses). */
  baseline_spending: number;
  /** Excesso acima da própria baseline — o que existia para recuperar. */
  recoverable_excess: number;
  /** Excesso médio por mês. */
  recoverable_monthly: number;
  actual_net_worth: number;
  scenarios: WealthScenario[];
  /** Diferença entre o cenário realista e o patrimônio atual. */
  opportunity_gap: number;
  /** Quanto o usuário consegue guardar por mês de forma sustentável. */
  sustainable_monthly_saving: number;
  assumptions: string[];
}

export interface WealthOpportunityInput {
  longitudinal: LongitudinalFacts;
  /** Patrimônio líquido atual (fonte canônica — nunca recalculado aqui). */
  actualNetWorth: number;
  period: EnginePeriod;
  /** Compromissos fixos mensais já conhecidos (dívidas, parcelas). */
  monthlyCommitments?: number;
  /** Rendimento anual em % — só quando o cenário pedir explicitamente. */
  annualYieldPct?: number;
  /** Fontes por categoria flexível (label + série mensal observada). */
  flexibleByCategory?: Array<{ label: string; monthly: number[] }>;
}

const SCENARIO_SHARES: Array<{ key: WealthScenario["key"]; label: string; share: number }> = [
  { key: "conservador", label: "Conservador", share: 0.25 },
  { key: "realista", label: "Realista", share: 0.5 },
  { key: "forte", label: "Forte", share: 0.7 },
];

/**
 * Contrafactual temporal real: cada mês tem o SEU excesso e cada aporte rende
 * apenas pelo tempo em que teria ficado investido. R$ 600 sobrando em janeiro
 * não valem o mesmo que R$ 600 sobrando em julho.
 */
function accumulateSeries(monthlyContributions: number[], annualYieldPct: number): number {
  const rate = annualYieldPct > 0 ? Math.pow(1 + annualYieldPct / 100, 1 / 12) - 1 : 0;
  let total = 0;
  for (const contribution of monthlyContributions) {
    total = total * (1 + rate) + Math.max(0, contribution);
  }
  return round2(total);
}

export function computeWealthOpportunity(
  input: WealthOpportunityInput,
): EngineEnvelope<WealthOpportunityFacts, LongitudinalMonth, WealthSource> {
  // Só meses FECHADOS: mês em curso não gera "excesso recuperável".
  const months = input.longitudinal.closed_months ?? input.longitudinal.months;
  const monthsAnalyzed = months.length;
  // Consumo flexível já normalizado (sem 13º/PLR/viagem) — baseline honesta.
  const flexSeries = months.map((m) => m.flexible_expense_normalized ?? m.flexible_expense);
  const baselineMonthly = round2(medianOf(flexSeries));
  const observed = round2(flexSeries.reduce((a, b) => a + b, 0));
  const baselineTotal = round2(baselineMonthly * monthsAnalyzed);
  // Só o que ficou ACIMA da própria mediana conta como excesso: meses abaixo da
  // baseline não geram "crédito" — isso evitaria prometer economia inexistente.
  const monthlyExcess = flexSeries.map((v) => round2(Math.max(0, v - baselineMonthly)));
  const recoverableExcess = round2(monthlyExcess.reduce((a, b) => a + b, 0));
  const recoverableMonthly = monthsAnalyzed > 0 ? round2(recoverableExcess / monthsAnalyzed) : 0;
  const yieldPct = input.annualYieldPct ?? 0;

  const scenarios: WealthScenario[] = SCENARIO_SHARES.map((s) => {
    const contributions = monthlyExcess.map((v) => round2(v * s.share));
    const total = accumulateSeries(contributions, yieldPct);
    const monthly = monthsAnalyzed > 0
      ? round2(contributions.reduce((a, b) => a + b, 0) / monthsAnalyzed)
      : 0;
    return {
      key: s.key,
      label: s.label,
      share: s.share,
      monthly_saving: monthly,
      total_saved: total,
      potential_net_worth: round2(input.actualNetWorth + total),
      monthly_contributions: contributions,
    };
  });

  // Capacidade sustentável: metade do excesso recuperável, limitada pela sobra
  // média real do período menos compromissos fixos conhecidos.
  const avgNet = monthsAnalyzed > 0
    ? round2(months.reduce((a, m) => a + m.net, 0) / monthsAnalyzed)
    : 0;
  const commitments = input.monthlyCommitments ?? 0;
  const headroom = round2(Math.max(0, avgNet - commitments));
  const sustainable = round2(Math.max(0, Math.min(round2(recoverableMonthly * 0.5), headroom)));

  const categorySources = input.flexibleByCategory ?? input.longitudinal.flexible_by_category ?? [];
  const sources: WealthSource[] = categorySources
    .map((c) => {
      const median = round2(medianOf(c.monthly));
      const observedMonthly = c.monthly.length
        ? round2(c.monthly.reduce((a, b) => a + b, 0) / c.monthly.length)
        : 0;
      return {
        label: c.label,
        observed_monthly: observedMonthly,
        baseline_monthly: median,
        recoverable_monthly: round2(
          c.monthly.reduce((acc, v) => acc + Math.max(0, v - median), 0) / Math.max(1, c.monthly.length),
        ),
      };
    })
    .filter((s) => s.recoverable_monthly > 0)
    .sort((a, b) => b.recoverable_monthly - a.recoverable_monthly)
    .slice(0, 5);


  const assumptions = [
    "baseline é a mediana do SEU próprio consumo flexível no período — não uma régua externa",
    "estrutura de vida (moradia, saúde, dívida, educação, contas de casa) não entra como corte",
    "cenários consideram 25%, 50% e 70% do excesso acima da baseline",
    "só meses fechados entram: o mês em curso não conta como economia",
    "valores atípicos (13º, PLR, férias, viagem) foram isolados da baseline",
    yieldPct > 0
      ? `rendimento explícito de ${yieldPct}% ao ano, com cada aporte rendendo só a partir do mês em que existiria`
      : "sem rendimento: apenas o dinheiro que teria ficado em caixa",
  ];
  if (input.longitudinal.result_driven_by_income) {
    assumptions.push("a melhora recente do resultado vem de renda maior, não de mudança de consumo");
  }


  const realistic = scenarios.find((s) => s.key === "realista")!;

  const facts: WealthOpportunityFacts = {
    period: input.period,
    months_analyzed: monthsAnalyzed,
    observed_spending: observed,
    baseline_spending: baselineTotal,
    recoverable_excess: recoverableExcess,
    recoverable_monthly: recoverableMonthly,
    actual_net_worth: round2(input.actualNetWorth),
    scenarios,
    opportunity_gap: round2(realistic.potential_net_worth - input.actualNetWorth),
    sustainable_monthly_saving: sustainable,
    assumptions,
  };

  return makeEnvelope<WealthOpportunityFacts, LongitudinalMonth, WealthSource>({
    engine: WEALTH_OPPORTUNITY_VERSION,
    facts,
    breakdown: months,
    drivers: sources,
    evidence: makeEvidence({
      period: input.period,
      sampleSize: monthsAnalyzed,
      formulaVersion: WEALTH_OPPORTUNITY_VERSION,
      notes: assumptions,
    }),
    confidence: confidenceFromSample(monthsAnalyzed, { minSample: 3, goodSample: 8 }),
  });
}
