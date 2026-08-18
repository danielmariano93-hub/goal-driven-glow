/**
 * Motor determinístico de estratégia de meta por categoria
 * (`category_goal_strategy.v2`).
 *
 * v2 corrige três erros conceituais da v1:
 * 1. excesso ATUAL e excesso PROJETADO deixam de ser tratados como a mesma
 *    coisa — nunca mais "mantém o excesso em R$ 0,00";
 * 2. R$/dia e "corte R$ X/dia" só aparecem quando a categoria tem comportamento
 *    de fluxo contínuo (a política vem de `category_projection.v1`);
 * 3. revisar o teto para cima exige evidência estrutural — meta de redução não
 *    é "consertada" aumentando o teto até o gasto.
 *
 * Nada aqui é estimado por IA: todo número entra pronto de
 * `evaluateCategoryGoal`, da projeção decomposta e do ledger confirmado.
 */

import type { CategoryGoalEvaluation } from "./metrics";
import type {
  CategoryProjectionConfidence,
  CategoryProjectionMethod,
  ExpectedCommitment,
} from "./categoryProjection";

export type CategoryGoalOutlook =
  | "scheduled"
  | "under_control"
  | "tight"
  | "projected_over"
  | "exceeded"
  | "closed_ok"
  | "closed_over"
  | "paused";

/** Estado real da meta — base de TODA copy. */
export type CategoryGoalState =
  | "scheduled"
  | "paused"
  | "under_budget"
  | "on_track"
  | "under_budget_but_at_risk"
  | "over_budget"
  | "low_confidence"
  | "closed_ok"
  | "closed_over";

export type CategoryGoalHotspot = {
  /** Estabelecimento canônico (nunca a descrição bruta do banco). */
  label: string;
  amount: number;
  /** Participação no gasto total da categoria no período (0..100). */
  sharePct: number;
  count: number;
  /** Faz parte de uma série recorrente conhecida. */
  recurring?: boolean;
};

export type CategoryGoalStrategyStep = {
  id: string;
  title: string;
  detail: string;
  amount: number | null;
  method: string;
};

export type CategoryGoalScenario = {
  id: string;
  label: string;
  detail: string;
  /** Fechamento projetado neste cenário, quando aplicável. */
  projectedTotal: number | null;
  /** Economia/efeito do cenário, quando aplicável. */
  effect: number | null;
};

export type CategoryGoalStrategy = {
  formula_version: "category_goal_strategy.v2";
  categoryName: string;
  outlook: CategoryGoalOutlook;
  state: CategoryGoalState;
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
  /** Quanto por dia precisa cair no ritmo atual (0 quando R$/dia não se aplica). */
  requiredDailyCut: number;
  /** R$/dia é conceito válido nesta categoria? */
  allowsDailyBudget: boolean;
  projectionMethod: CategoryProjectionMethod | "linear" | "weekday_weighted";
  projectionConfidence: CategoryProjectionConfidence;
  projectionComponents: {
    confirmedSpend: number;
    remainingKnownCommitments: number;
    variableProjection: number;
    projectedTotal: number;
  };
  expectedCommitments: ExpectedCommitment[];
  hotspots: CategoryGoalHotspot[];
  /** Resto da categoria fora do top de hotspots. Nunca negativo. */
  others: { amount: number; sharePct: number };
  /** Cobertura do ranking sobre o total da categoria (0..100). */
  coveragePct: number;
  steps: CategoryGoalStrategyStep[];
  alternatives: Array<{ label: string; detail: string; amount?: number | null }>;
  scenarios: CategoryGoalScenario[];
  nextAction: string;
};

