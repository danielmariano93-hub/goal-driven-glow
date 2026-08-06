// SIMULADOR "ANTES DE GASTAR" — spending_simulation.v1
// ====================================================
// Consome EXCLUSIVAMENTE o snapshot canônico (financial_snapshot_contract.v7).
// Não relê banco, não recalcula saldo, não inventa fórmula: qualquer número
// exibido aqui é idêntico ao da Home.
import { round2, todayISO, type CategoryRow } from "./facts";
import { cycleFor, type CardCycleConfig } from "./cardExposure";
import type { FinancialSnapshot } from "./metrics";

export const SPENDING_SIMULATION_VERSION = "spending_simulation.v2";

export type SimulationVerdict = "safe" | "attention" | "risky" | "unaffordable";

export interface SpendingSimulationInput {
  snapshot: FinancialSnapshot;
  amount: number;
  /** parcelas (1 = à vista) */
  installments?: number;
  /** "cash" debita agora; "card" entra na próxima fatura. */
  method?: "cash" | "card";
  categoryId?: string | null;
  categories?: CategoryRow[];
  /** data prevista da compra (padrão: hoje) */
  plannedDate?: string | null;
  /** cartão escolhido, quando `method === "card"` — define o ciclo e o vencimento */
  card?: CardCycleConfig | null;
}

export interface SpendingSimulationResult {
  formulaVersion: string;
  amount: number;
  installments: number;
  installmentAmount: number;
  method: "cash" | "card";
  verdict: SimulationVerdict;
  headline: string;
  /** Disponível hoje segundo o snapshot. */
  availableToday: number;
  availableAfterNow: number;
  /** Projeção de fechamento antes e depois da compra. */
  projectedEndBalance: number;
  projectedEndBalanceAfter: number;
  /** Livre após compromissos conhecidos, antes e depois. */
  freeAfterCommitments: number;
  freeAfterCommitmentsAfter: number;
  /** Dias de ritmo típico que a compra consome. */
  daysOfTypicalPace: number | null;
  /** data prevista da compra (impacto na categoria acontece aqui) */
  plannedDate: string;
  /** data em que o dinheiro realmente sai da conta */
  cashImpactDate: string;
  /** true quando a saída de caixa cai dentro da competência projetada */
  cashImpactWithinMonth: boolean;
  /** competência da fatura afetada, quando a compra é no cartão */
  cardCompetence: string | null;
  /** Impacto na meta de categoria vinculada, quando houver. */
  categoryGoalImpact: {
    categoryName: string;
    limit: number;
    spent: number;
    remainingBefore: number;
    remainingAfter: number;
    exceeds: boolean;
  } | null;
  goalsAtRisk: { id: string; name: string; remaining: number }[];
  commitments: { name: string; amount: number; date: string; estimated: boolean }[];
  assumptions: string[];
  limitations: string[];
}

