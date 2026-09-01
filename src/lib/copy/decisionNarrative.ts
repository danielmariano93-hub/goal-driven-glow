/**
 * nino_decision_narrative.v1 — camada editorial canônica do Nino.
 *
 * Transforma fatos JÁ calculados (situação principal do diagnóstico +
 * recomendação canônica do motor de mudança) em UMA narrativa: situação →
 * significado → decisão → ação.
 *
 * Regras invioláveis desta camada:
 *  - não calcula, não arredonda e não deriva dinheiro; só escolhe e escreve;
 *  - nunca expõe confidence, stage, truth gate, priority score, versão de
 *    fórmula, "capacidade sustentável" ou "desejo da meta";
 *  - o mesmo valor não aparece em contexto + destaque + CTA;
 *  - Home, tela do Nino, proatividade e WhatsApp derivam daqui — mudam de
 *    tamanho, nunca de conclusão.
 */

export type NinoDecisionTone = "risk" | "attention" | "opportunity" | "progress";

export type NinoDecisionSituation = {
  id?: string | null;
  situation_type?: string | null;
  situation_key?: string | null;
  severity?: string | null;
  headline?: string | null;
  one_line_summary?: string | null;
  cause_summary?: string | null;
  consequence_summary?: string | null;
};

export type NinoDecisionStep = {
  id: string;
  stage?: string | null;
  title?: string | null;
  detail?: string | null;
  route?: string | null;
  amount?: number | null;
  amountRole?: string | null;
  requiredAmount?: number | null;
  goalId?: string | null;
  goalName?: string | null;
};

export type NinoDecisionAmount = { value: number; caption: string };

export type NinoDecisionCta =
  | { kind: "accept"; label: string; route: string | null }
  | { kind: "link"; label: string; route: string };

export type NinoDecisionCompactCopy = {
  /** Headline curta de Home: <= 65 caracteres, conclusão em uma linha. */
  headline: string;
  /** Evidência mínima: uma frase, <= 140 caracteres, sem repetir o valor destacado. */
  body: string | null;
};

export type NinoDecisionNarrative = {
  eyebrow: string;
  headline: string;
  context: string | null;
  diagnosis: string | null;
  recommendation: string | null;
  primaryAmount: NinoDecisionAmount | null;
  secondaryAmount: NinoDecisionAmount | null;
  primaryCta: NinoDecisionCta | null;
  secondaryCta: NinoDecisionCta | null;
  tone: NinoDecisionTone;
  /** true quando diagnóstico e próximo passo são a MESMA decisão (um card só). */
  sameDecision: boolean;
  sourceRefs: string[];
  /** Variante da Home: conclusão + evidência mínima, nunca o texto detalhado. */
  compact: NinoDecisionCompactCopy;
  variants: {
    home: string[];
    nino_detail: string[];
    whatsapp: string;
    proactive: string;
  };
};


const BANNED = [
  /capacidade sustent[áa]vel/i,
  /desejo da meta/i,
  /truth gate/i,
  /confidence/i,
  /priority[_ ]score/i,
  /formula[_ ]version/i,
  /\bstage\b/i,
  /sobra m[ée]dia comporta/i,
  /limitado pela sua/i,
];

/** Texto vindo de motor só chega ao usuário se não carregar jargão técnico. */
export function isHumanText(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return !BANNED.some((pattern) => pattern.test(text));
}