export type CategoryGoalStrategyInput = {
  evaluation: CategoryGoalEvaluation;
  /** Maiores gastos da categoria no período, já agregados por merchant canônico. */
  hotspots?: CategoryGoalHotspot[];
  others?: { amount: number; sharePct: number };
  categoryTotal?: number;
  /** Recorrências que caem nesta categoria e já foram cobradas no período. */
  recurringInPeriod?: Array<{ label: string; amount: number }>;
  /** Evidência estrutural para decidir se cabe propor revisão do teto. */
  structuralEvidence?: {
    /** Ciclos anteriores consecutivos fechados acima do teto. */
    consecutiveCyclesOver?: number;
    /** Compromissos fixos conhecidos já superam o teto. */
    fixedCommitmentsExceedLimit?: boolean;
  };
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

function resolveState(ev: CategoryGoalEvaluation, outlook: CategoryGoalOutlook): CategoryGoalState {
  if (outlook === "paused") return "paused";
  if (outlook === "scheduled") return "scheduled";
  if (outlook === "closed_ok") return "closed_ok";
  if (outlook === "closed_over") return "closed_over";
  if (ev.currentOverage > 0) return "over_budget";
  if (ev.projectionMethod === "insufficient_data" || ev.projectionConfidence === "low") {
    return ev.projectedOverage > 0 ? "low_confidence" : "under_budget";
  }
  if (ev.projectedOverage > 0) return "under_budget_but_at_risk";
  return ev.remainingAmount > 0 ? "on_track" : "under_budget";
}

/** A meta tem intenção explícita de mudar comportamento (reduzir gasto)? */
function isReductionGoal(ev: CategoryGoalEvaluation): boolean {
  return String(ev.goal.mode ?? "") === "percent_reduction";
}

/**
 * Revisar o teto para CIMA só é honesto com evidência estrutural. Sem isso,
 * aumentar o teto até o gasto anula a função da meta.
 */
function ceilingReviewJustified(
  ev: CategoryGoalEvaluation,
  evidence: CategoryGoalStrategyInput["structuralEvidence"],
): boolean {
  const cycles = evidence?.consecutiveCyclesOver ?? 0;
  if (evidence?.fixedCommitmentsExceedLimit) return true;
  if (cycles >= 3) return true;
  // Teto incompatível com os compromissos já conhecidos do próprio período.
  if (ev.remainingKnownCommitments > 0 && ev.actualSpend + ev.remainingKnownCommitments > ev.targetAmount) {
    return !isReductionGoal(ev) && cycles >= 2;
  }
  return false;
}

/** Plano de ataque do teto de categoria. Determinístico: mesma entrada, mesma saída. */
export function buildCategoryGoalStrategy(input: CategoryGoalStrategyInput): CategoryGoalStrategy {
  const ev = input.evaluation;
  const name = ev.categoryName ?? "esta categoria";
  const limit = round2(ev.targetAmount);
  const spent = round2(ev.actualSpend);
  const remainingAmount = round2(Math.max(0, limit - spent));
  const remainingDays = Math.max(0, ev.remainingDays);
  const allowsDailyBudget = Boolean(ev.supportsDailyBudget);
  const dailyAllowance = allowsDailyBudget ? round2(ev.dailyAllowance) : 0;
  const weeklyAllowance = allowsDailyBudget
    ? round2(dailyAllowance * Math.min(7, Math.max(1, remainingDays)))
    : 0;
  const projectedFinalSpend = round2(ev.projectedFinalSpend);
  const projectedOverage = round2(ev.projectedOverage);
  const currentOverage = round2(ev.currentOverage);
  const requiredDailyCut = allowsDailyBudget ? round2(ev.requiredDailyReduction) : 0;
  const outlook = resolveOutlook(ev);
  const state = resolveState(ev, outlook);
  const expectedCommitments = ev.projection?.expectedCommitments ?? [];
  const expectedTotal = round2(ev.remainingKnownCommitments ?? 0);
  const projectionMethod = ev.projectionMethod;
  const projectionConfidence = ev.projectionConfidence ?? "low";

  const hotspots = (input.hotspots ?? [])
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4)
    .map((item) => ({ ...item, amount: round2(item.amount), sharePct: round2(item.sharePct) }));

  const categoryTotal = round2(input.categoryTotal ?? spent);
  const hotspotsSum = round2(hotspots.reduce((sum, item) => sum + item.amount, 0));
  const others = input.others
    ? { amount: round2(Math.max(0, input.others.amount)), sharePct: round2(Math.max(0, input.others.sharePct)) }
    : {
      amount: round2(Math.max(0, categoryTotal - hotspotsSum)),
      sharePct: categoryTotal > 0
        ? round2(Math.max(0, ((categoryTotal - hotspotsSum) / categoryTotal) * 100))
        : 0,
    };
  const coveragePct = categoryTotal > 0
    ? round2(Math.min(100, (hotspotsSum / categoryTotal) * 100))
    : 0;

  const recurring = (input.recurringInPeriod ?? []).filter((item) => item.amount > 0).slice(0, 3);
  const steps: CategoryGoalStrategyStep[] = [];

  if (state === "scheduled") {
    steps.push({
      id: "prepare_envelope",
      title: `Teto de ${brl(limit)} começa em ${fmtDay(ev.period.start)}`,
      detail: `Vale já decidir o que entra e o que não entra em ${name} quando o período abrir.`,
      amount: limit,
      method: "envelope por categoria",
    });
  } else if (state === "over_budget") {
    steps.push({
      id: "stop_bleeding",
      title: `Segure ${name} pelo resto do período`,
      detail: `O teto já foi ultrapassado em ${brl(currentOverage)}. Cada novo gasto aqui aumenta o excesso até ${fmtDay(ev.period.end)}.`,
      amount: currentOverage,
      method: "contenção de excesso",
    });
  } else if (allowsDailyBudget && remainingDays > 0 && dailyAllowance > 0) {
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
  } else if (!allowsDailyBudget && remainingAmount > 0) {
    // Categoria de compromisso: a decisão é sobre cobranças, não sobre R$/dia.
    steps.push({
      id: "margin_left",
      title: `Você ainda tem ${brl(remainingAmount)} de margem até o teto`,
      detail: expectedTotal > 0
        ? `Há ${brl(expectedTotal)} de cobranças recorrentes previstas até ${fmtDay(ev.period.end)}. Sem nada além disso, o período fecha em ${brl(projectedFinalSpend)}.`
        : `Sem novas cobranças até ${fmtDay(ev.period.end)}, o período fecha em ${brl(spent)}.`,
      amount: remainingAmount,
      method: "margem de compromisso",
    });
    const absorbable = round2(Math.max(0, remainingAmount - expectedTotal));
    steps.push({
      id: "absorbable_charges",
      title: absorbable > 0
        ? `Cabem no máximo ${brl(absorbable)} em novas cobranças`
        : "Não cabe nenhuma cobrança nova neste período",
      detail: absorbable > 0
        ? "Acima disso, o teto é furado mesmo sem mudar mais nada."
        : `As cobranças já previstas consomem toda a margem: seria necessário evitar ou reduzir ${brl(round2(expectedTotal - remainingAmount))}.`,
      amount: absorbable,
      method: "capacidade de absorção",
    });
  }

  if (requiredDailyCut > 0) {
    steps.push({
      id: "required_cut",
      title: `Corte ${brl(requiredDailyCut)} por dia do ritmo atual`,
      detail: `Hoje você gasta ${brl(ev.currentDailyRate)} por dia em ${name}. No ritmo atual, o período fecha em ${brl(projectedFinalSpend)}.`,
      amount: requiredDailyCut,
      method: "ajuste de ritmo",
    });
  } else if (!allowsDailyBudget && projectedOverage > 0) {
    steps.push({
      id: "required_charge_cut",
      title: `Evite ou reduza ${brl(projectedOverage)} das cobranças previstas`,
      detail: `Mantidas as cobranças conhecidas, o período fecha em ${brl(projectedFinalSpend)}, ${brl(projectedOverage)} acima do teto.`,
      amount: projectedOverage,
      method: "corte de compromisso",
    });
  }

  // "Comece por X": maior driver ACIONÁVEL — recorrente cancelável tem
  // prioridade sobre gasto isolado de mesmo peso.
  const actionable = [...hotspots].sort((a, b) => {
    const weight = (item: CategoryGoalHotspot) =>
      item.amount * (item.recurring ? 1.25 : 1) * (item.count > 1 ? 1.1 : 1);
    return weight(b) - weight(a);
  })[0];
  if (actionable) {
    steps.push({
      id: "attack_hotspot",
      title: `Comece por ${actionable.label}`,
      detail: `${actionable.label} responde por ${brl(actionable.amount)} (${Math.round(actionable.sharePct)}% da categoria no período) em ${actionable.count} ${actionable.count === 1 ? "lançamento" : "lançamentos"}${actionable.recurring ? ", e é cobrança recorrente — cortar aqui vale para todos os próximos períodos" : ""}.`,
      amount: actionable.amount,
      method: "contribuição marginal acionável",
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

  // ---------------- Cenários calculados (não frases genéricas) ----------------
  const scenarios: CategoryGoalScenario[] = [];
  const isOpen = state !== "scheduled" && state !== "paused" && state !== "closed_ok" && state !== "closed_over";

  if (isOpen) {
    scenarios.push({
      id: "no_new_charges",
      label: "Sem nenhum gasto novo",
      detail: currentOverage > 0
        ? `O teto já foi ultrapassado em ${brl(currentOverage)}; parar agora congela o excesso nesse valor.`
        : `Você fecha em ${brl(spent)}, ${brl(remainingAmount)} abaixo do teto.`,
      projectedTotal: spent,
      effect: currentOverage > 0 ? currentOverage : remainingAmount,
    });

    if (expectedTotal > 0) {
      const withCommitments = round2(spent + expectedTotal);
      scenarios.push({
        id: "known_commitments_only",
        label: "Mantendo só as cobranças já conhecidas",
        detail: `${expectedCommitments.map((item) => item.label).join(", ")} somam ${brl(expectedTotal)} e levam o fechamento a ${brl(withCommitments)}${withCommitments > limit ? `, ${brl(round2(withCommitments - limit))} acima do teto` : `, ainda dentro do teto`}.`,
        projectedTotal: withCommitments,
        effect: expectedTotal,
      });
    }

    if (actionable) {
      const saved = round2(Math.max(0, projectedFinalSpend - actionable.amount));
      scenarios.push({
        id: "cut_biggest_driver",
        label: `Cortando ${actionable.label}`,
        detail: `Sem ${actionable.label}, a projeção cai de ${brl(projectedFinalSpend)} para ${brl(saved)} — economia de ${brl(actionable.amount)}.`,
        projectedTotal: saved,
        effect: actionable.amount,
      });
    }

    if (ceilingReviewJustified(ev, input.structuralEvidence)) {
      const realistic = round2(Math.max(limit, projectedFinalSpend));
      scenarios.push({
        id: "review_ceiling",
        label: "Recalibrar o teto",
        detail: `Há evidência estrutural (ciclos consecutivos acima e compromissos fixos incompatíveis): um teto de ${brl(realistic)} descreveria melhor a sua realidade, para apertar a partir de uma base verdadeira.`,
        projectedTotal: realistic,
        effect: round2(realistic - limit),
      });
    } else if (projectedOverage > 0 || currentOverage > 0) {
      scenarios.push({
        id: "keep_ceiling",
        label: "Manter o teto como está",
        detail: isReductionGoal(ev)
          ? `Esta é uma meta de redução de ${Number(ev.goal.reduction_pct ?? 0)}%. Um ciclo acima não significa teto errado — aumentar o teto agora anularia a meta.`
          : "Um único período acima não é evidência de que o teto está errado; a leitura melhor é cortar os drivers acima.",
        projectedTotal: limit,
        effect: null,
      });
    }
  }

  const alternatives = scenarios.map((scenario) => ({
    label: scenario.label,
    detail: scenario.detail,
    amount: scenario.effect,
  }));

  const confidencePrefix = projectionConfidence === "low" ? "Com os dados disponíveis, a estimativa é que " : "";

  const headline = state === "paused"
    ? `${name}: meta pausada, sem acompanhamento no momento.`
    : state === "scheduled"
    ? `${name}: teto de ${brl(limit)} passa a valer em ${fmtDay(ev.period.start)}.`
    : state === "closed_ok"
    ? `${name}: período encerrado dentro do teto, em ${brl(spent)}.`
    : state === "closed_over"
    ? `${name}: período encerrado ${brl(currentOverage)} acima do teto.`
    : state === "over_budget"
    ? `${name}: o teto de ${brl(limit)} já foi ultrapassado em ${brl(currentOverage)}.`
    : state === "under_budget_but_at_risk" || state === "low_confidence"
    ? `${name}: você ainda está ${brl(remainingAmount)} dentro do teto, mas ${confidencePrefix}a projeção aponta ${brl(projectedOverage)} de excesso no fechamento.`
    : allowsDailyBudget && dailyAllowance > 0
    ? `${name}: dá para gastar ${brl(dailyAllowance)} por dia e ainda fechar dentro do teto.`
    : expectedTotal > 0
    ? `${name}: ${brl(remainingAmount)} de margem e ${brl(expectedTotal)} de cobranças previstas até ${fmtDay(ev.period.end)}.`
    : `${name}: ${brl(spent)} de ${brl(limit)} usados, com ${brl(remainingAmount)} de margem.`;

  const nextAction = state === "paused"
    ? "Reative a meta quando quiser voltar a acompanhar esta categoria."
    : state === "scheduled"
    ? "Nada a fazer agora: eu aviso quando o período abrir."
    : state === "closed_ok" || state === "closed_over"
    ? "Quer que eu proponha o teto do próximo período com base no seu gasto real?"
    : state === "over_budget"
    ? actionable
      ? `Segure ${name} até ${fmtDay(ev.period.end)} e revise ${actionable.label}, o maior driver do período.`
      : `Segure ${name} até ${fmtDay(ev.period.end)} para o excesso não crescer.`
    : projectedOverage > 0
    ? !allowsDailyBudget && expectedTotal > 0
      ? `Decida quais das cobranças previstas (${brl(expectedTotal)}) você mantém — é isso que decide se o teto fecha.`
      : actionable
        ? `Revise ${actionable.label}: é onde está o dinheiro mais fácil de recuperar neste período.`
        : `Reduza o ritmo desta categoria até ${fmtDay(ev.period.end)}.`
    : allowsDailyBudget && dailyAllowance > 0
    ? `Use ${brl(dailyAllowance)} por dia como referência até ${fmtDay(ev.period.end)}.`
    : remainingAmount > 0
    ? `Evite cobranças novas acima de ${brl(round2(Math.max(0, remainingAmount - expectedTotal)))} até ${fmtDay(ev.period.end)}.`
    : "Registre os gastos desta categoria para eu acompanhar o ritmo com você.";

  return {
    formula_version: "category_goal_strategy.v2",
    categoryName: name,
    outlook,
    state,
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
    allowsDailyBudget,
    projectionMethod,
    projectionConfidence,
    projectionComponents: ev.projection
      ? {
        confirmedSpend: ev.projection.components.confirmedSpend,
        remainingKnownCommitments: ev.projection.components.remainingKnownCommitments,
        variableProjection: ev.projection.components.variableProjection,
        projectedTotal: ev.projection.components.projectedTotal,
      }
      : {
        confirmedSpend: spent,
        remainingKnownCommitments: 0,
        variableProjection: round2(Math.max(0, projectedFinalSpend - spent)),
        projectedTotal: projectedFinalSpend,
      },
    expectedCommitments,
    hotspots,
    others,
    coveragePct,
    steps,
    alternatives,
    scenarios,
    nextAction,
  };
}
