import { Activity, Gauge, Sparkles, Zap } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type AiOpsPoint = {
  day: string;
  interactions: number;
  unique_users?: number;
  conversation_threads?: number;
  ai_calls: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_total: number | null;
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
  first_run_at?: string | null;
  first_ai_usage_at?: string | null;
  days_with_runs?: number;
  days_with_ai_usage?: number;
};

type ChartRow = AiOpsPoint & { label: string };
type TooltipMode = "tokens" | "ai" | "run";

type TooltipPayload = Array<{ payload: ChartRow }>;

const C = {
  primary: "hsl(var(--primary))",
  danger: "hsl(var(--destructive))",
  success: "hsl(var(--success))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
  card: "hsl(var(--card))",
};

const dayLabel = (day: string) => `${String(day).slice(8, 10)}/${String(day).slice(5, 7)}`;
const fullDayLabel = (day: string) => {
  const value = String(day ?? "").slice(0, 10);
  const hit = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return hit ? `${hit[3]}/${hit[2]}/${hit[1]}` : value;
};
const int = (value: number | null | undefined) => value == null
  ? "—"
  : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const compact = (value: number | null | undefined) => value == null
  ? "—"
  : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
const seconds = (value: number | null | undefined) => value == null
  ? "—"
  : `${(Number(value) / 1000).toFixed(Number(value) < 1000 ? 2 : 1)}s`;
