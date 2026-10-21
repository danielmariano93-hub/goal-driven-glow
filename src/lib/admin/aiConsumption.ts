import { useQuery } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";

// Consumo de IA de todas as funções (ai_usage_ledger). A Visão geral por conversa
// (agent_runs) não enxerga o que o Nino gasta nos bastidores.

export interface AiConsumption {
  days: number;
  totals: { calls: number; tokens_in: number; tokens_out: number; cost_usd: number; failures: number };
  daily: Array<{ day: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number }>;
  by_workload: Array<{ workload: string; calls: number; tokens: number; cost_usd: number; failures: number; avg_ms: number | null }>;
  by_model: Array<{ model: string; calls: number; tokens: number; cost_usd: number; failures: number; avg_ms: number | null }>;
  failures: Array<{ workload: string; error_code: string; n: number; last_at: string }>;
}

export function useAiConsumption(days: number) {
  return useQuery({
    queryKey: ["admin-ai-consumption", days],
    queryFn: () => callAdminRpc<AiConsumption>("admin_ai_consumption", { _days: days }),
    staleTime: 60_000,
  });
}

const WORKLOAD_LABEL: Record<string, string> = {
  PROACTIVE: "Avisos e mensagens do Nino",
  CATEGORY_BACKGROUND: "Categorização automática",
  ADVISOR_REPORTS: "Relatórios (semanal e mensal)",
  INSIGHTS: "Insights",
  AGENT_CONVERSATION: "Conversa com o Nino",
  DOCUMENT_INGEST: "Leitura de extratos e faturas",
  MAPA: "Mapa Financeiro",
};
export const workloadLabel = (w: string) => WORKLOAD_LABEL[w] ?? w.toLowerCase().replace(/_/g, " ");