export function simulateSpending(input: SpendingSimulationInput): SpendingSimulationResult {
  const snap = input.snapshot;
  const amount = round2(Math.max(0, Number(input.amount) || 0));
  const installments = Math.max(1, Math.floor(Number(input.installments) || 1));
  const method: "cash" | "card" = input.method ?? "cash";
  const installmentAmount = round2(amount / installments);
  const todayIso = todayISO();
  const plannedDate = (input.plannedDate ?? todayIso).slice(0, 10);
  const monthEnd = snap.projection.monthEnd;

  // Caixa: débito/PIX/dinheiro sai na data prevista; cartão sai no vencimento da
  // fatura do ciclo em que a compra cai (nunca na data da compra).
  const cycle = method === "card" && input.card ? cycleFor(input.card, plannedDate) : null;
  const cashImpactDate = method === "card" ? cycle?.due_date ?? plannedDate : plannedDate;
  const cashImpactWithinMonth = cashImpactDate <= monthEnd;
  const cardCompetence = cycle?.competence ?? null;

  // Impacto imediato no caixa: à vista debita agora; no cartão, só a 1ª parcela
  // pesa dentro do mês (via fatura) e o restante fica como compromisso futuro.
  // Só reduz o "disponível hoje" o que sai HOJE de conta própria.
  const immediate = method === "cash" && plannedDate <= todayIso ? amount : 0;
  // Impacto na competência: à vista quando a data prevista cai no mês; no cartão,
  // a parcela do ciclo, e somente se o vencimento cair dentro do mês projetado.
  const monthImpact = method === "cash"
    ? (plannedDate <= monthEnd ? amount : 0)
    : (cashImpactWithinMonth ? installmentAmount : 0);

  const availableToday = snap.availableToday;
  const availableAfterNow = round2(availableToday - immediate);
  const projectedEndBalance = snap.projection.projectedEndBalance;
  const projectedEndBalanceAfter = round2(projectedEndBalance - monthImpact);
  const freeAfterCommitments = snap.projection.freeAfterKnownCommitments;
  const freeAfterCommitmentsAfter = round2(freeAfterCommitments - monthImpact);

  const typicalPace = snap.projection.typicalDailyPace;
  const daysOfTypicalPace = typicalPace > 0 ? round2(amount / typicalPace) : null;

  let verdict: SimulationVerdict;
  if (amount === 0) verdict = "safe";
  else if (availableAfterNow < 0 || projectedEndBalanceAfter < 0) verdict = "unaffordable";
  else if (freeAfterCommitmentsAfter < 0) verdict = "risky";
  else if (projectedEndBalanceAfter < Math.max(50, projectedEndBalance * 0.1)) verdict = "attention";
  else verdict = "safe";

  const headline = {
    safe: "Cabe no seu mês",
    attention: "Cabe, mas aperta o fim do mês",
    risky: "Compromete o que já tem data",
    unaffordable: "Não cabe sem furar o mês",
  }[verdict];

  // Meta de categoria vinculada
  let categoryGoalImpact: SpendingSimulationResult["categoryGoalImpact"] = null;
  if (input.categoryId) {
    const goal = snap.activeCategoryGoals.find((g) => g.goal.category_id === input.categoryId);
    if (goal) {
      const remainingBefore = round2(goal.targetAmount - goal.actualSpend);
      const remainingAfter = round2(remainingBefore - monthImpact);
      categoryGoalImpact = {
        categoryName: goal.categoryName
          ?? input.categories?.find((c) => c.id === input.categoryId)?.name
          ?? "Categoria",
        limit: goal.targetAmount,
        spent: goal.actualSpend,
        remainingBefore,
        remainingAfter,
        exceeds: remainingAfter < 0,
      };
    }
  }

  const goalsAtRisk = snap.goalProgress
    .filter((g) => g.remaining > 0 && freeAfterCommitmentsAfter < g.remaining * 0.1)
    .map((g) => ({ id: g.id, name: g.name, remaining: g.remaining }));

  const commitments = snap.commitmentAgenda.items
    .filter((item) => item.type === "expense")
    .slice(0, 5)
    .map((item) => ({ name: item.name, amount: item.amount, date: item.date, estimated: item.estimated }));

  const assumptions: string[] = [
    `Disponível hoje e projeção vêm do motor canônico (${snap.contractVersion}).`,
    `Compromissos com data considerados: ${snap.commitmentAgenda.items.length} nos próximos 30 dias.`,
    method === "card"
      ? `No cartão, a compra entra na fatura${cardCompetence ? ` de ${cardCompetence}` : ""} e o dinheiro sai em ${cashImpactDate}.`
      : `À vista, o valor sai do saldo em ${cashImpactDate}.`,
    `Impacto na meta de categoria acontece na data da compra (${plannedDate}).`,
  ];
  if (snap.projection.estimatedFixedInflows > 0) {
    assumptions.push("A renda fixa futura estimada está incluída apenas na projeção, nunca no saldo real.");
  }

  const limitations: string[] = [];
  if (snap.audit.completeness !== "complete") {
    limitations.push("Algumas fontes de dados não foram carregadas — o resultado pode mudar após atualizar.");
  }
  if (snap.projection.confidence === "insufficient") {
    limitations.push("Ainda há poucos dias observados no mês: a projeção tem baixa precisão.");
  }
  if (snap.cardDebtIsEstimated) {
    limitations.push("Parte da fatura de cartão é estimada por não haver fatura oficial importada.");
  }
  if (snap.commitmentAgenda.hasEstimates) {
    limitations.push("Alguns compromissos são previstos por recorrência e podem variar.");
  }
  if (method === "card" && !input.card) {
    limitations.push("Sem o cartão escolhido, usamos a data da compra como referência de vencimento.");
  }
  if (!cashImpactWithinMonth) {
    limitations.push("A saída de caixa desta compra cai depois do fim do mês projetado.");
  }

  return {
    formulaVersion: SPENDING_SIMULATION_VERSION,
    amount,
    installments,
    installmentAmount,
    method,
    verdict,
    headline,
    availableToday,
    availableAfterNow,
    projectedEndBalance,
    projectedEndBalanceAfter,
    freeAfterCommitments,
    freeAfterCommitmentsAfter,
    daysOfTypicalPace,
    plannedDate,
    cashImpactDate,
    cashImpactWithinMonth,
    cardCompetence,
    categoryGoalImpact,
    goalsAtRisk,
    commitments,
    assumptions,
    limitations,
  };
}
