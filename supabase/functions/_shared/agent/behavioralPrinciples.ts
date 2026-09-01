// nino_change_agent.v1
// Princípios comportamentais usados como MOLDURA de intervenção.
// Nunca calculam dinheiro e nunca substituem os motores financeiros canônicos.

export type BehavioralPrincipleKey =
  | "pay_yourself_first"
  | "margin_of_safety"
  | "intentional_spending"
  | "opportunity_cost"
  | "friction_and_nudge"
  | "long_term_consistency"
  | "reduce_financial_pressure"
  | "protect_progress"
  | "identity_reinforcement";

export type BehavioralPrinciple = {
  key: BehavioralPrincipleKey;
  label: string;
  intent: string;
  do: string;
  dont: string;
};

export const BEHAVIORAL_PRINCIPLES: Record<BehavioralPrincipleKey, BehavioralPrinciple> = {
  pay_yourself_first: {
    key: "pay_yourself_first",
    label: "Pague-se primeiro",
    intent: "Transformar capacidade financeira em ação antes que a folga se dissolva no consumo.",
    do: "Sugerir reservar a capacidade já calculada para meta ou patrimônio.",
    dont: "Inventar um percentual universal da renda.",
  },
  margin_of_safety: {
    key: "margin_of_safety",
    label: "Margem de segurança",
    intent: "Preservar fôlego antes de acelerar patrimônio.",
    do: "Priorizar verdade financeira e caixa quando há incerteza ou projeção negativa.",
    dont: "Recomendar aporte quando a base financeira está insegura.",
  },
  intentional_spending: {
    key: "intentional_spending",
    label: "Gasto intencional",
    intent: "Trocar corte genérico por decisão coerente com prioridade e contexto.",
    do: "Mostrar trade-off e impacto sobre metas quando houver evidência.",
    dont: "Moralizar categorias ou tratar todo gasto flexível como ruim.",
  },
  opportunity_cost: {
    key: "opportunity_cost",
    label: "Custo de oportunidade",
    intent: "Traduzir uma decisão atual no que ela acelera ou atrasa.",
    do: "Conectar decisão a meta, caixa ou patrimônio usando números canônicos.",
    dont: "Criar simulação de rentabilidade sem premissa explícita.",
  },
  friction_and_nudge: {
    key: "friction_and_nudge",
    label: "Fricção e nudge",
    intent: "Intervir quando uma decisão ainda pode ser alterada, sem insistência excessiva.",
    do: "Preferir lembrete acionável e contextual.",
    dont: "Mandar sermão retrospectivo ou repetir a mesma abordagem ignorada.",
  },
  long_term_consistency: {
    key: "long_term_consistency",
    label: "Consistência de longo prazo",
    intent: "Valorizar repetição sustentável acima de uma ação heroica pontual.",
    do: "Reforçar ritmo que cabe na vida real do usuário.",
    dont: "Premiar sacrifício insustentável ou prometer enriquecimento rápido.",
  },
  reduce_financial_pressure: {
    key: "reduce_financial_pressure",
    label: "Reduzir pressão financeira",
    intent: "Liberar capacidade quando compromissos consomem a própria folga.",
    do: "Priorizar dívida apenas quando a pressão é evidenciada pelos dados.",
    dont: "Assumir que toda dívida deve ser quitada antes de qualquer outra ação.",
  },
  protect_progress: {
    key: "protect_progress",
    label: "Proteja o progresso",
    intent: "Não mexer no plano só para produzir uma recomendação nova.",
    do: "Reconhecer quando manter o que funciona é a melhor ação.",
    dont: "Criar intervenção sem materialidade.",
  },
  identity_reinforcement: {
    key: "identity_reinforcement",
    label: "Reforço de identidade",
    intent: "Transformar avanço observado em evidência de capacidade, sem motivação vazia.",
    do: "Reforçar comportamento comprovado: 'você conseguiu repetir X'.",
    dont: "Usar culpa, vergonha, infantilização ou elogio sem evidência.",
  },
};

export function principlesForStage(stage: string): BehavioralPrincipleKey[] {
  switch (stage) {
    case "repair_truth":
    case "stabilize_cash":
      return ["margin_of_safety"];
    case "reduce_debt_pressure":
      return ["reduce_financial_pressure", "margin_of_safety"];
    case "fund_goal":
      return ["pay_yourself_first", "opportunity_cost", "long_term_consistency"];
    case "build_wealth":
      return ["pay_yourself_first", "long_term_consistency"];
    default:
      return ["protect_progress", "identity_reinforcement"];
  }
}
