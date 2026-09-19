import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AiOpsCharts, type AiOpsPoint } from "@/components/admin/AiOpsCharts";
import { Button } from "@/components/ui/button";
import { todaySP } from "@/lib/admin/periodPresets";

type Snapshot = {
  period: { from: string; to: string; timezone: string };
  totals: {
    interactions: number; unique_users: number; conversation_threads: number; ai_calls: number;
    tokens_in: number; tokens_out: number; tokens_total: number;
    tokens_per_interaction: number | null; tokens_per_ai_call: number | null;
    ai_avg_latency_ms: number | null; ai_p50_latency_ms: number | null; ai_p95_latency_ms: number | null;
    run_avg_latency_ms: number | null; run_p50_latency_ms: number | null; run_p95_latency_ms: number | null;
    perceived_p50_latency_ms: number | null; perceived_p95_latency_ms: number | null;
    provider: string | null; model: string | null;
  };
  series: AiOpsPoint[];
  coverage: {
    first_run_at?: string | null; first_ai_usage_at?: string | null;
    days_with_runs?: number; days_with_ai_usage?: number; perceived_latency_available?: boolean;
  };
};

function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const int = (v: number | null | undefined) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const sec = (v: number | null | undefined) => v == null ? "—" : `${(Number(v) / 1000).toFixed(1)}s`;

export function AiEfficiencyTruthBoard() {
  const [days, setDays] = useState(30);
  const range = useMemo(() => {
    const to = todaySP();
    return { from: addDays(to, -(days - 1)), to };
  }, [days]);

  const query = useQuery({
    queryKey: ["admin_ai_ops_snapshot", range],
    queryFn: async (): Promise<Snapshot> => {
      const { data, error } = await (supabase.rpc as any)("admin_ai_ops_snapshot", {
        p_from: range.from, p_to: range.to, p_workload: "AGENT_CONVERSATION",
      });
      if (error) throw error;
      return data as Snapshot;
    },
  });

  if (query.isLoading) {
    return <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Carregando telemetria real…</div>;
  }
  if (query.error || !query.data) {
    return <div className="rounded-2xl border border-destructive/30 bg-card p-5 text-sm text-muted-foreground">Não foi possível carregar a telemetria de IA agora.</div>;
  }

  const s = query.data;
  const t = s.totals;
  const partialCoverage = Number(s.coverage?.days_with_runs ?? 0) > Number(s.coverage?.days_with_ai_usage ?? 0);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Eficiência do Nino</h2>
          <p className="text-xs text-muted-foreground">Interações vêm de agent_runs; tokens e tempo do modelo vêm do ledger do provider.</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((n) => <Button key={n} size="sm" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>{n} dias</Button>)}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AdminMetricCard label="Interações" value={int(t.interactions)} detail={`${int(t.ai_calls)} chamadas de IA · ${int(t.unique_users)} clientes`} />
        <AdminMetricCard label="Tokens consumidos" value={int(t.tokens_total)} detail={`Entrada ${int(t.tokens_in)} · saída ${int(t.tokens_out)}`} />
        <AdminMetricCard label="Tokens por interação" value={int(t.tokens_per_interaction)} detail={`Por chamada de IA: ${int(t.tokens_per_ai_call)}`} />
        <AdminMetricCard label="Latência IA (P50)" value={sec(t.ai_p50_latency_ms)} detail="Tempo mediano do modelo/provider" />
        <AdminMetricCard label="Latência IA (P95)" value={sec(t.ai_p95_latency_ms)} detail="95% das chamadas ficam abaixo deste tempo" />
        <AdminMetricCard label="Tempo total do run (P95)" value={sec(t.run_p95_latency_ms)} detail="Backend completo; não é latência percebida de rede" />
      </div>

      <AiOpsCharts series={s.series ?? []} coverage={s.coverage} />

      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <p>
          {t.provider ? `Provider predominante: ${t.provider}${t.model ? ` · ${t.model}` : ""}. ` : ""}
          “Interações” não significa threads únicas: houve {int(t.conversation_threads)} threads no recorte. {partialCoverage ? "Há lacunas históricas de token, então picos devem ser comparados apenas com dias que também têm cobertura de provider." : "A cobertura do recorte está consistente."}
        </p>
      </div>
    </section>
  );
}
