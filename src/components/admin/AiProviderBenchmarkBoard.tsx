import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { BrainCircuit, Gauge, Loader2, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shift, today } from "@/lib/engine/ninoClock";

type ProviderMetrics = {
  provider: string | null;
  model: string | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  tokens_per_turn: number | null;
  success_pct: number | null;
};

type BenchmarkDaily = {
  day: string;
  turns: number;
  ok_turns: number;
  official_avg_latency_ms: number | null;
  shadow_avg_latency_ms: number | null;
  official_p95_latency_ms: number | null;
  shadow_p95_latency_ms: number | null;
  official_tokens_per_turn: number | null;
  shadow_tokens_per_turn: number | null;
  semantic_parity_pct: number | null;
};

type ProviderBenchmark = {
  period: { from: string; to: string };
  sample: {
    paired_turns: number;
    shadow_successful_turns: number;
    official_usage_calls: number;
  };
  official: ProviderMetrics;
  shadow: ProviderMetrics;
  semantic: {
    parity_pct: number | null;
    act_match_pct: number | null;
    mode_match_pct: number | null;
    canonical_match_pct: number | null;
    focus_match_pct: number | null;
    action_match_pct: number | null;
  };
  delta: {
    shadow_latency_vs_official_pct: number | null;
    shadow_tokens_vs_official_pct: number | null;
  };
  daily: BenchmarkDaily[];
  notes?: {
    semantic_parity_is_not_ground_truth?: boolean;
    token_comparison_basis?: string;
  };
};

const PRESETS = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
] as const;

function isoDaysAgo(days: number) {
  return shift(today(), -days);
}

function providerLabel(provider: string | null | undefined) {
  if (!provider) return "—";
  if (provider === "lovable") return "Lovable";
  if (provider === "groq") return "Groq";
  if (provider === "openrouter") return "OpenRouter";
  return provider;
}

function seconds(value: number | null | undefined) {
  return value == null ? "—" : `${(Number(value) / 1000).toFixed(2)}s`;
}

