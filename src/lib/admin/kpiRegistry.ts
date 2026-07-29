/**
 * Dicionário canônico de indicadores do painel administrativo.
 *
 * Regra de produto: nenhum número aparece no admin sem universo, fórmula,
 * período, fonte e exclusões declarados. Este registro é lido pela UI
 * (tooltip "Como calculamos") e pelos testes de contrato.
 */

export type KpiSource = "live" | "aggregate" | "backfill" | "estimate";

export type KpiMeta = {
  key: string;
  label: string;
  /** Quem entra na conta. */
  universe: string;
  /** Como é calculado, em linguagem de negócio. */
  formula: string;
  period: string;
  source: KpiSource;
  /** Quem fica de fora. */
  exclusions: string[];
  /** Abaixo disso o indicador não vira KPI — vira "ainda aprendendo". */
  minimumSample: number;
  polarityHint?: "higher_is_better" | "lower_is_better" | "neutral";
};

/** Universo padrão do admin: clientes reais, sem admins nem contas de teste. */
export const CLIENT_UNIVERSE =
  "Clientes reais do Meu Nino (exclui administradores da plataforma e contas marcadas como teste)";

const SOURCE_LABEL: Record<KpiSource, string> = {
  live: "Consulta ao vivo",
  aggregate: "Tabela agregada",
  backfill: "Histórico reconstruído",
  estimate: "Estimativa",
};

export function sourceLabel(source: KpiSource): string {
  return SOURCE_LABEL[source];
}

const REGISTRY: Record<string, KpiMeta> = {
  total_users: {
    key: "total_users",
    label: "Clientes ativos na base",
    universe: CLIENT_UNIVERSE,
    formula: "Contas de clientes existentes e não excluídas ao final do período.",
    period: "Posição no fim do período (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Administradores da plataforma", "Contas de teste", "Contas excluídas"],
    minimumSample: 1,
    polarityHint: "higher_is_better",
  },
  registered_today: {
    key: "registered_today",
    label: "Novos clientes",
    universe: CLIENT_UNIVERSE,
    formula: "Clientes cujo cadastro ocorreu dentro do período selecionado.",
    period: "Período selecionado (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Administradores da plataforma", "Contas de teste"],
    minimumSample: 1,
    polarityHint: "higher_is_better",
  },
  activation: {
    key: "activation",
    label: "Clientes que começaram a usar",
    universe: CLIENT_UNIVERSE,
    formula:
      "Clientes que concluíram o onboarding e registraram ao menos uma ação financeira significativa.",
    period: "Período selecionado (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Administradores da plataforma", "Contas de teste"],
    minimumSample: 3,
    polarityHint: "higher_is_better",
  },
  wvu: {
    key: "wvu",
    label: "Clientes usando na semana",
    universe: CLIENT_UNIVERSE,
    formula: "Clientes distintos com ao menos uma ação relevante nos últimos 7 dias.",
    period: "Últimos 7 dias (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Administradores da plataforma", "Contas de teste", "Eventos automáticos do sistema"],
    minimumSample: 3,
    polarityHint: "higher_is_better",
  },
  value_delivered: {
    key: "value_delivered",
    label: "Clientes que receberam valor do Nino",
    universe: CLIENT_UNIVERSE,
    formula:
      "Clientes que receberam ao menos uma entrega útil do Nino (insight, previsão ou resposta aproveitada).",
    period: "Período selecionado (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Administradores da plataforma", "Contas de teste"],
    minimumSample: 3,
    polarityHint: "higher_is_better",
  },
  agent_cost_cents_today: {
    key: "agent_cost_cents_today",
    label: "Custo do Nino no período",
    universe: "Todas as execuções do Nino (app e WhatsApp)",
    formula: "Soma do custo das execuções do Nino no período, convertido de centavos para reais.",
    period: "Período selecionado (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Execuções de simulação interna"],
    minimumSample: 1,
    polarityHint: "lower_is_better",
  },
  messaging_failure_rate_7d: {
    key: "messaging_failure_rate_7d",
    label: "Mensagens que falharam",
    universe: "Mensagens enviadas pelo Nino no WhatsApp",
    formula: "Mensagens com falha definitiva dividido pelo total de tentativas de envio.",
    period: "Últimos 7 dias (America/Sao_Paulo)",
    source: "live",
    exclusions: ["Mensagens ainda na fila", "Mensagens suprimidas por regra de comunicação"],
    minimumSample: 10,
    polarityHint: "lower_is_better",
  },
};

export function kpiMeta(key: string): KpiMeta | null {
  return REGISTRY[key] ?? null;
}

export function allKpiKeys(): string[] {
  return Object.keys(REGISTRY);
}

/** Texto curto de proveniência para tooltips e blocos "Detalhes técnicos". */
export function kpiProvenance(key: string): string | null {
  const meta = kpiMeta(key);
  if (!meta) return null;
  return [
    `Universo: ${meta.universe}.`,
    `Cálculo: ${meta.formula}`,
    `Período: ${meta.period}.`,
    `Fonte: ${sourceLabel(meta.source)}.`,
    meta.exclusions.length ? `Não inclui: ${meta.exclusions.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Um indicador só vira KPI quando tem amostra suficiente. Caso contrário ele
 * é agrupado no bloco único "Ainda aprendendo".
 */
export function hasEnoughSample(
  key: string,
  envelope?: { sample_size?: number; sufficient_sample?: boolean } | null,
): boolean {
  const meta = kpiMeta(key);
  if (!envelope) return true;
  if (envelope.sufficient_sample === false) return false;
  const min = meta?.minimumSample ?? 1;
  return (envelope.sample_size ?? min) >= min;
}
