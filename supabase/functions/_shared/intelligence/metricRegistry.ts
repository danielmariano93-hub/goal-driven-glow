import type { MetricDefinition } from "./contracts.ts";
import { WEEKDAY_TRUTH_FORMULA_VERSION } from "../analytics/weekdayTruth.ts";

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  weekday_typical_spend: {
    key: "weekday_typical_spend",
    label: "Gasto típico por dia da semana",
    description: "Compara gasto ajustável por ocorrência usando frequência, mediana robusta, consistência, cobertura e separação contra o segundo colocado; amostra insuficiente gera abstenção.",
    formula: "taxa de dias ativos × mediana(gasto ajustável dos dias ativos limpos), com gates de amostra, consistência e separação",
    default_window_days: 84,
    minimum_sample: 4,
    include_zero_days: true,
    outlier_policy: "exclude_for_typical",
    formula_version: WEEKDAY_TRUTH_FORMULA_VERSION,
  },
  weekday_total_concentration: {
    key: "weekday_total_concentration",
    label: "Concentração total por dia da semana",
    description: "Soma todo o consumo por dia da semana, sem transformar concentração em comportamento típico.",
    formula: "soma(gasto diário) por dia da semana / soma(total)",
    default_window_days: 84,
    minimum_sample: 1,
    include_zero_days: false,
    outlier_policy: "keep",
    formula_version: "weekday.total.v1",
  },
  weekday_purchase_frequency: {
    key: "weekday_purchase_frequency",
    label: "Frequência de compras por dia da semana",
    description: "Compara a quantidade média de transações em cada ocorrência do dia da semana.",
    formula: "contagem(transações) / ocorrências do dia da semana",
    default_window_days: 84,
    minimum_sample: 4,
    include_zero_days: true,
    outlier_policy: "keep",
    formula_version: "weekday.frequency.v1",
  },
  weekday_average_ticket: {
    key: "weekday_average_ticket",
    label: "Ticket médio por dia da semana",
    description: "Compara o valor médio por transação em cada dia da semana.",
    formula: "soma(gastos) / contagem(transações)",
    default_window_days: 84,
    minimum_sample: 4,
    include_zero_days: false,
    outlier_policy: "separate",
    formula_version: "weekday.ticket.v1",
  },
};

export function metricDefinition(key: string): MetricDefinition | null {
  return METRIC_REGISTRY[key] ?? null;
}