function number(value: number | null | undefined, digits = 0) {
  return value == null ? "—" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function percent(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : `${Number(value).toFixed(digits)}%`;
}

function deltaText(value: number | null | undefined, lowerIsBetter = true) {
  if (value == null) return "Sem dados suficientes";
  const abs = Math.abs(value).toFixed(1);
  if (Math.abs(value) < 0.5) return "Praticamente empatado";
  const better = lowerIsBetter ? value < 0 : value > 0;
  return `${better ? "Melhora" : "Piora"} de ${abs}%`;
}

function winnerForLower(official: number | null | undefined, shadow: number | null | undefined, officialName: string, shadowName: string) {
  if (official == null || shadow == null) return "Inconclusivo";
  const gap = Math.abs(official - shadow) / Math.max(Math.abs(official), 1);
  if (gap < 0.03) return "Empate técnico";
  return shadow < official ? shadowName : officialName;
}

function MetricCard({ title, value, detail, icon: Icon }: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Icon size={15} className="text-muted-foreground" />
      </div>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function AiProviderBenchmarkBoard() {
  const [days, setDays] = useState(30);
  const range = useMemo(() => ({
    from: isoDaysAgo(days - 1),
    to: today(),
  }), [days]);

  const benchmark = useQuery({
    queryKey: ["admin_ai_provider_benchmark", range],
    queryFn: async (): Promise<ProviderBenchmark> => {
      const { data, error } = await (supabase as any).rpc("admin_ai_provider_benchmark", {
        p_from: range.from,
        p_to: range.to,
        p_shadow_provider: null,
        p_shadow_model: null,
      });
      if (error) throw error;
      return data as ProviderBenchmark;
    },
  });

  if (benchmark.isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Carregando comparação de providers…
        </div>
      </section>
    );
  }

  if (benchmark.error) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium">Lovable × provider alternativo</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A comparação ficará disponível quando a migration de benchmark estiver aplicada e houver amostra shadow.
        </p>
      </section>
    );
  }

  const b = benchmark.data;
  const hasSample = Boolean(b?.sample?.paired_turns);
  const officialName = providerLabel(b?.official?.provider || "lovable");
  const shadowName = providerLabel(b?.shadow?.provider || "groq");
  const latencyWinner = winnerForLower(
    b?.official?.avg_latency_ms,
    b?.shadow?.avg_latency_ms,
    officialName,
    shadowName,
  );
  const tokenWinner = winnerForLower(
    b?.official?.tokens_per_turn,
    b?.shadow?.tokens_per_turn,
    officialName,
    shadowName,
  );
  const operationalSummary = latencyWinner === tokenWinner && !["Inconclusivo", "Empate técnico"].includes(latencyWinner)
    ? `${latencyWinner} lidera em latência e tokens neste recorte.`
    : `Não há vencedor operacional único: latência favorece ${latencyWinner} e tokens favorecem ${tokenWinner}.`;

  const semanticBars = b ? [
    { metric: "Intenção", value: b.semantic.act_match_pct },
    { metric: "Modo", value: b.semantic.mode_match_pct },
    { metric: "Pedido", value: b.semantic.canonical_match_pct },
    { metric: "Contexto", value: b.semantic.focus_match_pct },
    { metric: "Ação", value: b.semantic.action_match_pct },
  ] : [];

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Lovable × Groq</h2>
            <Badge variant="secondary" className="gap-1">
              <Sparkles size={12} /> Shadow benchmark
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            O Nino continua respondendo pelo provider oficial. O provider alternativo recebe o mesmo contexto em paralelo, sem executar tools ou alterar dados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PRESETS.map((p) => (
            <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>
      </header>

      {!hasSample ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          Ainda não há amostra comparável. Assim que o shadow da Groq for ativado, os gráficos começam a ser preenchidos automaticamente.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-sm font-medium">Leitura rápida: {operationalSummary}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paridade semântica de {percent(b.semantic.parity_pct)} em {number(b.sample.paired_turns)} turnos pareados. Paridade mede concordância com o Nino atual — não é, isoladamente, prova de maior acurácia.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              title="Amostra pareada"
              value={number(b.sample.paired_turns)}
              detail={`${number(b.sample.shadow_successful_turns)} respostas shadow válidas`}
              icon={Scale}
            />
            <MetricCard
              title="Mais rápido"
              value={latencyWinner}
              detail={`${shadowName}: ${seconds(b.shadow.avg_latency_ms)} · ${officialName}: ${seconds(b.official.avg_latency_ms)}`}
              icon={Gauge}
            />
            <MetricCard
              title="Menos tokens"
              value={tokenWinner}
              detail={`${shadowName}: ${number(b.shadow.tokens_per_turn, 1)} · ${officialName}: ${number(b.official.tokens_per_turn, 1)} / turno`}
              icon={BrainCircuit}
            />
            <MetricCard
              title="Paridade semântica"
              value={percent(b.semantic.parity_pct)}
              detail="Concordância média do contrato conversacional"
              icon={Sparkles}
            />
            <MetricCard
              title={`Sucesso ${shadowName}`}
              value={percent(b.shadow.success_pct)}
              detail={`Provider oficial: ${percent(b.official.success_pct)}`}
              icon={ShieldCheck}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-border p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Latência diária</h3>
                <p className="text-xs text-muted-foreground">Menor é melhor · média por turno do Conversation Brain.</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={b.daily ?? []}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}s`} />
                    <Tooltip formatter={(v: number) => seconds(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="official_avg_latency_ms" name={officialName} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="shadow_avg_latency_ms" name={shadowName} stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {shadowName}: {deltaText(b.delta.shadow_latency_vs_official_pct)} versus {officialName} no período.
              </p>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Tokens por turno</h3>
                <p className="text-xs text-muted-foreground">Menor é melhor · consumo médio para interpretar a conversa.</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={b.daily ?? []}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => number(v, 1)} />
                    <Legend />
                    <Line type="monotone" dataKey="official_tokens_per_turn" name={officialName} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="shadow_tokens_per_turn" name={shadowName} stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {shadowName}: {deltaText(b.delta.shadow_tokens_vs_official_pct)} versus {officialName}. Tokens do provider oficial usam as chamadas do mesmo período e usuários do piloto.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Concordância semântica com o Nino atual</h3>
              <p className="text-xs text-muted-foreground">
                Quanto o provider alternativo tomou a mesma decisão conversacional que o provider oficial em cada parte do contrato.
              </p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={semanticBars}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => percent(v)} />
                  <Bar dataKey="value" name={`${shadowName} × ${officialName}`} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              “Pedido” compara a reconstrução do pedido completo; “Contexto” compara categoria, estabelecimento, meta e período; “Ação” compara o tipo de escrita escolhido.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
