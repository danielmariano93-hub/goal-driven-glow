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

// ---------------------------------------------------------------------------
// Princípio -> comportamento de produto.
// Determinístico: escolhe princípio, objetivo de comunicação e proibições.
// NÃO calcula dinheiro e NÃO produz frase pronta de livro.
// ---------------------------------------------------------------------------
export type BehavioralInterventionStrategy = "reinforce" | "remind" | "reframe" | "pause";

export type BehavioralIntervention = {
  principle: BehavioralPrincipleKey;
  strategy: BehavioralInterventionStrategy;
  communication_goal: string;
  prohibited_patterns: string[];
  context_for_llm: string;
};

const BASE_PROHIBITIONS = [
  "culpa, vergonha, moralização ou infantilização",
  "elogio sem evidência nos dados",
  "inventar valor, percentual ou projeção",
];

function goalFor(principle: BehavioralPrincipleKey, strategy: BehavioralInterventionStrategy): string {
  if (strategy === "pause") return "respeitar o pedido de pausa e deixar a porta aberta";
  if (strategy === "reframe") {
    return principle === "friction_and_nudge" || principle === "pay_yourself_first"
      ? "reduzir fricção e preservar consistência"
      : "trocar a abordagem sem repetir o mesmo pedido";
  }
  if (strategy === "remind") return "retomar o combinado com contexto, sem insistência";
  switch (principle) {
    case "margin_of_safety": return "proteger o caixa antes de crescer";
    case "reduce_financial_pressure": return "aliviar pressão de compromissos para liberar capacidade";
    case "identity_reinforcement": return "transformar avanço observado em evidência de capacidade";
    case "protect_progress": return "reconhecer que manter o que funciona é a melhor ação";
    default: return "reforçar o comportamento que os dados já comprovam";
  }
}

function prohibitionsFor(stage: string, principle: BehavioralPrincipleKey, strategy: BehavioralInterventionStrategy): string[] {
  const out = [...BASE_PROHIBITIONS, BEHAVIORAL_PRINCIPLES[principle].dont];
  if (stage === "repair_truth" || stage === "stabilize_cash") {
    out.push("sugerir aumento de aporte ou investimento");
    out.push("mensagem celebratória de patrimônio");
  }
  if (stage === "reduce_debt_pressure") out.push("assumir que toda dívida precisa ser quitada primeiro");
  if (strategy === "reframe") out.push("repetir o mesmo pedido que já foi ignorado");
  if (strategy === "pause") out.push("propor um novo compromisso agora");
  return [...new Set(out)];
}

export function resolveBehavioralIntervention(args: {
  stage: string;
  outcome?: string | null;
  strategy?: BehavioralInterventionStrategy;
  principles?: BehavioralPrincipleKey[];
  learningProfile?: {
    ignored_kinds?: string[];
    prefers_smaller_steps?: boolean;
    principle_success?: Record<string, { total: number; success: number }>;
  } | null;
  financialFacts?: Record<string, unknown> | null;
}): BehavioralIntervention {
  const candidates = (args.principles && args.principles.length > 0)
    ? args.principles
    : principlesForStage(args.stage);

  // Princípio que nunca funcionou para este usuário perde a vez para o próximo
  // da lista do estágio. Isso é sinal de estratégia, nunca de cálculo de valor.
  const stats = args.learningProfile?.principle_success ?? {};
  const ranked = [...candidates].sort((a, b) => {
    const sa = stats[a]; const sb2 = stats[b];
    const rate = (s?: { total: number; success: number }) =>
      s && s.total >= 2 ? s.success / s.total : 0.5;
    return rate(sb2) - rate(sa);
  });
  const principle = ranked[0] ?? "protect_progress";
  const strategy: BehavioralInterventionStrategy = args.strategy
    ?? (args.outcome === "completed" || args.outcome === "progress" ? "reinforce"
      : args.outcome === "regressed" ? "reframe" : "remind");

  const communication_goal = goalFor(principle, strategy);
  const prohibited_patterns = prohibitionsFor(args.stage, principle, strategy);
  const tone = strategy === "reframe"
    ? "direto, acolhedor, sem cobrança"
    : strategy === "reinforce"
      ? "direto, reconhecendo evidência"
      : "direto, não julgador";

  const context_for_llm = [
    `Principle: ${principle}`,
    `Intent: ${BEHAVIORAL_PRINCIPLES[principle].intent}`,
    `Goal: ${communication_goal}`,
    `Strategy: ${strategy}`,
    `Tone: ${tone}`,
    `Do: ${BEHAVIORAL_PRINCIPLES[principle].do}`,
    `Do not: ${prohibited_patterns.join("; ")}`,
    args.learningProfile?.prefers_smaller_steps
      ? "Sinal observado: este usuário conclui passos menores. Ajuste a linguagem e a fricção, nunca o valor — valor vem do motor canônico."
      : null,
  ].filter(Boolean).join("\n");

  return { principle, strategy, communication_goal, prohibited_patterns, context_for_llm };
}
