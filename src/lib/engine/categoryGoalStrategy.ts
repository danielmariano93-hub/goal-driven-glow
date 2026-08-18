/**
 * Motor determinístico de estratégia de meta por categoria (category_goal_strategy.v1).
 *
 * Irmão de `goal_strategy.v1`, mas para teto de gasto: traduz a avaliação da
 * meta em plano executável — quanto por dia e por semana ainda cabe, onde o
 * dinheiro está indo, qual corte específico é necessário e quais são as saídas
 * honestas quando o teto já foi furado. Nada aqui é estimado por IA: todo
 * número entra pronto de `evaluateCategoryGoal` e do ledger confirmado.
 *
 * Base conceitual (método, não citação decorativa):
 * - Envelope por categoria transforma corte difuso em corte concreto.
 * - Passo curto e visível (dia/semana) sustenta constância melhor que um teto mensal abstrato.
 * - Corte começa pelo maior ofensor: o dinheiro mais fácil de recuperar é o já concentrado.
 * - Quando a matemática não fecha, revisar o teto é honestidade, não fracasso.
 */

import type { CategoryGoalEvaluation } from "./metrics";

export type CategoryGoalOutlook =
  | "scheduled"
  | "under_control"
  | "tight"
  | "projected_over"
  | "exceeded"
  | "closed_ok"
  | "closed_over"
  | "paused";

export type CategoryGoalHotspot = {
  /** Estabelecimento ou descrição do gasto. */
  label: string;
  amount: number;
  /** Participação no gasto total da categoria no período (0..100). */
  sharePct: number;
  count: number;
};

export type CategoryGoalStrategyStep = {
  id: string;
  title: string;
  detail: string;
  amount: number | null;
  method: string;
};

export type CategoryGoalStrategy = {
  formula_version: "category_goal_strategy.v1";
  categoryName: string;
  outlook: CategoryGoalOutlook;
  headline: string;
  limit: number;
  spent: number;
  remainingAmount: number;
  projectedFinalSpend: number;
  projectedOverage: number;
  currentOverage: number;
  remainingDays: number;
  dailyAllowance: number;
  weeklyAllowance: number;
  /** Quanto por dia precisa cair no ritmo atual para o teto fechar. */
  requiredDailyCut: number;
  hotspots: CategoryGoalHotspot[];
  steps: CategoryGoalStrategyStep[];
  alternatives: Array<{ label: string; detail: string }>;
  nextAction: string;
};

