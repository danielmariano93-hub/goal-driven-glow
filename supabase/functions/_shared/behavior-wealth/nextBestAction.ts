// nino_behavior_wealth.v1
// ============================================================================
// Camada determinística que transforma "dados financeiros organizados" em uma
// decisão: qual é o próximo passo mais útil para mudar comportamento e construir
// patrimônio.
//
// Regras:
// - dinheiro é calculado apenas pelos motores canônicos existentes;
// - divergência/reconciliação bloqueia recomendação patrimonial;
// - hipótese comportamental pending nunca é tratada como fato;
// - risco de caixa vem antes de crescimento patrimonial;
// - dívida só bloqueia patrimônio quando a própria parcela pressiona a folga;
// - nenhuma ação movimenta dinheiro: é recomendação + rota, sempre auditável.

type SupabaseClient = any;

import { computeAgentSnapshot } from "../engine/metrics.ts";
import { computeGoalStrategy } from "../agent/goalStrategyTool.ts";
import { analyze_wealth_opportunity } from "../agent/engineTools.ts";

export const NINO_BEHAVIOR_WEALTH_VERSION = "nino_behavior_wealth.v1";

export type BehaviorWealthStage =
  | "repair_truth"
  | "stabilize_cash"
  | "reduce_debt_pressure"
  | "fund_goal"
  | "build_wealth"
  | "protect_progress";

export type StageInput = {
  truth_blocked: boolean;
  available_today: number;
  projected_month_end_available: number;
  monthly_income: number;
  monthly_debt_installments: number;
  has_active_goal: boolean;
  sustainable_monthly_saving: number;
};

export type NextBestAction = {
  version: string;
  as_of: string;
  stage: BehaviorWealthStage;
  stage_reason: string;
  confidence: number;
  truth_gate: {
    blocked: boolean;
    cash_bridge_confidence: string;
    reconciliation_issues: number;
  };
  behavior_context: Array<{
    kind: string;
    title: string;
    confidence: number;
    status: "confirmed" | "partial";
  }>;
  financial_state: {
    available_today: number;
    projected_month_end_available: number;
    monthly_income: number;
    net_worth: number;
    debt_balance: number;
    monthly_debt_installments: number;
    sustainable_monthly_saving: number;
  };
  action: {
    title: string;
    detail: string;
    route: string;
    amount: number | null;
    amount_role: "shortfall" | "monthly_commitment" | "monthly_capacity" | null;
    goal_id: string | null;
    goal_name: string | null;
  };
  evidence: {
    snapshot_formula_version: string;
    reconciliation_id: string;
    wealth_engine: string | null;
    goal_strategy_version: string | null;
    assumptions: string[];
  };
  answer_format: {
    version: "nino_answer_format.v1";
    headline: string;
    must_include: string[];
    must_not_include: string[];
  };
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.abs(round2(value)));
}

function confidenceFromWealth(label: unknown): number {
  switch (String(label ?? "").toLowerCase()) {
    case "high": return 0.92;
    case "medium": return 0.8;
    case "low": return 0.65;
    default: return 0.72;
  }
}

/**
 * Regra pura e testável de estágio.
 *
 * Não usa percentuais externos de "saúde financeira". A pressão de dívida é
 * relativa à própria folga projetada do usuário: se a parcela mensal já consome
 * a folga que restaria, patrimônio não é a prioridade desta rodada.
 */
export function selectBehaviorWealthStage(input: StageInput): {
  stage: BehaviorWealthStage;
  reason: string;
} {
  if (input.truth_blocked) {
    return {
      stage: "repair_truth",
      reason: "financial_truth_blocked",
    };
  }

  if (input.available_today < 0 || input.projected_month_end_available < 0) {
    return {
      stage: "stabilize_cash",
      reason: "cash_projection_negative",
    };
  }

  const ownHeadroom = Math.max(0, input.projected_month_end_available);
  if (input.monthly_debt_installments > 0 && input.monthly_debt_installments >= ownHeadroom) {
    return {
      stage: "reduce_debt_pressure",
      reason: "debt_installments_consume_projected_headroom",
    };
  }

  if (input.has_active_goal) {
    return {
      stage: "fund_goal",
      reason: "active_goal_with_stable_cash",
    };
  }

  if (input.sustainable_monthly_saving > 0) {
    return {
      stage: "build_wealth",
      reason: "sustainable_capacity_detected",
    };
  }

  return {
    stage: "protect_progress",
    reason: "no_safe_incremental_action",
  };
}

