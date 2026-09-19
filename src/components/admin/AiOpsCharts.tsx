import type { ReactNode } from "react";
import { Activity, Gauge, Sparkles, Zap } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
type TooltipPayload = Array<{ payload?: ChartRow }>;
type MetricKey = keyof ChartRow;

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

function sum(rows: ChartRow[], key: MetricKey): number {
  return rows.reduce((acc, row) => {
    if (row[key] == null) return acc;
    const value = Number(row[key]);
    return Number.isFinite(value) ? acc + value : acc;
  }, 0);
}

function lastWith(rows: ChartRow[], keys: MetricKey[]): ChartRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (keys.some((key) => rows[i][key] != null)) return rows[i];
  }
  return null;
}

function measuredRows(rows: ChartRow[], keys: MetricKey[]): ChartRow[] {
  return rows.filter((row) => keys.some((key) => {
    const value = row[key];
    return value != null && Number.isFinite(Number(value));
  }));
}

function MetricStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border/50 overflow-hidden rounded-2xl bg-muted/30 ring-1 ring-inset ring-border/40">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-3 py-2.5 sm:px-4">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px]">
            {item.label}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold tabular-nums tracking-tight text-foreground sm:text-base">
            {item.value}
          </p>
        </div>
      ))}
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
    <div className="min-w-[210px] rounded-2xl border border-border/70 bg-card/95 p-3 shadow-2xl backdrop-blur-xl">
      <p className="mb-2 text-sm font-semibold tracking-tight text-foreground">{fullDayLabel(row.day)}</p>
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
  metrics,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-3.5 px-4 pb-1 pt-4 sm:px-5 sm:pt-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-[0_8px_22px_-14px_hsl(var(--primary))]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground sm:text-base">{title}</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground sm:text-xs">{subtitle}</p>
        </div>
      </div>
      <MetricStrip items={metrics} />
    </div>
  );
}

function PremiumCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-[24px] border border-border/55 bg-card/95 shadow-[0_18px_55px_-38px_rgba(15,23,42,0.55)] ${className}`}>
      {children}
    </section>
  );
}

function SeriesLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-1 pt-1 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartShell({
  children,
  empty,
  large = false,
}: {
  children: ReactNode;
  empty?: boolean;
  large?: boolean;
}) {
  return (
    <div className={`mx-2 mt-2 overflow-hidden rounded-2xl bg-gradient-to-b from-muted/20 to-transparent px-1 pt-2 sm:mx-3 sm:px-2 ${large ? "h-[250px] sm:h-[290px]" : "h-[220px] sm:h-[260px]"}`}>
      {empty ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          Ainda não há telemetria suficiente para desenhar esta série.
        </div>
      ) : children}
    </div>
  );
}

const axisTick = { fontSize: 10, fill: C.muted } as const;
const commonMargin = { top: 10, right: 8, left: 0, bottom: 0 };

export function AiOpsCharts({
  series,
  coverage,
  className = "",
}: {
  series: AiOpsPoint[];
  coverage?: Coverage;
  className?: string;
}) {
  const observedAi = (series ?? []).find((source) =>
    Number(source.ai_calls ?? 0) > 0
    || Number(source.tokens_total ?? 0) > 0
    || source.ai_p50_latency_ms != null
    || source.ai_p95_latency_ms != null
  );
  const firstAiDay = observedAi?.day
    ?? (String(coverage?.first_ai_usage_at ?? "").slice(0, 10) || null);

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

  // Recharts intentionally breaks a line on nulls. For sparse telemetry that
  // creates disconnected visual fragments that look like a rendering bug.
  // Plot only genuinely measured dates instead: missing days are skipped on the
  // x-axis and are never converted into fake zeroes.
  const tokenRows = measuredRows(rows, ["tokens_in", "tokens_out", "tokens_total"]);
  const aiRows = measuredRows(rows, ["ai_p50_latency_ms", "ai_p95_latency_ms", "ai_avg_latency_ms"]);
  const runRows = measuredRows(rows, ["run_p50_latency_ms", "run_p95_latency_ms", "run_avg_latency_ms"]);

  const tokenTotal = sum(rows, "tokens_total");
  const inputTotal = sum(rows, "tokens_in");
  const callTotal = sum(rows, "ai_calls");
  const inputShare = tokenTotal > 0 ? (inputTotal / tokenTotal) * 100 : null;
  const tokenPerCall = callTotal > 0 ? tokenTotal / callTotal : null;
  const latestAi = lastWith(aiRows, ["ai_p50_latency_ms", "ai_p95_latency_ms"]);
  const latestRun = lastWith(runRows, ["run_p50_latency_ms", "run_p95_latency_ms"]);
  const partialCoverage = Number(coverage?.days_with_runs ?? 0) > Number(coverage?.days_with_ai_usage ?? 0);

  const aiDots = aiRows.length <= 12 ? { r: 2.2, strokeWidth: 0 } : false;
  const runDots = runRows.length <= 12 ? { r: 2.2, strokeWidth: 0 } : false;
  const tokenDots = tokenRows.length <= 12 ? { r: 2.2, strokeWidth: 0 } : false;

  return (
    <div className={`grid min-w-0 gap-4 lg:grid-cols-2 ${className}`}>
      <PremiumCard>
        <CardHeader
          icon={<Zap size={17} />}
          title="Consumo de tokens por dia"
          subtitle="Somente dias com telemetria válida. Lacunas históricas são omitidas — nunca transformadas em consumo zero."
          metrics={[
            { label: "Total", value: compact(tokenTotal) },
            { label: "% entrada", value: pct(inputShare) },
            { label: "Por chamada", value: compact(tokenPerCall) },
          ]}
        />
        <ChartShell empty={tokenRows.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenRows} margin={commonMargin}>
              <defs>
                <linearGradient id="ai-token-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.primary} stopOpacity={0.2} />
                  <stop offset="88%" stopColor={C.primary} stopOpacity={0.015} />
                </linearGradient>
                <linearGradient id="ai-token-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.danger} stopOpacity={0.1} />
                  <stop offset="88%" stopColor={C.danger} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 7" vertical={false} stroke={C.border} strokeOpacity={0.5} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={34} tickMargin={9} />
              <YAxis width={54} tick={axisTick} tickLine={false} axisLine={false} tickMargin={6} domain={[0, "auto"]} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip content={<DayTooltip mode="tokens" />} cursor={{ stroke: C.border, strokeDasharray: "2 5" }} />
              <Area
                type="linear"
                dataKey="tokens_in"
                name="Entrada"
                stroke={C.primary}
                strokeWidth={2.35}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#ai-token-in)"
                dot={tokenDots}
                activeDot={{ r: 4, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey="tokens_out"
                name="Saída"
                stroke={C.danger}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#ai-token-out)"
                dot={tokenDots}
                activeDot={{ r: 4, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
        <SeriesLegend items={[
          { label: "Entrada", color: C.primary },
          { label: "Saída", color: C.danger },
        ]} />
        <p className="px-5 pb-4 pt-1 text-[10px] leading-relaxed text-muted-foreground sm:text-[11px]">
          {partialCoverage
            ? "Cobertura parcial no período: o eixo mostra apenas os dias realmente medidos."
            : "Cobertura de provider consistente no período selecionado."}
        </p>
      </PremiumCard>

      <PremiumCard>
        <CardHeader
          icon={<Gauge size={17} />}
          title="Latência de IA por dia"
          subtitle="Tempo do modelo/provider nos dias em que existe medição válida."
          metrics={[
            { label: "Mediana", value: seconds(latestAi?.ai_p50_latency_ms) },
            { label: "P95", value: seconds(latestAi?.ai_p95_latency_ms) },
            { label: "Média", value: seconds(latestAi?.ai_avg_latency_ms) },
          ]}
        />
        <ChartShell empty={aiRows.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={aiRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="2 7" vertical={false} stroke={C.border} strokeOpacity={0.5} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={34} tickMargin={9} />
              <YAxis width={54} tick={axisTick} tickLine={false} axisLine={false} tickMargin={6} domain={[0, "auto"]} tickFormatter={(v) => seconds(Number(v))} />
              <Tooltip content={<DayTooltip mode="ai" />} cursor={{ stroke: C.border, strokeDasharray: "2 5" }} />
              <Line type="linear" dataKey="ai_p50_latency_ms" name="Mediana" stroke={C.primary} strokeWidth={2.35} strokeLinecap="round" strokeLinejoin="round" dot={aiDots} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
              <Line type="linear" dataKey="ai_p95_latency_ms" name="P95" stroke={C.danger} strokeWidth={2.05} strokeLinecap="round" strokeLinejoin="round" dot={aiDots} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
              <Line type="linear" dataKey="ai_avg_latency_ms" name="Média" stroke={C.success} strokeWidth={1.75} strokeOpacity={0.9} strokeLinecap="round" strokeLinejoin="round" dot={aiDots} activeDot={{ r: 3.8, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
        <SeriesLegend items={[
          { label: "Mediana", color: C.primary },
          { label: "P95", color: C.danger },
          { label: "Média", color: C.success },
        ]} />
        <p className="px-5 pb-4 pt-1 text-[10px] leading-relaxed text-muted-foreground sm:text-[11px]">
          Última leitura com telemetria de IA: {latestAi ? fullDayLabel(latestAi.day) : "—"}.
        </p>
      </PremiumCard>

      <PremiumCard className="lg:col-span-2">
        <CardHeader
          icon={<Activity size={17} />}
          title="Latência ponta a ponta por dia"
          subtitle="Tempo do run completo no backend: interpretação, ferramentas, regras e geração da resposta."
          metrics={[
            { label: "Mediana", value: seconds(latestRun?.run_p50_latency_ms) },
            { label: "P95", value: seconds(latestRun?.run_p95_latency_ms) },
            { label: "Média", value: seconds(latestRun?.run_avg_latency_ms) },
          ]}
        />
        <ChartShell empty={runRows.length === 0} large>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={runRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="2 7" vertical={false} stroke={C.border} strokeOpacity={0.5} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={34} tickMargin={9} />
              <YAxis width={54} tick={axisTick} tickLine={false} axisLine={false} tickMargin={6} domain={[0, "auto"]} tickFormatter={(v) => seconds(Number(v))} />
              <Tooltip content={<DayTooltip mode="run" />} cursor={{ stroke: C.border, strokeDasharray: "2 5" }} />
              <Line type="linear" dataKey="run_p50_latency_ms" name="Mediana" stroke={C.primary} strokeWidth={2.35} strokeLinecap="round" strokeLinejoin="round" dot={runDots} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
              <Line type="linear" dataKey="run_p95_latency_ms" name="P95" stroke={C.danger} strokeWidth={2.05} strokeLinecap="round" strokeLinejoin="round" dot={runDots} activeDot={{ r: 4, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
              <Line type="linear" dataKey="run_avg_latency_ms" name="Média" stroke={C.success} strokeWidth={1.75} strokeOpacity={0.9} strokeLinecap="round" strokeLinejoin="round" dot={runDots} activeDot={{ r: 3.8, strokeWidth: 2, fill: C.card }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
        <SeriesLegend items={[
          { label: "Mediana", color: C.primary },
          { label: "P95", color: C.danger },
          { label: "Média", color: C.success },
        ]} />
        <div className="mx-4 mb-4 mt-2 flex items-start gap-2 rounded-2xl bg-muted/25 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground ring-1 ring-inset ring-border/35 sm:mx-5 sm:text-[11px]">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
          <p>Esta métrica mede o backend do Nino. Rede móvel, navegador e renderização no aparelho ficam fora dela.</p>
        </div>
      </PremiumCard>
    </div>
  );
}