export type CategoryGoalStrategyInput = {
  evaluation: CategoryGoalEvaluation;
  /** Maiores gastos da categoria no período, já agregados por estabelecimento. */
  hotspots?: CategoryGoalHotspot[];
  /** Recorrências que caem nesta categoria e continuam dentro do período. */
  recurringInPeriod?: Array<{ label: string; amount: number }>;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function resolveOutlook(ev: CategoryGoalEvaluation): CategoryGoalOutlook {
  switch (ev.status) {
    case "paused":
    case "cancelled":
      return "paused";
    case "scheduled":
      return "scheduled";
    case "exceeded":
    case "limit_reached":
      return "exceeded";
    case "completed_ok":
      return "closed_ok";
    case "completed_over":
      return "closed_over";
    case "at_risk":
      return "projected_over";
    case "attention":
      return ev.projectedOverage > 0 ? "projected_over" : "tight";
    default:
      return ev.projectedOverage > 0 ? "projected_over" : "under_control";
  }
}

/** Plano de ataque do teto de categoria. Determinístico: mesma entrada, mesma saída. */
export function buildCategoryGoalStrategy(input: CategoryGoalStrategyInput): CategoryGoalStrategy {
  const ev = input.evaluation;
  const name = ev.categoryName ?? "esta categoria";
  const limit = round2(ev.targetAmount);
  const spent = round2(ev.actualSpend);
  const remainingAmount = round2(Math.max(0, limit - spent));
  const remainingDays = Math.max(0, ev.remainingDays);
  const dailyAllowance = round2(ev.dailyAllowance);
  const weeklyAllowance = round2(dailyAllowance * Math.min(7, Math.max(1, remainingDays)));
  const projectedFinalSpend = round2(ev.projectedFinalSpend);
  const projectedOverage = round2(ev.projectedOverage);
  const currentOverage = round2(ev.currentOverage);
  const requiredDailyCut = round2(ev.requiredDailyReduction);
  const outlook = resolveOutlook(ev);

  const hotspots = (input.hotspots ?? [])
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4)
    .map((item) => ({ ...item, amount: round2(item.amount), sharePct: round2(item.sharePct) }));

  const recurring = (input.recurringInPeriod ?? []).filter((item) => item.amount > 0).slice(0, 3);

  const steps: CategoryGoalStrategyStep[] = [];

  if (outlook === "scheduled") {
    steps.push({
      id: "prepare_envelope",
      title: `Teto de ${brl(limit)} começa em ${fmtDay(ev.period.start)}`,
      detail: `Vale já decidir o que entra e o que não entra em ${name} quando o período abrir.`,
      amount: limit,
      method: "envelope por categoria",
    });
  } else if (currentOverage > 0) {
    steps.push({
      id: "stop_bleeding",
      title: `Segure ${name} pelo resto do período`,
      detail: `Você já passou ${brl(currentOverage)} do teto. Cada novo gasto aqui aumenta o excesso até ${fmtDay(ev.period.end)}.`,
      amount: currentOverage,
      method: "contenção de excesso",
    });
  } else if (remainingDays > 0 && dailyAllowance > 0) {
    steps.push({
      id: "daily_allowance",
      title: `Gaste até ${brl(dailyAllowance)} por dia`,
      detail: `Sobram ${brl(remainingAmount)} para ${remainingDays} ${remainingDays === 1 ? "dia" : "dias"} até ${fmtDay(ev.period.end)}.`,
      amount: dailyAllowance,
      method: "passo curto e visível",
    });
    if (weeklyAllowance > 0) {
      steps.push({
        id: "weekly_allowance",
        title: `Ou ${brl(weeklyAllowance)} para os próximos dias`,
        detail: "Olhar por semana evita a correria de última hora no fim do período.",
        amount: weeklyAllowance,
        method: "envelope semanal",
      });
    }
  }

  if (requiredDailyCut > 0) {
    steps.push({
      id: "required_cut",
      title: `Corte ${brl(requiredDailyCut)} por dia do ritmo atual`,
      detail: `Hoje você gasta ${brl(ev.currentDailyRate)} por dia em ${name}. No ritmo atual, o período fecha em ${brl(projectedFinalSpend)}.`,
      amount: requiredDailyCut,
      method: "ajuste de ritmo",
    });
  }

  if (hotspots.length > 0) {
    const first = hotspots[0];
    steps.push({
      id: "attack_hotspot",
      title: `Comece por ${first.label}`,
      detail: `${first.label} responde por ${brl(first.amount)} (${Math.round(first.sharePct)}% da categoria no período) em ${first.count} ${first.count === 1 ? "lançamento" : "lançamentos"}.`,
      amount: first.amount,
      method: "corte no maior ofensor",
    });
  }

  if (recurring.length > 0) {
    const total = round2(recurring.reduce((sum, item) => sum + item.amount, 0));
    steps.push({
      id: "review_recurring",
      title: "Revise o que é recorrente aqui",
      detail: `${recurring.map((item) => item.label).join(", ")} somam ${brl(total)} e voltam sozinhos. Cortar recorrente vale mais que cortar gasto isolado.`,
      amount: total,
      method: "revisão de recorrentes",
    });
  }

  const alternatives: Array<{ label: string; detail: string }> = [];
  if (currentOverage > 0 || projectedOverage > 0) {
    alternatives.push({
      label: "Segurar o resto do período",
      detail: remainingDays > 0
        ? `Zerar ${name} nos próximos ${remainingDays} ${remainingDays === 1 ? "dia" : "dias"} mantém o excesso em ${brl(Math.max(currentOverage, 0))}.`
        : "O período está fechando: o resultado já está praticamente definido.",
    });
    const realistic = round2(Math.max(limit, projectedFinalSpend));
    alternatives.push({
      label: "Revisar o teto para o próximo ciclo",
      detail: `Seu gasto real aponta para ${brl(realistic)}. Um teto de ${brl(realistic)} seria honesto e ainda daria para apertar aos poucos.`,
    });
    alternatives.push({
      label: "Compensar em outra categoria",
      detail: `Aceitar o excesso de ${brl(Math.max(currentOverage, projectedOverage))} aqui só fecha a conta se sair de outro lugar no mesmo mês.`,
    });
  }

  const headline = outlook === "paused"
    ? `${name}: meta pausada, sem acompanhamento no momento.`
    : outlook === "scheduled"
    ? `${name}: teto de ${brl(limit)} passa a valer em ${fmtDay(ev.period.start)}.`
    : outlook === "closed_ok"
    ? `${name}: período encerrado dentro do teto, em ${brl(spent)}.`
    : outlook === "closed_over"
    ? `${name}: período encerrado ${brl(currentOverage)} acima do teto.`
    : currentOverage > 0
    ? `${name}: você já passou ${brl(currentOverage)} do teto de ${brl(limit)}.`
    : projectedOverage > 0
    ? `${name}: no ritmo atual o período fecha em ${brl(projectedFinalSpend)}, ${brl(projectedOverage)} acima do teto.`
    : remainingDays > 0
    ? `${name}: dá para gastar ${brl(dailyAllowance)} por dia e ainda fechar dentro do teto.`
    : `${name}: ${brl(spent)} de ${brl(limit)} usados.`;

  const nextAction = outlook === "paused"
    ? "Reative a meta quando quiser voltar a acompanhar esta categoria."
    : outlook === "scheduled"
    ? "Nada a fazer agora: eu aviso quando o período abrir."
    : outlook === "closed_ok" || outlook === "closed_over"
    ? "Quer que eu proponha o teto do próximo período com base no seu gasto real?"
    : hotspots.length > 0 && (currentOverage > 0 || projectedOverage > 0)
    ? `Revise ${hotspots[0].label}: é onde está o dinheiro mais fácil de recuperar neste período.`
    : dailyAllowance > 0
    ? `Use ${brl(dailyAllowance)} por dia como referência até ${fmtDay(ev.period.end)}.`
    : "Registre os gastos desta categoria para eu acompanhar o ritmo com você.";

  return {
    formula_version: "category_goal_strategy.v1",
    categoryName: name,
    outlook,
    headline,
    limit,
    spent,
    remainingAmount,
    projectedFinalSpend,
    projectedOverage,
    currentOverage,
    remainingDays,
    dailyAllowance,
    weeklyAllowance,
    requiredDailyCut,
    hotspots,
    steps,
    alternatives,
    nextAction,
  };
}
