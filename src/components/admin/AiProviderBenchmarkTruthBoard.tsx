import { useQuery } from "@tanstack/react-query";
import { Loader2, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { todaySP } from "@/lib/admin/periodPresets";

type ProviderMetrics = {
  provider: string | null; model: string | null;
  avg_latency_ms: number | null; p95_latency_ms: number | null;
  tokens_per_turn: number | null; success_pct: number | null;
};
type Benchmark = {
  sample: { paired_turns: number; shadow_successful_turns: number; official_usage_calls: number };
  official: ProviderMetrics; shadow: ProviderMetrics;
  semantic: { parity_pct: number | null };
  delta: { shadow_latency_vs_official_pct: number | null; shadow_tokens_vs_official_pct: number | null };
};

function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
const sec = (v: number | null | undefined) => v == null ? "—" : `${(v / 1000).toFixed(2)}s`;
const num = (v: number | null | undefined) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const pct = (v: number | null | undefined) => v == null ? "—" : `${Number(v).toFixed(1)}%`;
const name = (p: ProviderMetrics | undefined, fallback: string) => p?.provider ? `${p.provider}${p.model ? ` · ${p.model}` : ""}` : fallback;

export function AiProviderBenchmarkTruthBoard() {
  const to = todaySP();
  const from = addDays(to, -29);
  const query = useQuery({
    queryKey: ["admin_ai_provider_benchmark_truth", from, to],
    queryFn: async (): Promise<Benchmark> => {
      const { data, error } = await (supabase.rpc as any)("admin_ai_provider_benchmark", {
        p_from: from, p_to: to, p_shadow_provider: null, p_shadow_model: null,
      });
      if (error) throw error;
      return data as Benchmark;
    },
  });

  if (query.isLoading) return <section className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Carregando benchmark de providers…</span></section>;
  if (query.error || !query.data) return <section className="rounded-2xl border border-border bg-card p-5"><p className="text-sm font-medium">Provider oficial × shadow</p><p className="mt-1 text-xs text-muted-foreground">Benchmark indisponível agora.</p></section>;

  const b = query.data;
  if (!b.sample?.paired_turns) {
    return <section className="rounded-2xl border border-border bg-card p-5"><p className="flex items-center gap-2 text-sm font-medium"><Scale size={15} /> Provider oficial × shadow</p><p className="mt-1 text-xs text-muted-foreground">A infraestrutura está disponível, mas ainda não há turnos shadow pareados suficientes no período.</p></section>;
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Scale size={16} /> Provider oficial × shadow</h2>
        <p className="mt-1 text-xs text-muted-foreground">Comparação real do mesmo contexto, sem presumir que Lovable ou Groq sejam o provider atual.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AdminMetricCard label="Provider oficial" value={name(b.official, "—")} detail={`${sec(b.official.avg_latency_ms)} média · ${num(b.official.tokens_per_turn)} tokens/turno`} />
        <AdminMetricCard label="Provider shadow" value={name(b.shadow, "—")} detail={`${sec(b.shadow.avg_latency_ms)} média · ${num(b.shadow.tokens_per_turn)} tokens/turno`} />
        <AdminMetricCard label="Amostra pareada" value={num(b.sample.paired_turns)} detail={`${num(b.sample.shadow_successful_turns)} respostas shadow válidas`} />
        <AdminMetricCard label="Paridade semântica" value={pct(b.semantic.parity_pct)} detail="Concordância com o contrato do provider oficial; não é ground truth." />
        <AdminMetricCard label="Δ latência shadow" value={pct(b.delta.shadow_latency_vs_official_pct)} detail="Negativo = shadow mais rápido." />
        <AdminMetricCard label="Δ tokens shadow" value={pct(b.delta.shadow_tokens_vs_official_pct)} detail="Negativo = shadow consumiu menos tokens." />
      </div>
    </section>
  );
}
