// Histórico de consumo de tokens e latência do Nino.
// Toda agregação acontece no banco (`admin_v3_ai_history` e
// `admin_v2_ai_milestone_compare`): a tela só desenha. Nenhuma métrica é
// estimada no frontend e nenhum histórico é preenchido artificialmente —
// quando uma coluna de telemetria só existe a partir de certa data, o bloco
// de cobertura diz isso explicitamente.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, Gauge, Loader2, TrendingDown, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Series = {
  day: string;
  runs: number;
  llm_runs: number;
  no_llm_runs: number;
  no_llm_rate: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  tokens_per_run: number;
  avg_llm_calls: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  ai_avg_latency_ms: number | null;
  ai_p50_latency_ms: number | null;
  ai_p95_latency_ms: number | null;
  e2e_avg_latency_ms: number | null;
  e2e_p50_latency_ms: number | null;
  e2e_p95_latency_ms: number | null;
  estimated_cost_usd: number;
};

type History = {
  period: { from: string; to: string };
  totals: {
    runs: number; llm_runs: number; no_llm_runs: number; no_llm_rate: number;
    tokens_in: number; tokens_out: number; tokens_total: number;
    tokens_per_run: number; tokens_per_llm_run: number; avg_llm_calls: number;
    avg_latency_ms: number | null; p50_latency_ms: number | null; p95_latency_ms: number | null;
    ai_avg_latency_ms?: number | null; ai_p50_latency_ms?: number | null; ai_p95_latency_ms?: number | null;
    e2e_avg_latency_ms?: number | null; e2e_p50_latency_ms?: number | null; e2e_p95_latency_ms?: number | null;
    estimated_cost_usd: number; avg_system_prompt_chars: number | null;
    compression_ratio: number | null;
  };
  series: Series[];
  by_path: Array<{ path: string; runs: number; tokens_per_run: number; p50_latency_ms: number | null; p95_latency_ms: number | null }>;
  by_model: Array<{ model: string; model_tier: string | null; runs: number; tokens_in: number; tokens_out: number; estimated_cost_usd: number }>;
  latency_drilldown?: LatencyDrilldown;
  coverage: Record<string, string | null>;
  available_filters: {
    channels: string[]; paths: string[]; model_tiers: string[]; models: string[]; capabilities: string[];
  };
};

type LatencyRun = {
  run_id: string;
  started_at: string;
  day: string;
  status: string | null;
  channel: string | null;
  path: string | null;
  capability: string | null;
  model_tier: string | null;
  model: string | null;
  latency_ms: number | null;
  tokens_total: number;
  llm_calls: number;
  estimated_cost_usd: number;
  error_summary: string | null;
};

type LatencyDrilldown = {
  thresholds?: { p50_latency_ms: number | null; p95_latency_ms: number | null };
  p50_runs?: LatencyRun[];
  p95_runs?: LatencyRun[];
  outlier_runs?: LatencyRun[];
};

type Compare = {
  milestone: string;
  window_days: number;
  before: { runs: number; tokens_per_run?: number; no_llm_rate?: number; p50_latency_ms?: number; p95_latency_ms?: number };
  after: { runs: number; tokens_per_run?: number; no_llm_rate?: number; p50_latency_ms?: number; p95_latency_ms?: number };
  delta: null | {
    tokens_per_run_pct: number | null;
    no_llm_rate_pp: number | null;
    p50_latency_pct: number | null;
    p95_latency_pct: number | null;
  };
};

/** Marcos reais de implantação (datas das migrations/deploys correspondentes). */
const MILESTONES = [
  { date: "2026-08-21", label: "Performance V2 / Hot Path V3" },
  { date: "2026-08-22", label: "Nino Efficiency V2" },
  { date: "2026-08-25", label: "Fechamento Efficiency" },
] as const;

const PRESETS = [
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "90", label: "90 dias" },
  { id: "all", label: "Todo o histórico" },
  { id: "custom", label: "Personalizado" },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const ANY = "__any__";