function clean(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function humanOrNull(value: string | null | undefined): string | null {
  const text = clean(value);
  return text && isHumanText(text) ? text : null;
}

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function safeRoute(route: string | null | undefined): string | null {
  const value = String(route ?? "").trim();
  if (!value.startsWith("/app/") || value.startsWith("//")) return null;
  return value;
}

const STAGE_SUBJECT: Record<string, RegExp> = {
  fund_goal: /goal|meta/i,
  stabilize_cash: /cash|caixa|balance|saldo|projection|fechamento/i,
  reduce_debt_pressure: /debt|d[íi]vida|installment|parcela|card|cart[ãa]o|invoice|fatura/i,
  repair_truth: /reconcil|diverg|data_quality|bridge|ponte/i,
  build_wealth: /wealth|patrim|invest|surplus|folga|saving/i,
};

/** Mesma decisão: mesmo objeto canônico (meta/caixa/dívida) nos dois motores. */
export function isSameDecision(situation: NinoDecisionSituation | null | undefined, step: NinoDecisionStep | null | undefined): boolean {
  if (!situation || !step) return false;
  const stage = String(step.stage ?? "");
  const haystack = `${situation.situation_type ?? ""} ${situation.situation_key ?? ""} ${situation.headline ?? ""} ${situation.one_line_summary ?? ""}`;
  const goal = clean(step.goalName);
  if (goal && haystack.toLocaleLowerCase("pt-BR").includes(goal.toLocaleLowerCase("pt-BR"))) return true;
  const pattern = STAGE_SUBJECT[stage];
  return pattern ? pattern.test(haystack) : false;
}

type StageCopy = {
  headline: string;
  context: string | null;
  recommendation: string | null;
  amountCaption: string;
  tone: NinoDecisionTone;
  primary: NinoDecisionCta;
  secondary: NinoDecisionCta | null;
  compact: NinoDecisionCompactCopy;
};

/** Valor compacto de headline/evidência da Home (R$ 1.943). Nunca em recibo. */
function brlCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function stageCopy(step: NinoDecisionStep, situation: NinoDecisionSituation | null): StageCopy {
  const stage = String(step.stage ?? "");
  const amount = positive(step.amount);
  const required = positive(step.requiredAmount);
  const goal = clean(step.goalName);
  const route = safeRoute(step.route);

  if (stage === "fund_goal") {
    const named = goal ? `A meta “${goal}”` : "Sua meta";
    const behind = Boolean(required && amount && required > amount);
    const headline = behind
      ? `${named} pede um ritmo maior do que cabe hoje`
      : `Avance ${goal ? `a meta “${goal}”` : "sua meta"} no ritmo que cabe hoje`;
    const context = behind
      ? `Para chegar no prazo atual seriam necessários ${brl(required!)} por mês. Pelo seu histórico, o ritmo que cabe hoje é menor — e é dele que eu parto.`
      : amount
        ? "Pelo seu histórico, esse é o ritmo que cabe hoje sem apertar seu mês."
        : humanOrNull(step.detail);
    return {
      headline,
      context,
      recommendation: amount
        ? "Meu conselho: comece nesse ritmo neste mês. Eu acompanho e depois ajustamos o ritmo ou o prazo conforme sua evolução."
        : "Meu conselho: revise o prazo da meta antes de aumentar o aporte.",
      amountCaption: "por mês",
      tone: "attention",
      primary: amount
        ? { kind: "accept", label: "Seguir esse plano", route }
        : { kind: "link", label: "Ajustar meta", route: route ?? "/app/metas" },
      secondary: amount ? { kind: "link", label: "Ajustar meta", route: route ?? "/app/metas" } : null,
      compact: {
        headline: behind ? "Sua meta precisa de um ritmo mais realista" : "Sua meta cabe no seu ritmo de hoje",
        body: behind
          ? `O prazo atual pediria ${brlCompact(required!)} por mês.`
          : amount
            ? "É o ritmo que seu histórico sustenta hoje."
            : null,
      },
    };
  }

  if (stage === "repair_truth") {
    return {
      headline: "Antes de decidir, preciso corrigir uma divergência",
      context: "Há um número que não fecha entre seus registros e seus saldos. Não vou te recomendar corte nem aporte com base nele.",
      recommendation: "Meu conselho: vamos acertar isso primeiro. Depois eu volto com o próximo passo.",
      amountCaption: "",
      tone: "risk",
      primary: { kind: "link", label: "Resolver isso", route: safeRoute(step.route) ?? "/app/alertas" },
      secondary: null,
      compact: {
        headline: "Tem um número que não fecha",
        body: "Vou corrigir isso antes de recomendar corte ou aporte.",
      },
    };
  }

  if (stage === "stabilize_cash") {
    const shortfall = positive(step.amount);
    return {
      headline: "Seu mês fecha apertado se nada mudar",
      context: shortfall
        ? `Do jeito que está, falta esse valor para fechar o mês sem aperto.`
        : "Seu disponível de hoje está negativo, então proteger o caixa vem antes de qualquer aporte.",
      recommendation: "Meu conselho: vamos cobrir essa folga antes de acelerar qualquer outra coisa. Eu acompanho com você.",
      amountCaption: "para cobrir",
      tone: "risk",
      primary: { kind: "accept", label: "Seguir esse plano", route },
      secondary: { kind: "link", label: "Ver planejamento", route: route ?? "/app/planejamento" },
      compact: {
        headline: "Seu mês fecha apertado se nada mudar",
        body: shortfall ? "É o que falta para fechar sem aperto." : "Proteger o caixa vem antes de qualquer aporte.",
      },
    };
  }

  if (stage === "reduce_debt_pressure") {
    return {
      headline: "Suas parcelas estão consumindo sua folga",
      context: "Hoje o compromisso mensal com parcelas ocupa quase toda a folga que sobra do mês.",
      recommendation: "Meu conselho: vamos aliviar essa pressão antes de aumentar aportes. Eu acompanho a evolução.",
      amountCaption: "por mês em parcelas",
      tone: "attention",
      primary: { kind: "accept", label: "Seguir esse plano", route },
      secondary: { kind: "link", label: "Ver dívidas", route: route ?? "/app/dividas" },
      compact: {
        headline: "Suas parcelas estão consumindo sua folga",
        body: "É quase tudo o que sobra no seu mês.",
      },
    };
  }

  if (stage === "build_wealth") {
    return {
      headline: "Dá para transformar sua folga em patrimônio",
      context: "Pelo seu histórico, sobra um valor todos os meses que hoje não vira nada.",
      recommendation: "Meu conselho: comece com um aporte planejado nesse ritmo. Eu acompanho e te aviso se o cenário mudar.",
      amountCaption: "por mês",
      tone: "opportunity",
      primary: { kind: "accept", label: "Seguir esse plano", route },
      secondary: { kind: "link", label: "Ver investimentos", route: route ?? "/app/investimentos" },
      compact: {
        headline: "Sua folga pode virar patrimônio",
        body: "Sobra esse valor todo mês e hoje ele não rende nada.",
      },
    };
  }

  const fallbackHeadline = humanOrNull(step.title) ?? clean(situation?.one_line_summary) ?? "Seu plano está funcionando";
  return {
    headline: fallbackHeadline,
    context: humanOrNull(step.detail),
    recommendation: null,
    amountCaption: "",
    tone: "progress",
    primary: { kind: "link", label: "Ver meu relatório", route: safeRoute(step.route) ?? "/app/relatorios" },
    secondary: null,
    compact: { headline: fallbackHeadline, body: humanOrNull(step.detail) },
  };
}


function situationOnly(
  situation: NinoDecisionSituation,
  action: { title?: string | null; route?: string | null } | null,
): NinoDecisionNarrative {
  const headline = clean(situation.one_line_summary) ?? clean(situation.headline) ?? "Tenho uma leitura para você";
  const context = humanOrNull(situation.cause_summary) ?? humanOrNull(situation.consequence_summary);
  const severity = String(situation.severity ?? "");
  const tone: NinoDecisionTone = severity === "critical"
    ? "risk"
    : severity === "attention"
      ? "attention"
      : severity === "positive"
        ? "progress"
        : "opportunity";
  const route = safeRoute(action?.route);
  const label = clean(action?.title);
  const primaryCta: NinoDecisionCta | null = route && label ? { kind: "link", label, route } : null;
  const lines = [headline, context].filter((line): line is string => Boolean(line));
  return {
    eyebrow: "Orientação do Nino",
    headline,
    context,
    diagnosis: humanOrNull(situation.consequence_summary),
    recommendation: null,
    primaryAmount: null,
    secondaryAmount: null,
    primaryCta,
    secondaryCta: null,
    tone,
    sameDecision: false,
    sourceRefs: ["nino_diagnosis"],
    compact: { headline, body: context },
    variants: {

      home: lines,
      nino_detail: lines,
      whatsapp: lines.join(" "),
      proactive: headline,
    },
  };
}

export function composeNinoDecisionNarrative(input: {
  situation?: NinoDecisionSituation | null;
  action?: { title?: string | null; route?: string | null } | null;
  nextStep?: NinoDecisionStep | null;
}): NinoDecisionNarrative | null {
  const situation = input.situation ?? null;
  const step = input.nextStep ?? null;

  if (!step) return situation ? situationOnly(situation, input.action ?? null) : null;

  const copy = stageCopy(step, situation);
  const amount = positive(step.amount);
  const required = positive(step.requiredAmount);
  const sameDecision = isSameDecision(situation, step);

  const primaryAmount = amount ? { value: amount, caption: copy.amountCaption } : null;
  const secondaryAmount = required && amount && required > amount
    ? { value: required, caption: "necessário para cumprir o prazo" }
    : null;

  const homeLines = [copy.headline, copy.context, copy.recommendation].filter((line): line is string => Boolean(line));
  const amountLine = primaryAmount
    ? `${brl(primaryAmount.value)}${primaryAmount.caption ? ` ${primaryAmount.caption}` : ""}`
    : null;
  const whatsappLines = [
    copy.headline + ".",
    copy.context,
    amountLine ? `Ritmo que cabe hoje: ${amountLine}.` : null,
    copy.primary.kind === "accept" ? "Quer seguir esse plano?" : null,
  ].filter((line): line is string => Boolean(line));

  return {
    eyebrow: "Orientação do Nino",
    headline: copy.headline,
    context: copy.context,
    diagnosis: sameDecision ? clean(situation?.one_line_summary) ?? clean(situation?.headline) ?? null : null,
    recommendation: copy.recommendation,
    primaryAmount,
    secondaryAmount,
    primaryCta: copy.primary,
    secondaryCta: copy.secondary,
    tone: copy.tone,
    sameDecision,
    sourceRefs: sameDecision ? ["nino_diagnosis", "nino_change_recommendation"] : ["nino_change_recommendation"],
    variants: {
      home: homeLines,
      nino_detail: [...homeLines, ...(secondaryAmount ? [`Necessário para o prazo atual: ${brl(secondaryAmount.value)} por mês.`] : [])],
      whatsapp: whatsappLines.join("\n"),
      proactive: [copy.headline + ".", copy.recommendation].filter(Boolean).join(" "),
    },
  };
}

/** Microcopy humana do acompanhamento (nunca "Compromisso criado."). */
export const NINO_COMMITMENT_COPY = {
  accepted: "Combinado. Vou acompanhar esse passo com você e te aviso se o cenário mudar.",
  progress: "Você avançou no que combinamos.",
  stalled: "Ainda não houve avanço. Em vez de repetir o mesmo pedido, vamos ajustar o caminho.",
  completed: "Você fez o que combinou. Agora posso recalcular seu próximo passo.",
  dismissed: "Sem problema. Guardei essa leitura e sigo acompanhando.",
} as const;
