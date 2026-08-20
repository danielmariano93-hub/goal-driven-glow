// advisor_learning.v1 — chaves canônicas de tópico do consultor.
//
// Um tópico é o ASSUNTO FINANCEIRO, não a pergunta. "quanto gastei no mercado",
// "e no mercado?" e o highlight de mercado compartilham a mesma chave, senão o
// aprendizado se espalha em chaves aleatórias e nunca converge.
//
// Função pura: nenhuma consulta, nenhum número.

export const ADVISOR_LEARNING_VERSION = "advisor_learning.v1";

export type AdvisorSignal =
  | "exposed"
  | "opened"
  | "followed_up"
  | "asked_more"
  | "acted"
  | "explicit_positive"
  | "ignored"
  | "dismissed"
  | "marked_not_useful";

/** Pesos espelhados 1:1 na RPC `advisor_register_topic_signal_v2`. */
export const ADVISOR_SIGNAL_WEIGHTS: Record<AdvisorSignal, number> = {
  explicit_positive: 0.35,
  acted: 0.3,
  asked_more: 0.2,
  followed_up: 0.2,
  opened: 0.08,
  exposed: 0,
  ignored: -0.03,
  dismissed: -0.2,
  marked_not_useful: -0.35,
};

/** Movimento máximo (soma de |delta|) por tópico por dia. */
export const ADVISOR_DAILY_MOVEMENT_CAP = 0.35;

export function advisorSignalDelta(signal: string): number {
  return ADVISOR_SIGNAL_WEIGHTS[signal as AdvisorSignal] ?? 0;
}

export function slugifyTopic(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const DOMAIN_BY_HINT: ReadonlyArray<{ re: RegExp; topic: string }> = [
  { re: /fatura|cart[ãa]o|parcel/i, topic: "card:invoice" },
  { re: /d[íi]vida|atraso|negativad/i, topic: "debt" },
  { re: /meta|objetivo|reserva|aporte/i, topic: "goal" },
  { re: /assinatura|recorr[êe]ncia|mensalidade/i, topic: "subscriptions" },
  { re: /investiment|aplica[çc]|rendiment/i, topic: "investments" },
  { re: /emo[çc][ãa]o|sentind|humor|ansios/i, topic: "emotion_finance" },
  { re: /h[áa]bito|padr[ãa]o|comportament/i, topic: "behavior" },
  { re: /caixa|saldo|dispon[íi]vel|fluxo/i, topic: "cash" },
  { re: /receita|renda|sal[áa]rio|entrada/i, topic: "performance:income" },
  { re: /gast|despesa|sa[íi]da/i, topic: "performance:expense" },
];

export type TopicResolutionInput = {
  /** Chave já canônica (highlight, situação) — tem prioridade absoluta. */
  explicit_topic_key?: string | null;
  category?: string | null;
  merchant?: string | null;
  /** Nome da capability/intent executada no turno. */
  capability?: string | null;
  /** Ferramenta determinística executada. */
  tool_name?: string | null;
  /** Texto do usuário — último recurso, só para achar o domínio. */
  text?: string | null;
};

/** Normaliza chaves legadas ou soltas para o formato canônico. */
export function normalizeAdvisorTopicKey(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(performance|situation|card|debt|goal|cash|behavior|emotion_finance|subscriptions|investments):/.test(value)) {
    return value.toLowerCase();
  }
  if (/^categoria?[:_]/i.test(value)) return `performance:category:${slugifyTopic(value.split(/[:_]/).slice(1).join("_"))}`;
  return slugifyTopic(value);
}

/**
 * Resolve o tópico a partir do que REALMENTE aconteceu no turno.
 * Retorna `null` quando não há assunto financeiro identificável — nesse caso
 * nada é aprendido (melhor não aprender do que aprender tópico errado).
 */
export function resolveAdvisorTopicKey(input: TopicResolutionInput): string | null {
  if (input.explicit_topic_key && String(input.explicit_topic_key).trim()) {
    return normalizeAdvisorTopicKey(String(input.explicit_topic_key));
  }
  if (input.category && String(input.category).trim()) {
    return `performance:category:${slugifyTopic(String(input.category))}`;
  }
  if (input.merchant && String(input.merchant).trim()) {
    return `performance:merchant:${slugifyTopic(String(input.merchant))}`;
  }
  const hintSource = `${input.tool_name ?? ""} ${input.capability ?? ""}`;
  for (const rule of DOMAIN_BY_HINT) {
    if (rule.re.test(hintSource)) return rule.topic;
  }
  if (input.text) {
    for (const rule of DOMAIN_BY_HINT) {
      if (rule.re.test(input.text)) return rule.topic;
    }
  }
  return null;
}

/** Modos de comparação que o usuário pode pedir explicitamente. */
export type PreferredComparisonMode =
  | "MTD_EQUIVALENT"
  | "BUSINESS_DAYS_EQUIVALENT"
  | "ROLLING_30D"
  | "SAME_CYCLE_POINT"
  | "FULL_PREVIOUS_MONTH";

const COMPARISON_HINTS: ReadonlyArray<{ re: RegExp; mode: PreferredComparisonMode }> = [
  { re: /dias?\s+[úu]teis/i, mode: "BUSINESS_DAYS_EQUIVALENT" },
  { re: /[úu]ltimos\s+30\s+dias|30\s+dias\s+corridos/i, mode: "ROLLING_30D" },
  { re: /mesmo\s+ponto\s+d[oa]\s+ciclo|ciclo\s+d[oa]\s+cart[ãa]o/i, mode: "SAME_CYCLE_POINT" },
  { re: /m[êe]s\s+(?:passado|anterior)\s+(?:fechad|complet|inteir)/i, mode: "FULL_PREVIOUS_MONTH" },
  { re: /mesm[oa]s?\s+dias|at[ée]\s+hoje|mesmo\s+per[íi]odo/i, mode: "MTD_EQUIVALENT" },
];

/** Detecta pedido explícito de recorte de comparação no texto do usuário. */
export function detectPreferredComparisonMode(text: string): PreferredComparisonMode | null {
  const t = String(text ?? "");
  for (const hint of COMPARISON_HINTS) {
    if (hint.re.test(t)) return hint.mode;
  }
  return null;
}

/** Rótulo em pt-BR do recorte — usado na linha de metodologia. */
export function comparisonModeLabel(mode: PreferredComparisonMode): string {
  switch (mode) {
    case "BUSINESS_DAYS_EQUIVALENT": return "mesma quantidade de dias úteis";
    case "ROLLING_30D": return "últimos 30 dias corridos";
    case "SAME_CYCLE_POINT": return "mesmo ponto do ciclo do cartão";
    case "FULL_PREVIOUS_MONTH": return "mês anterior fechado";
    case "MTD_EQUIVALENT":
    default: return "mesmo número de dias do mês";
  }
}
