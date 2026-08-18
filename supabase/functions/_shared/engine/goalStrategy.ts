/**
 * Motor determinístico de estratégia de meta (goal_strategy.v1).
 *
 * Traduz uma meta em plano executável: quanto por mês, quanto por semana,
 * de onde tirar o dinheiro e qual é o próximo passo. Nada aqui é estimado por
 * IA — todo número sai dos dados do cliente.
 *
 * Base conceitual (usada como método, não como citação decorativa):
 * - Metas específicas, mensuráveis e com prazo elevam execução (Locke e Latham).
 * - Pagar-se primeiro: o aporte sai antes do consumo, no dia da entrada.
 * - Automação e atrito reduzido aumentam adesão (arquitetura de escolha).
 * - Limite por categoria (envelope) transforma corte difuso em corte concreto.
 * - Passos curtos e visíveis sustentam constância (metas de aproximação).
 */

export type GoalStrategyInput = {
  goalName: string;
  targetAmount: number;
  achievedAmount: number;
  /** ISO date (YYYY-MM-DD) ou null quando a meta não tem prazo. */
  targetDate: string | null;
  /** Data de referência do cálculo (YYYY-MM-DD). */
  today: string;
  /** Renda mensal confirmada mais recente. */
  monthlyIncome: number;
  /** Sobra mensal observada (entradas − saídas) no mês corrente ou média. */
  monthlySurplus: number;
  /** Média mensal já aportada nesta meta nos últimos meses. */
  currentMonthlyPace: number;
  /** Dia do mês em que a entrada principal costuma cair (1-31), quando conhecido. */
  incomeDayOfMonth?: number | null;
  /** Categorias com gasto acima da própria linha de base, já calculadas. */
  overspendCategories?: Array<{ name: string; monthlyAvg: number; baseline: number }>;
};

export type GoalStrategyStep = {
  id: string;
  title: string;
  detail: string;
  /** Valor mensal associado ao passo, quando existe. */
  amount: number | null;
  method: string;
};

export type GoalStrategy = {
  formula_version: "goal_strategy.v1";
  goalName: string;
  remaining: number;
  monthsLeft: number | null;
  requiredMonthly: number | null;
  requiredWeekly: number | null;
  currentMonthlyPace: number;
  monthlyGap: number | null;
  /** Quanto da sobra observada a meta consome. */
  surplusUsePct: number | null;
  feasibility: "on_track" | "tight" | "unfeasible" | "no_deadline" | "completed";
  headline: string;
  steps: GoalStrategyStep[];
  /** Saídas honestas quando o prazo não fecha com a realidade atual. */
  alternatives: Array<{ label: string; detail: string }>;
  fundingSources: Array<{ name: string; monthlyAmount: number; detail: string }>;
  nextAction: string;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const dayAdjust = b.getDate() >= a.getDate() ? 0 : -1;
  return months + dayAdjust;
}

