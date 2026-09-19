import { Activity, Gauge, Zap } from "lucide-react";
import { TrendChart } from "@/components/admin/kit/TrendChart";

export type AiOpsPoint = {
  day: string;
  interactions: number;
  unique_users?: number;
  conversation_threads?: number;
  ai_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  tokens_per_interaction: number | null;
  ai_avg_latency_ms: number | null;
  ai_p50_latency_ms: number | null;
  ai_p95_latency_ms: number | null;
  run_avg_latency_ms: number | null;
  run_p50_latency_ms: number | null;
  run_p95_latency_ms: number | null;
  perceived_avg_latency_ms?: number | null;
  perceived_p50_latency_ms?: number | null;
  perceived_p95_latency_ms?: number | null;
};

type Coverage = {
  days_with_runs?: number;
  days_with_ai_usage?: number;
};

const dayLabel = (day: string) => `${String(day).slice(8, 10)}/${String(day).slice(5, 7)}`;
const seconds = (value: number) => `${(Number(value) / 1000).toFixed(1)}s`;
const compact = (value: number) => new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
}).format(Number(value));

export function AiOpsCharts({
  series,
  coverage,
  className = "",
}: {
  series: AiOpsPoint[];
  coverage?: Coverage;
  className?: string;
}) {
  const rows = (series ?? []).map((row) => ({ ...row, label: dayLabel(row.day) }));
  const aiRows = rows.filter((row) =>
    row.ai_avg_latency_ms != null || row.ai_p50_latency_ms != null || row.ai_p95_latency_ms != null
  );
  const runRows = rows.filter((row) =>
    row.run_avg_latency_ms != null || row.run_p50_latency_ms != null || row.run_p95_latency_ms != null
  );
  const partialCoverage = Number(coverage?.days_with_runs ?? 0) > Number(coverage?.days_with_ai_usage ?? 0);

  return (
    <div className={`grid min-w-0 gap-4 xl:grid-cols-2 ${className}`}>
      <div className="min-w-0 space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Zap size={14} /> Consumo de tokens por dia</p>
        <TrendChart
          data={rows}
          xKey="label"
          series={[
            { key: "tokens_in", label: "Entrada", tone: "primary" },
            { key: "tokens_out", label: "Saída", tone: "danger" },
          ]}
          formatValue={compact}
          emptyLabel="Ainda não há telemetria de tokens neste período."
          caption={partialCoverage
            ? "Cobertura histórica parcial: dias sem telemetria do provider permanecem visíveis, sem preenchimento artificial."
            : "Tokens efetivamente registrados pelo provider."}
        />
      </div>

      <div className="min-w-0 space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Gauge size={14} /> Latência de IA por dia (tempo do modelo)</p>
        <TrendChart
          data={aiRows}
          xKey="label"
          series={[
            { key: "ai_p50_latency_ms", label: "Mediana", tone: "primary" },
            { key: "ai_p95_latency_ms", label: "P95", tone: "danger" },
            { key: "ai_avg_latency_ms", label: "Média", tone: "success" },
          ]}
          formatValue={seconds}
          emptyLabel="Ainda não há latência do modelo registrada neste período."
          caption="Somente o tempo do modelo/provider."
        />
      </div>

      <div className="min-w-0 space-y-2 xl:col-span-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Activity size={14} /> Latência ponta a ponta por dia</p>
        <TrendChart
          data={runRows}
          xKey="label"
          height={260}
          series={[
            { key: "run_p50_latency_ms", label: "Mediana", tone: "primary" },
            { key: "run_p95_latency_ms", label: "P95", tone: "danger" },
            { key: "run_avg_latency_ms", label: "Média", tone: "success" },
          ]}
          formatValue={seconds}
          emptyLabel="Ainda não há latência total registrada neste período."
          caption="Tempo total do run no backend, da entrada até a resposta do Nino; não inclui rede/dispositivo do usuário."
        />
      </div>
    </div>
  );
}