const pct = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`;

function sum(rows: ChartRow[], key: keyof ChartRow): number {
  return rows.reduce((acc, row) => {
    const value = Number(row[key]);
    return Number.isFinite(value) ? acc + value : acc;
  }, 0);
}

function lastWith(rows: ChartRow[], keys: Array<keyof ChartRow>): ChartRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (keys.some((key) => rows[i][key] != null)) return rows[i];
  }
  return null;
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-background/65 px-3 py-2 shadow-sm backdrop-blur-sm">
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function DayTooltip({ active, payload, mode }: {
  active?: boolean;
  payload?: TooltipPayload;
  mode: TooltipMode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const rows: Array<[string, string]> = [["Interações", int(row.interactions)]];
  if (mode === "tokens") {
    const calls = Number(row.ai_calls ?? 0);
    const total = Number(row.tokens_total ?? 0);
    rows.push(
      ["Chamadas de IA", int(row.ai_calls)],
      ["Tokens no dia", int(row.tokens_total)],
      ["Entrada", int(row.tokens_in)],
      ["Saída", int(row.tokens_out)],
      ["Tokens / chamada", calls > 0 ? int(total / calls) : "—"],
      ["Tokens / interação", int(row.tokens_per_interaction)],
    );
  } else if (mode === "ai") {
    rows.push(
      ["Mediana", seconds(row.ai_p50_latency_ms)],
      ["P95", seconds(row.ai_p95_latency_ms)],
      ["Média", seconds(row.ai_avg_latency_ms)],
    );
  } else {
    rows.push(
      ["Mediana", seconds(row.run_p50_latency_ms)],
      ["P95", seconds(row.run_p95_latency_ms)],
      ["Média", seconds(row.run_avg_latency_ms)],
    );
  }

  return (
    <div className="min-w-[205px] rounded-2xl border border-border/70 bg-card/95 p-3 shadow-xl backdrop-blur-md">
      <p className="mb-2 text-sm font-semibold text-foreground">{fullDayLabel(row.day)}</p>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-5 text-xs">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CardHeader({
  icon,
  title,
  subtitle,
  pills,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pills: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-3 px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pills.map((pill) => <MetricPill key={pill.label} {...pill} />)}
      </div>
    </div>
  );
}

function PremiumCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-gradient-to-b from-card via-card to-muted/20 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function ChartShell({ children, height = 250 }: { children: React.ReactNode; height?: number }) {
  return <div className="min-w-0 px-1 pb-2 pt-2 sm:px-2" style={{ height }}>{children}</div>;
}

const axisTick = { fontSize: 11, fill: C.muted } as const;
const commonMargin = { top: 8, right: 14, left: 0, bottom: 0 };

export function AiOpsCharts({
  series,
  coverage,
  className = "",
}: {
  series: AiOpsPoint[];
  coverage?: Coverage;
  className?: string;
}) {
  const firstAiDay = String(coverage?.first_ai_usage_at ?? "").slice(0, 10) || null;
  const rows: ChartRow[] = (series ?? []).map((source) => {
    const beforeAiCoverage = Boolean(firstAiDay && source.day < firstAiDay);
    return {
      ...source,
      label: dayLabel(source.day),
      ai_calls: beforeAiCoverage ? null : source.ai_calls,
      tokens_in: beforeAiCoverage ? null : source.tokens_in,
      tokens_out: beforeAiCoverage ? null : source.tokens_out,
      tokens_total: beforeAiCoverage ? null : source.tokens_total,
      tokens_per_interaction: beforeAiCoverage ? null : source.tokens_per_interaction,
      ai_avg_latency_ms: beforeAiCoverage ? null : source.ai_avg_latency_ms,
      ai_p50_latency_ms: beforeAiCoverage ? null : source.ai_p50_latency_ms,
      ai_p95_latency_ms: beforeAiCoverage ? null : source.ai_p95_latency_ms,
    };
  });

  const tokenRows = rows;
  const aiRows = rows;
  const runRows = rows;
  const tokenTotal = sum(rows, "tokens_total");
  const inputTotal = sum(rows, "tokens_in");
  const callTotal = sum(rows, "ai_calls");
  const inputShare = tokenTotal > 0 ? (inputTotal / tokenTotal) * 100 : null;
  const tokenPerCall = callTotal > 0 ? tokenTotal / callTotal : null;
  const latestAi = lastWith(rows, ["ai_p50_latency_ms", "ai_p95_latency_ms"]);
  const latestRun = lastWith(rows, ["run_p50_latency_ms", "run_p95_latency_ms"]);
  const partialCoverage = Number(coverage?.days_with_runs ?? 0) > Number(coverage?.days_with_ai_usage ?? 0);

  return (
    <div className={`grid min-w-0 gap-4 xl:grid-cols-2 ${className}`}>
      <PremiumCard>
        <CardHeader
          icon={<Zap size={17} />}
          title="Consumo de tokens por dia"
          subtitle="Entrada e saída reais do provider. Dias anteriores ao início da telemetria ficam sem linha, não como consumo zero."
          pills={[
            { label: "Total", value: compact(tokenTotal) },
            { label: "Entrada", value: pct(inputShare) },
            { label: "Por chamada", value: compact(tokenPerCall) },
          ]}
        />
        <ChartShell height={285}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenRows} margin={commonMargin}>
              <defs>
                <linearGradient id="ai-token-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.primary} stopOpacity={0.26} />
                  <stop offset="90%" stopColor={C.primary} stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="ai-token-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.danger} stopOpacity={0.12} />
                  <stop offset="90%" stopColor={C.danger} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 7" vertical={false} stroke={C.border} strokeOpacity={0.7} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} tickMargin={10} />
              <YAxis width={62} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip content={<DayTooltip mode="tokens" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area
                type="monotone"
                dataKey="tokens_in"
                name="Entrada"
                stroke={C.primary}
                strokeWidth={2.4}
                fill="url(#ai-token-in)"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }}
              />
              <Area
                type="monotone"
                dataKey="tokens_out"
                name="Saída"
                stroke={C.danger}
                strokeWidth={2}
                fill="url(#ai-token-out)"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: C.card }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
        <p className="px-5 pb-4 text-[11px] leading-relaxed text-muted-foreground">
          {partialCoverage
            ? "Cobertura histórica parcial: o gráfico distingue ausência de telemetria de consumo efetivamente zerado."
            : "Cobertura de provider consistente no período selecionado."}
        </p>
      </PremiumCard>

      <PremiumCard>
        <CardHeader
          icon={<Gauge size={17} />}
          title="Latência de IA por dia"
          subtitle="Tempo apenas do modelo/provider, separado do processamento completo do Nino."
          pills={[
            { label: "Mediana", value: seconds(latestAi?.ai_p50_latency_ms) },
            { label: "P95", value: seconds(latestAi?.ai_p95_latency_ms) },
            { label: "Média", value: seconds(latestAi?.ai_avg_latency_ms) },
          ]}
        />
        <ChartShell height={285}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={aiRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="3 7" vertical={false} stroke={C.border} strokeOpacity={0.7} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} tickMargin={10} />
              <YAxis width={62} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => seconds(Number(v))} />
              <Tooltip content={<DayTooltip mode="ai" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line type="monotone" dataKey="ai_p50_latency_ms" name="Mediana" stroke={C.primary} strokeWidth={2.5} dot={false} connectNulls={false} activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }} />
              <Line type="monotone" dataKey="ai_p95_latency_ms" name="P95" stroke={C.danger} strokeWidth={2.2} dot={false} connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} />
              <Line type="monotone" dataKey="ai_avg_latency_ms" name="Média" stroke={C.success} strokeWidth={1.8} strokeOpacity={0.9} dot={false} connectNulls={false} activeDot={{ r: 3.8, strokeWidth: 2, fill: C.card }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
        <p className="px-5 pb-4 text-[11px] leading-relaxed text-muted-foreground">Última leitura com telemetria de IA: {latestAi ? fullDayLabel(latestAi.day) : "—"}.</p>
      </PremiumCard>

      <PremiumCard className="xl:col-span-2">
        <CardHeader
          icon={<Activity size={17} />}
          title="Latência ponta a ponta por dia"
          subtitle="Tempo do run completo no backend: interpretação, ferramentas, regras e geração da resposta."
          pills={[
            { label: "Mediana", value: seconds(latestRun?.run_p50_latency_ms) },
            { label: "P95", value: seconds(latestRun?.run_p95_latency_ms) },
            { label: "Média", value: seconds(latestRun?.run_avg_latency_ms) },
          ]}
        />
        <ChartShell height={310}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={runRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="3 7" vertical={false} stroke={C.border} strokeOpacity={0.7} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} tickMargin={10} />
              <YAxis width={62} tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => seconds(Number(v))} />
              <Tooltip content={<DayTooltip mode="run" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line type="monotone" dataKey="run_p50_latency_ms" name="Mediana" stroke={C.primary} strokeWidth={2.5} dot={false} connectNulls={false} activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }} />
              <Line type="monotone" dataKey="run_p95_latency_ms" name="P95" stroke={C.danger} strokeWidth={2.2} dot={false} connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} />
              <Line type="monotone" dataKey="run_avg_latency_ms" name="Média" stroke={C.success} strokeWidth={1.8} strokeOpacity={0.9} dot={false} connectNulls={false} activeDot={{ r: 3.8, strokeWidth: 2, fill: C.card }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-2xl border border-border/60 bg-background/55 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
          <p>Esta métrica mede o backend do Nino. Rede móvel, navegador e renderização no aparelho ficam fora dela.</p>
        </div>
      </PremiumCard>
    </div>
  );
}