/** Workloads reais do ledger de IA — separar conversa do Nino de OCR, áudio etc. */
const WORKLOADS = [
  { id: "AGENT_CONVERSATION", label: "Conversa do Nino" },
  { id: "DOCUMENT_INGEST", label: "Leitura de documentos" },
  { id: "AUDIO_TRANSCRIPTION_WHATSAPP", label: "Áudio (WhatsApp)" },
  { id: "AUDIO_TRANSCRIPTION_APP", label: "Áudio (app)" },
  { id: "CATEGORY_BACKGROUND", label: "Categorização (fundo)" },
  { id: "CATEGORY_ONDEMAND", label: "Categorização (na hora)" },
  { id: "PROACTIVE", label: "Proatividade" },
  { id: "INSIGHTS", label: "Insights" },
  { id: "ADVISOR_REPORTS", label: "Relatórios do consultor" },
  { id: "ANTICIPATION", label: "Antecipação" },
] as const;

export function AiEfficiencyHistoryBoard() {
  const [preset, setPreset] = useState<string>("30");
  const [from, setFrom] = useState<string>(isoDaysAgo(29));
  const [to, setTo] = useState<string>(new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState<string>(ANY);
  const [path, setPath] = useState<string>(ANY);
  const [capability, setCapability] = useState<string>(ANY);
  const [tier, setTier] = useState<string>(ANY);
  const [model, setModel] = useState<string>(ANY);
  // Conversa do Nino é o recorte que responde "o Nino está rápido para a pessoa?".
  const [workload, setWorkload] = useState<string>("AGENT_CONVERSATION");
  const [milestone, setMilestone] = useState<string>(MILESTONES[1].date);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedLatencyDay, setSelectedLatencyDay] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === "custom") return { from, to };
    if (preset === "all") return { from: "2026-01-01", to: new Date().toISOString().slice(0, 10) };
    const days = Number(preset);
    return { from: isoDaysAgo(days - 1), to: new Date().toISOString().slice(0, 10) };
  }, [preset, from, to]);

  const clean = (v: string) => (v === ANY ? null : v);

  const history = useQuery({
    queryKey: ["admin_ai_history", range, channel, path, capability, tier, model, workload],
    queryFn: async (): Promise<History> => {
      const { data, error } = await supabase.rpc("admin_v3_ai_history", {
        p_from: range.from, p_to: range.to,
        p_channel: clean(channel), p_path: clean(path),
        p_capability: clean(capability), p_model_tier: clean(tier),
        p_model: clean(model), p_workload: clean(workload),
      });
      if (error) throw error;
      return data as unknown as History;
    },
  });

  const latencyDay = useQuery({
    queryKey: ["admin_ai_latency_day", selectedLatencyDay, channel, path, capability, tier, model, workload],
    enabled: !!selectedLatencyDay,
    queryFn: async (): Promise<History> => {
      const day = selectedLatencyDay;
      if (!day) throw new Error("latency_day_required");
      const { data, error } = await supabase.rpc("admin_v3_ai_history", {
        p_from: day, p_to: day,
        p_channel: clean(channel), p_path: clean(path),
        p_capability: clean(capability), p_model_tier: clean(tier),
        p_model: clean(model), p_workload: clean(workload),
      });
      if (error) throw error;
      return data as unknown as History;
    },
  });

  const compare = useQuery({
    queryKey: ["admin_ai_compare", milestone, channel, path],
    queryFn: async (): Promise<Compare> => {
      const { data, error } = await supabase.rpc("admin_v2_ai_milestone_compare", {
        p_milestone: milestone, p_window_days: 14,
        p_channel: clean(channel), p_path: clean(path),
      });
      if (error) throw error;
      return data as unknown as Compare;
    },
  });

  if (history.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} /> Carregando histórico do Nino…
      </div>
    );
  }
  if (history.error) {
    return (
      <p className="rounded-2xl border border-destructive/40 bg-card p-6 text-sm text-muted-foreground">
        Não foi possível carregar o histórico agora. Tente novamente em instantes.
      </p>
    );
  }

  const h = history.data!;
  const t = h.totals;
  // A série do banco já vem dia a dia. Dias com zero token continuam na série
  // (o consumo real naquele dia foi zero); só escondemos o gráfico quando não
  // existe um único dia com token no recorte — aí a mensagem é explícita.
  const daySeries = h.series ?? [];
  const hasTokens = daySeries.some((row) => Number(row.tokens_total ?? 0) > 0);
  const tokenSeries = hasTokens ? daySeries : [];
  const latencySeries = daySeries.filter((row) =>
    row.ai_avg_latency_ms != null || row.ai_p50_latency_ms != null || row.ai_p95_latency_ms != null
  );
  const e2eSeries = daySeries.filter((row) =>
    row.e2e_avg_latency_ms != null || row.e2e_p50_latency_ms != null || row.e2e_p95_latency_ms != null
  );

  const filters = h.available_filters ?? { channels: [], paths: [], model_tiers: [], models: [], capabilities: [] };
  const ms = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1000).toFixed(1)}s`);
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const num = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));
  const marks = MILESTONES.filter((m) => m.date >= h.period.from && m.date <= h.period.to);
  const drill = (selectedLatencyDay ? latencyDay.data?.latency_drilldown : h.latency_drilldown) ?? {};
  const drillTitle = selectedLatencyDay ? `Runs de ${selectedLatencyDay}` : "Runs do recorte";
  const selectLatencyDay = (state: unknown) => {
    const day = (state as { activeLabel?: unknown } | null)?.activeLabel;
    if (typeof day === "string") setSelectedLatencyDay(day);
  };
  const drillRows = [
    { title: "Próximos da mediana", rows: drill.p50_runs ?? [] },
    { title: "Cauda P95", rows: drill.p95_runs ?? [] },
    { title: "Maiores latências", rows: drill.outlier_runs ?? [] },
  ];

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Eficiência do Nino</h2>
          <p className="text-xs text-muted-foreground">
            {h.period.from} a {h.period.to} · {num(t.runs)} conversas no recorte
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? "default" : "outline"}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </header>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3">
          <label className="text-xs text-muted-foreground">
            De
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9" />
          </label>
          <label className="text-xs text-muted-foreground">
            Até
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9" />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={workload} onValueChange={setWorkload}>
          <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Tipo de uso de IA" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os usos de IA</SelectItem>
            {WORKLOADS.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Canal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os canais</SelectItem>
            {filters.channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={path} onValueChange={setPath}>
          <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="Caminho" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os caminhos</SelectItem>
            {filters.paths.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Ocultar filtros avançados" : "Filtros avançados"}
        </Button>
        {showAdvanced && (
          <>
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="Capacidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todas as capacidades</SelectItem>
                {filters.capabilities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Faixa de modelo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todas as faixas</SelectItem>
                {filters.model_tiers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Modelo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos os modelos</SelectItem>
                {filters.models.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AdminMetricCard
          label="Conversas resolvidas sem IA"
          value={pct(t.no_llm_rate)}
          detail={`${num(t.no_llm_runs)} de ${num(t.runs)} conversas`}
          tone={t.no_llm_rate >= 0.8 ? "positive" : t.no_llm_rate >= 0.5 ? "warning" : "critical"}
        />
        <AdminMetricCard
          label="Tokens por conversa"
          value={num(t.tokens_per_run)}
          detail={`Só nas conversas com IA: ${num(t.tokens_per_llm_run)}`}
        />
        <AdminMetricCard
          label="Tokens no recorte"
          value={num(t.tokens_total)}
          detail={`Entrada ${num(t.tokens_in)} · Saída ${num(t.tokens_out)}`}
        />
        <AdminMetricCard label="Latência de IA (mediana)" value={ms(t.ai_p50_latency_ms)} detail={`Média ${ms(t.ai_avg_latency_ms)} · só o tempo do modelo`} />
        <AdminMetricCard label="Latência de IA (P95)" value={ms(t.ai_p95_latency_ms)} tone="warning" detail="Somente chamadas registradas no ledger de IA" />
        <AdminMetricCard
          label="Chamadas de IA por conversa"
          value={t.avg_llm_calls == null ? "—" : Number(t.avg_llm_calls).toFixed(2)}
          detail={t.compression_ratio == null
            ? "Compressão de evidência sem amostra"
            : `Evidência comprimida a ${Math.round(t.compression_ratio * 100)}% do resultado`}
        />
      </div>

      <figure className="rounded-3xl border border-border bg-card p-4 shadow-sm">
        <figcaption className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Zap size={14} className="text-primary" aria-hidden /> Consumo de tokens por dia
        </figcaption>
        {tokenSeries.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Nenhum consumo de IA registrado neste recorte. Troque o tipo de uso ou amplie o período.
          </p>
        ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => Number(v).toLocaleString("pt-BR")} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="tokens_in" name="Entrada" stackId="1" dot={tokenSeries.length < 3} stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
              <Area type="monotone" dataKey="tokens_out" name="Saída" stackId="1" dot={tokenSeries.length < 3} stroke="hsl(var(--brand-coral))" fill="hsl(var(--brand-coral))" fillOpacity={0.25} />
              {marks.map((m) => (
                <ReferenceLine key={m.date} x={m.date} stroke="hsl(var(--success))" strokeDasharray="4 4"
                  label={{ value: m.label, position: "insideTopRight", fontSize: 10, fill: "hsl(var(--success))" }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        )}
      </figure>

      <figure className="rounded-3xl border border-border bg-card p-4 shadow-sm">
        <figcaption className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Gauge size={14} className="text-primary" aria-hidden /> Latência de IA por dia (tempo do modelo)
        </figcaption>
        {latencySeries.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Sem latência de IA medida neste recorte.
          </p>
        ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={latencySeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} onClick={selectLatencyDay}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}s`} />
              <Tooltip formatter={(v: number) => `${(Number(v) / 1000).toFixed(1)}s`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
               <Line type="monotone" dataKey="ai_p50_latency_ms" name="Mediana" stroke="hsl(var(--primary))" dot={latencySeries.length < 3} strokeWidth={2} />
               <Line type="monotone" dataKey="ai_p95_latency_ms" name="P95" stroke="hsl(var(--brand-coral))" dot={latencySeries.length < 3} strokeWidth={2} />
               <Line type="monotone" dataKey="ai_avg_latency_ms" name="Média" stroke="hsl(var(--success))" dot={latencySeries.length < 3} strokeWidth={1} />
              {marks.map((m) => (
                <ReferenceLine key={m.date} x={m.date} stroke="hsl(var(--success))" strokeDasharray="4 4" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        )}
      </figure>

      <figure className="rounded-3xl border border-border bg-card p-4 shadow-sm">
        <figcaption className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Activity size={14} className="text-primary" aria-hidden /> Latência ponta a ponta por dia
        </figcaption>
        {e2eSeries.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">Sem execuções completas medidas neste recorte.</p>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={e2eSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}s`} />
                <Tooltip formatter={(v: number) => `${(Number(v) / 1000).toFixed(1)}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="e2e_p50_latency_ms" name="Mediana ponta a ponta" stroke="hsl(var(--primary))" dot={e2eSeries.length < 3} strokeWidth={2} />
                <Line type="monotone" dataKey="e2e_p95_latency_ms" name="P95 ponta a ponta" stroke="hsl(var(--brand-coral))" dot={e2eSeries.length < 3} strokeWidth={2} />
                <Line type="monotone" dataKey="e2e_avg_latency_ms" name="Média ponta a ponta" stroke="hsl(var(--success))" dot={e2eSeries.length < 3} strokeWidth={1} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </figure>

      <AiHistoryTable series={daySeries} />


      <section className="rounded-3xl border border-border bg-card p-4 shadow-sm">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingDown size={14} className="text-primary" aria-hidden /> Antes x depois de um marco
          </h3>
          <Select value={milestone} onValueChange={setMilestone}>
            <SelectTrigger className="h-9 w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MILESTONES.map((m) => (
                <SelectItem key={m.date} value={m.date}>{m.label} · {m.date}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>
        {compare.isLoading ? (
          <p className="text-xs text-muted-foreground">Calculando comparação…</p>
        ) : compare.error || !compare.data ? (
          <p className="text-xs text-muted-foreground">Comparação indisponível agora.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AdminMetricCard
                label="Tokens por conversa"
                value={`${num(compare.data.before.tokens_per_run)} → ${num(compare.data.after.tokens_per_run)}`}
                detail={compare.data.delta?.tokens_per_run_pct == null ? "Sem base para variação" : `${compare.data.delta.tokens_per_run_pct}%`}
                tone={(compare.data.delta?.tokens_per_run_pct ?? 0) < 0 ? "positive" : "neutral"}
              />
              <AdminMetricCard
                label="Sem IA"
                value={`${pct(compare.data.before.no_llm_rate)} → ${pct(compare.data.after.no_llm_rate)}`}
                detail={compare.data.delta?.no_llm_rate_pp == null ? "Sem base" : `${compare.data.delta.no_llm_rate_pp} p.p.`}
                tone={(compare.data.delta?.no_llm_rate_pp ?? 0) > 0 ? "positive" : "neutral"}
              />
              <AdminMetricCard
                label="Latência mediana"
                value={`${ms(compare.data.before.p50_latency_ms)} → ${ms(compare.data.after.p50_latency_ms)}`}
                detail={compare.data.delta?.p50_latency_pct == null ? "Sem base" : `${compare.data.delta.p50_latency_pct}%`}
              />
              <AdminMetricCard
                label="Latência P95"
                value={`${ms(compare.data.before.p95_latency_ms)} → ${ms(compare.data.after.p95_latency_ms)}`}
                detail={compare.data.delta?.p95_latency_pct == null ? "Sem base" : `${compare.data.delta.p95_latency_pct}%`}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Janela de {compare.data.window_days} dias de cada lado · amostra: {num(compare.data.before.runs)} antes,{" "}
              {num(compare.data.after.runs)} depois.
              {(compare.data.before.runs < 20 || compare.data.after.runs < 20)
                ? " Amostra pequena: leia como indício, não como conclusão."
                : ""}
            </p>
          </>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Activity size={14} className="text-primary" aria-hidden /> Determinístico x IA
          </h3>
          <ul className="space-y-2 text-xs">
            {h.by_path.map((row) => (
              <li key={row.path} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <span className="font-medium">{row.path}</span>
                <span className="text-muted-foreground tabular-nums">
                  {num(row.runs)} conversas · {num(row.tokens_per_run)} tokens · P50 {ms(row.p50_latency_ms)} · P95 {ms(row.p95_latency_ms)}
                </span>
              </li>
            ))}
            {!h.by_path.length && <li className="text-muted-foreground">Sem conversas no recorte.</li>}
          </ul>
        </div>
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Modelos efetivamente usados</h3>
          <ul className="space-y-2 text-xs">
            {h.by_model.map((row) => (
              <li key={`${row.model}-${row.model_tier}`} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <span className="font-medium">{row.model}{row.model_tier ? ` · ${row.model_tier}` : ""}</span>
                <span className="text-muted-foreground tabular-nums">
                  {num(row.runs)} conversas · {num(row.tokens_in + row.tokens_out)} tokens
                </span>
              </li>
            ))}
            {!h.by_model.length && <li className="text-muted-foreground">Nenhuma conversa usou modelo no recorte.</li>}
          </ul>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Cobertura da telemetria: primeira conversa registrada em{" "}
        {h.coverage?.first_run_at ? new Date(h.coverage.first_run_at).toLocaleDateString("pt-BR") : "—"}
        {h.coverage?.first_model_tier_at
          ? ` · faixa de modelo disponível desde ${new Date(h.coverage.first_model_tier_at).toLocaleDateString("pt-BR")}`
          : ""}
        {h.coverage?.first_compression_at
          ? ` · compressão de evidência desde ${new Date(h.coverage.first_compression_at).toLocaleDateString("pt-BR")}`
          : ""}
        . Dias anteriores a essas datas aparecem sem a métrica, nunca preenchidos.
      </p>
    </section>
  );
}