export async function computeNextBestAction(
  sb: SupabaseClient,
  userId: string,
  opts: { months?: number } = {},
): Promise<NextBestAction> {
  const months = Math.max(3, Math.min(36, Number(opts.months ?? 12)));

  const [snapshot, goalStrategy, behaviorResp, reconciliationResp, wealthResp] =
    await Promise.all([
      computeAgentSnapshot(sb, userId),
      computeGoalStrategy(sb, userId, {}),
      sb.from("behavior_hypotheses")
        .select("kind,title,confidence,status")
        .eq("user_id", userId)
        .in("status", ["confirmed", "partial"])
        .order("confidence", { ascending: false })
        .limit(5),
      sb.from("reconciliation_issues")
        .select("id,kind,severity")
        .eq("user_id", userId)
        .is("resolved_at", null)
        .limit(20),
      analyze_wealth_opportunity({ sb, user_id: userId }, { months }),
    ]);

  if (behaviorResp.error) {
    throw new Error(`behavior_context_query_failed:${behaviorResp.error.message}`);
  }
  if (reconciliationResp.error) {
    throw new Error(`reconciliation_issues_query_failed:${reconciliationResp.error.message}`);
  }

  const bridgeConfidence = String(
    (snapshot as any)?.cash_bridge?.confidence ?? "unknown",
  ).toLowerCase();
  const reconciliationIssues = ((reconciliationResp.data as any[]) ?? []).length;
  const truthBlocked =
    reconciliationIssues > 0 || bridgeConfidence === "low" || bridgeConfidence === "unknown";

  const activeDebts = ((snapshot as any)?.active_debts ?? []) as any[];
  const debtBalance = round2(activeDebts.reduce(
    (sum, debt) => sum + num(debt.outstanding_balance),
    0,
  ));
  const monthlyDebtInstallments = round2(activeDebts.reduce(
    (sum, debt) => sum + num(debt.installment_amount),
    0,
  ));

  const goalPlan = goalStrategy.plans?.[0] ?? null;
  const wealth: any = wealthResp.ok ? wealthResp.result : null;
  const wealthFacts = wealth?.facts ?? {};
  const sustainable = round2(num(wealthFacts.sustainable_monthly_saving));
  const monthlyIncome = round2(Math.max(
    num((snapshot as any)?.current_month_income),
    num((snapshot as any)?.estimated_fixed_income) + num((snapshot as any)?.confirmed_future_income),
  ));

  const stage = selectBehaviorWealthStage({
    truth_blocked: truthBlocked,
    available_today: num((snapshot as any)?.available_today),
    projected_month_end_available: num((snapshot as any)?.projected_month_end_available),
    monthly_income: monthlyIncome,
    monthly_debt_installments: monthlyDebtInstallments,
    has_active_goal: Boolean(goalPlan),
    sustainable_monthly_saving: sustainable,
  });

  const behaviorContext = ((behaviorResp.data as any[]) ?? []).map((row) => ({
    kind: String(row.kind ?? "behavior"),
    title: String(row.title ?? "Padrão confirmado"),
    confidence: Math.max(0, Math.min(1, num(row.confidence))),
    status: String(row.status) === "confirmed" ? "confirmed" as const : "partial" as const,
  }));

  const available = round2(num((snapshot as any)?.available_today));
  const projected = round2(num((snapshot as any)?.projected_month_end_available));
  const netWorth = round2(num((snapshot as any)?.net_worth));

  let action: NextBestAction["action"];
  let headline: string;

  switch (stage.stage) {
    case "repair_truth": {
      action = {
        title: "Resolver as divergências antes de decidir",
        detail:
          "Há sinal de conciliação pendente ou confiança insuficiente na ponte de caixa. O Nino não vai transformar um número duvidoso em recomendação de patrimônio.",
        route: "/app/alertas",
        amount: null,
        amount_role: null,
        goal_id: null,
        goal_name: null,
      };
      headline =
        "Meu próximo passo é corrigir a verdade financeira primeiro. Enquanto houver divergência relevante, eu não vou te recomendar corte, aporte ou mudança de meta com base em um número inseguro.";
      break;
    }

    case "stabilize_cash": {
      const shortfall = Math.abs(Math.min(0, projected));
      action = {
        title: "Proteger o caixa antes de acelerar patrimônio",
        detail:
          shortfall > 0
            ? `A projeção aponta um buraco de ${brl(shortfall)} no fechamento. Primeiro precisamos neutralizar essa pressão.`
            : "O disponível de hoje está negativo. Primeiro precisamos recuperar folga de caixa.",
        route: "/app/planejamento",
        amount: shortfall > 0 ? shortfall : Math.abs(Math.min(0, available)),
        amount_role: "shortfall",
        goal_id: null,
        goal_name: null,
      };
      headline = `${action.title}. ${action.detail}`;
      break;
    }

    case "reduce_debt_pressure": {
      action = {
        title: "Reduzir a pressão mensal das dívidas",
        detail:
          `As parcelas ativas somam ${brl(monthlyDebtInstallments)} por mês e hoje consomem a folga projetada. Antes de aumentar aportes, vale revisar essa pressão.`,
        route: "/app/dividas",
        amount: monthlyDebtInstallments,
        amount_role: "monthly_commitment",
        goal_id: null,
        goal_name: null,
      };
      headline = `${action.title}. ${action.detail}`;
      break;
    }

    case "fund_goal": {
      const required = num((goalPlan as any)?.requiredMonthly);
      const safeAmount = sustainable > 0 && required > 0
        ? Math.min(sustainable, required)
        : sustainable > 0
          ? sustainable
          : null;
      action = {
        title: `Transformar folga em avanço da meta${goalPlan?.goalName ? ` "${goalPlan.goalName}"` : ""}`,
        detail:
          safeAmount && safeAmount > 0
            ? `Seu histórico sustenta até ${brl(safeAmount)} por mês neste momento. O valor é limitado pela sua capacidade sustentável, não pelo desejo da meta.`
            : String(goalPlan?.nextAction ?? "Revise o plano da meta e o prazo antes de aumentar o aporte."),
        route: "/app/metas",
        amount: safeAmount && safeAmount > 0 ? round2(safeAmount) : null,
        amount_role: safeAmount && safeAmount > 0 ? "monthly_capacity" : null,
        goal_id: String((goalPlan as any)?.goalId ?? "") || null,
        goal_name: goalPlan?.goalName ?? null,
      };
      headline = `${action.title}. ${action.detail}`;
      break;
    }

    case "build_wealth": {
      action = {
        title: "Transformar capacidade de poupança em patrimônio",
        detail:
          `Pelo seu próprio histórico, há ${brl(sustainable)} por mês de capacidade sustentável. O próximo passo é transformar essa folga em um aporte planejado, sem comprometer o caixa.`,
        route: "/app/investimentos",
        amount: sustainable,
        amount_role: "monthly_capacity",
        goal_id: null,
        goal_name: null,
      };
      headline = `${action.title}. ${action.detail}`;
      break;
    }

    default: {
      action = {
        title: "Proteger o que já está funcionando",
        detail:
          "Não encontrei hoje uma ação incremental com evidência suficiente para justificar mexer no seu plano. Continue registrando e eu mudo a orientação quando os dados mudarem.",
        route: "/app/relatorios",
        amount: null,
        amount_role: null,
        goal_id: null,
        goal_name: null,
      };
      headline = `${action.title}. ${action.detail}`;
    }
  }

  const confidence = truthBlocked
    ? 0.98
    : wealthResp.ok
      ? confidenceFromWealth((wealth as any)?.confidence)
      : 0.72;

  return {
    version: NINO_BEHAVIOR_WEALTH_VERSION,
    as_of: String((snapshot as any)?.today ?? new Date().toISOString().slice(0, 10)),
    stage: stage.stage,
    stage_reason: stage.reason,
    confidence,
    truth_gate: {
      blocked: truthBlocked,
      cash_bridge_confidence: bridgeConfidence,
      reconciliation_issues: reconciliationIssues,
    },
    behavior_context: behaviorContext,
    financial_state: {
      available_today: available,
      projected_month_end_available: projected,
      monthly_income: monthlyIncome,
      net_worth: netWorth,
      debt_balance: debtBalance,
      monthly_debt_installments: monthlyDebtInstallments,
      sustainable_monthly_saving: sustainable,
    },
    action,
    evidence: {
      snapshot_formula_version: String((snapshot as any)?.formula_version ?? "unknown"),
      reconciliation_id: String((snapshot as any)?.reconciliation_id ?? ""),
      wealth_engine: wealthResp.ok ? String((wealth as any)?.engine ?? "wealth_opportunity.v1") : null,
      goal_strategy_version: goalPlan ? "goal_strategy.v1" : null,
      assumptions: [
        "nenhuma hipótese comportamental pending entra como fato",
        "reconciliação pendente bloqueia recomendação patrimonial",
        "caixa negativo vem antes de crescimento patrimonial",
        "dívida só ganha prioridade quando suas parcelas consomem a própria folga projetada",
        "capacidade de poupança vem do wealth_opportunity.v1 e da baseline pessoal",
        "o Nino recomenda; não movimenta dinheiro automaticamente",
      ],
    },
    answer_format: {
      version: "nino_answer_format.v1",
      headline,
      must_include: [
        "próximo passo",
        "por que esta ação vem antes das demais",
        "valor somente quando calculado por motor canônico",
      ],
      must_not_include: [
        "produto de investimento específico sem pedido explícito",
        "rentabilidade inventada",
        "hipótese comportamental não confirmada como fato",
        "ação financeira automática sem confirmação",
      ],
    },
  };
}