/** Plano de ataque da meta. Determinístico: mesma entrada, mesma saída. */
export function buildGoalStrategy(input: GoalStrategyInput): GoalStrategy {
  const target = Math.max(0, Number(input.targetAmount || 0));
  const achieved = Math.max(0, Number(input.achievedAmount || 0));
  const remaining = round2(Math.max(0, target - achieved));
  const pace = round2(Math.max(0, Number(input.currentMonthlyPace || 0)));
  const surplus = round2(Number(input.monthlySurplus || 0));
  const income = round2(Math.max(0, Number(input.monthlyIncome || 0)));

  const monthsLeft = input.targetDate
    ? Math.max(0, monthsBetween(input.today, input.targetDate) + 1)
    : null;
  const requiredMonthly = monthsLeft && monthsLeft > 0 ? round2(remaining / monthsLeft) : null;
  const requiredWeekly = requiredMonthly != null ? round2(requiredMonthly / 4.3) : null;
  const monthlyGap = requiredMonthly != null ? round2(Math.max(0, requiredMonthly - pace)) : null;
  const surplusUsePct = requiredMonthly != null && surplus > 0
    ? round2(Math.min(999, (requiredMonthly / surplus) * 100))
    : null;

  const feasibility: GoalStrategy["feasibility"] = remaining <= 0
    ? "completed"
    : requiredMonthly == null
    ? "no_deadline"
    : surplus > 0 && requiredMonthly <= surplus * 0.6
    ? "on_track"
    : surplus > 0 && requiredMonthly <= surplus
    ? "tight"
    : "unfeasible";

  const overspend = (input.overspendCategories ?? [])
    .map((item) => ({
      name: item.name,
      excess: round2(Math.max(0, Number(item.monthlyAvg || 0) - Number(item.baseline || 0))),
    }))
    .filter((item) => item.excess >= 20)
    .sort((a, b) => b.excess - a.excess)
    .slice(0, 3);

  const fundingSources: GoalStrategy["fundingSources"] = [];
  if (pace > 0) {
    fundingSources.push({
      name: "Ritmo que você já mantém",
      monthlyAmount: pace,
      detail: `Você já vem guardando cerca de ${brl(pace)} por mês nesta meta.`,
    });
  }
  const availableFromSurplus = round2(Math.max(0, surplus - pace));
  if (availableFromSurplus > 0) {
    fundingSources.push({
      name: "Sobra do mês ainda livre",
      monthlyAmount: availableFromSurplus,
      detail: `Depois do que você já guarda, sobram ${brl(availableFromSurplus)} por mês nas suas contas.`,
    });
  }
  for (const item of overspend) {
    fundingSources.push({
      name: `Ajuste em ${item.name}`,
      monthlyAmount: item.excess,
      detail: `${item.name} está ${brl(item.excess)} por mês acima da sua própria média. Voltar ao seu padrão libera esse valor.`,
    });
  }

  const steps: GoalStrategyStep[] = [];
  if (requiredMonthly != null && requiredMonthly > 0) {
    steps.push({
      id: "monthly_target",
      title: `Reserve ${brl(requiredMonthly)} por mês`,
      detail: monthsLeft
        ? `Faltam ${brl(remaining)} e ${monthsLeft} ${monthsLeft === 1 ? "mês" : "meses"} até o prazo. Esse é o valor que fecha a conta.`
        : `Faltam ${brl(remaining)} para chegar ao alvo.`,
      amount: requiredMonthly,
      method: "meta específica com prazo",
    });
    steps.push({
      id: "pay_yourself_first",
      title: input.incomeDayOfMonth
        ? `Separe no dia ${input.incomeDayOfMonth}, junto com a entrada`
        : "Separe no dia em que o dinheiro entra",
      detail: "O aporte sai antes do consumo. O que fica na conta corrente tende a virar gasto.",
      amount: requiredMonthly,
      method: "pagar-se primeiro",
    });
  }
  if (requiredWeekly != null && requiredWeekly > 0) {
    steps.push({
      id: "weekly_step",
      title: `Acompanhe ${brl(requiredWeekly)} por semana`,
      detail: "Passo curto é mais fácil de sustentar do que uma cobrança única no fim do mês.",
      amount: requiredWeekly,
      method: "passos curtos e visíveis",
    });
  }
  if (overspend.length > 0) {
    const first = overspend[0];
    steps.push({
      id: "category_envelope",
      title: `Coloque limite em ${first.name}`,
      detail: `Trazer ${first.name} de volta ao seu padrão libera ${brl(first.excess)} por mês para a meta. Posso criar esse limite com você.`,
      amount: first.excess,
      method: "limite por categoria (envelope)",
    });
  }
  if (monthlyGap != null && monthlyGap > 0) {
    steps.push({
      id: "close_gap",
      title: `Cubra a diferença de ${brl(monthlyGap)} por mês`,
      detail: fundingSources.length > 1
        ? `Somando ${fundingSources.slice(1).map((s) => s.name.toLowerCase()).join(" e ")}, essa diferença tem de onde sair.`
        : "Hoje não vejo essa diferença sobrando nas suas contas — vale ajustar prazo ou alvo.",
      amount: monthlyGap,
      method: "fechamento de lacuna",
    });
  }

  const alternatives: GoalStrategy["alternatives"] = [];
  if (feasibility === "unfeasible" || feasibility === "tight") {
    const capacity = round2(Math.max(0, surplus > 0 ? surplus * 0.6 : pace));
    if (capacity > 0) {
      const monthsNeeded = Math.ceil(remaining / capacity);
      alternatives.push({
        label: "Manter o alvo e esticar o prazo",
        detail: `Guardando ${brl(capacity)} por mês, que cabe na sua realidade atual, você chega ao alvo em cerca de ${monthsNeeded} ${monthsNeeded === 1 ? "mês" : "meses"}.`,
      });
      if (monthsLeft && monthsLeft > 0) {
        const reachable = round2(achieved + capacity * monthsLeft);
        alternatives.push({
          label: "Manter o prazo e ajustar o alvo",
          detail: `No prazo atual, o alvo realista é ${brl(reachable)} em vez de ${brl(target)}.`,
        });
      }
    }
    if (income > 0 && requiredMonthly != null) {
      alternatives.push({
        label: "Aumentar a entrada",
        detail: `A meta pede ${round2((requiredMonthly / income) * 100)}% da sua renda mensal. Acima de um terço, o plano costuma quebrar no meio.`,
      });
    }
  }

  const headline = feasibility === "completed"
    ? `${input.goalName}: alvo alcançado.`
    : feasibility === "no_deadline"
    ? `${input.goalName}: faltam ${brl(remaining)}. Definir um prazo é o que transforma isso em plano.`
    : feasibility === "on_track"
    ? `${input.goalName}: ${brl(requiredMonthly ?? 0)} por mês cabem na sua sobra atual.`
    : feasibility === "tight"
    ? `${input.goalName}: ${brl(requiredMonthly ?? 0)} por mês consomem quase toda a sua sobra.`
    : `${input.goalName}: no ritmo e na sobra de hoje, o prazo não fecha.`;

  const nextAction = feasibility === "completed"
    ? "Quer definir a próxima meta?"
    : feasibility === "no_deadline"
    ? "Escolha uma data para o alvo e eu monto o plano mês a mês."
    : monthlyGap != null && monthlyGap > 0 && overspend.length > 0
    ? `Comece por ${overspend[0].name}: é onde está o dinheiro mais fácil de recuperar este mês.`
    : requiredMonthly != null
    ? `Agende ${brl(requiredMonthly)} para sair no dia da entrada e o resto acompanha.`
    : "Registre um aporte para começar o histórico da meta.";

  return {
    formula_version: "goal_strategy.v1",
    goalName: input.goalName,
    remaining,
    monthsLeft,
    requiredMonthly,
    requiredWeekly,
    currentMonthlyPace: pace,
    monthlyGap,
    surplusUsePct,
    feasibility,
    headline,
    steps,
    alternatives,
    fundingSources,
    nextAction,
  };
}
