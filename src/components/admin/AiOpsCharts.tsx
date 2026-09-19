import type { ReactNode } from "react";
import { Activity, Gauge, Zap } from "lucide-react";
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

type ChartRow = AiOpsPoint & { label: string; ts: number };
type MetricKey = keyof ChartRow;
type TooltipMode = "tokens" | "ai" | "run";
type TooltipPayload = Array<{ payload?: ChartRow }>;

const C = {
  primary: "hsl(var(--primary))",
  danger: "hsl(var(--destructive))",
  success: "hsl(var(--success))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
  card: "hsl(var(--card))",
};

const DAY_MS = 86_400_000;

const dayLabel = (day: string) => `${String(day).slice(8, 10)}/${String(day).slice(5, 7)}`;
const fullDayLabel = (day: string) => {
  const value = String(day ?? "").slice(0, 10);
  const hit = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return hit ? `${hit[3]}/${hit[2]}/${hit[1]}` : value;
};
const dayTimestamp = (day: string) => {
  const hit = String(day ?? "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return hit ? Date.UTC(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3])) : 0;
};
const timestampLabel = (value: number) => {
  const date = new Date(Number(value));
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const int = (value: number | null | undefined) => value == null
  ? "—"
  : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const compact = (value: number | null | undefined) => value == null
  ? "—"
  : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
const seconds = (value: number | null | undefined) => value == null
  ? "—"
  : `${(Number(value) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
const axisSeconds = (value: number) => {
  const sec = Number(value) / 1000;
  if (sec === 0) return "0s";
  return `${sec.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}s`;
};

function measuredRows(rows: ChartRow[], keys: MetricKey[]): ChartRow[] {
  return rows.filter((row) => keys.some((key) => {
    const value = row[key];
    return value != null && Number.isFinite(Number(value));
  }));
}

function DayTooltip({ active, payload, mode }: {
  active?: boolean;
  payload?: TooltipPayload;
  mode: TooltipMode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const items: Array<[string, string]> = [["Conversas", int(row.interactions)]];
  if (mode === "tokens") {
    items.push(
      ["Tokens no dia", int(row.tokens_total)],
      ["Entrada", int(row.tokens_in)],
      ["Saída", int(row.tokens_out)],
      ["Tokens por conversa", int(row.tokens_per_interaction)],
    );
  } else if (mode === "ai") {
    items.push(
      ["Mediana", seconds(row.ai_p50_latency_ms)],
      ["P95", seconds(row.ai_p95_latency_ms)],
      ["Média", seconds(row.ai_avg_latency_ms)],
    );
  } else {
    items.push(
      ["Mediana", seconds(row.run_p50_latency_ms)],
      ["P95", seconds(row.run_p95_latency_ms)],
      ["Média", seconds(row.run_avg_latency_ms)],
    );
  }

  return (
    <div className="min-w-[210px] rounded-2xl border border-border/70 bg-card/95 p-3.5 shadow-xl backdrop-blur-md">
      <p className="mb-2.5 text-sm font-semibold tracking-tight text-foreground">{fullDayLabel(row.day)}</p>
      <dl className="space-y-1.5">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-5 text-xs">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChartCard({
  icon,
  title,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center text-primary">{icon}</span>
        <h3 className="text-[16px] font-semibold tracking-tight text-foreground sm:text-[17px]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SeriesLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-[13px]">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="relative inline-block h-3 w-5" aria-hidden="true">
            <span className="absolute left-0 right-0 top-[5px] h-[2px] rounded-full" style={{ backgroundColor: item.color }} />
            <span
              className="absolute left-1/2 top-[2px] h-2 w-2 -translate-x-1/2 rounded-full border-2"
              style={{ borderColor: item.color, backgroundColor: C.card }}
            />
          </span>
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function ChartFrame({ children, empty, tall = false }: { children: ReactNode; empty?: boolean; tall?: boolean }) {
  return (
    <div className={`min-w-0 ${tall ? "h-[292px] sm:h-[320px]" : "h-[278px] sm:h-[310px]"}`}>
      {empty ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          Ainda não há telemetria suficiente para desenhar esta série.
        </div>
      ) : children}
    </div>
  );
}

const axisTick = { fontSize: 11, fill: C.muted } as const;
const commonMargin = { top: 8, right: 8, left: 0, bottom: 0 };

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
      ts: dayTimestamp(source.day),
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

  // Keep only genuinely measured values, but preserve their real calendar
  // position on a numeric time axis. This keeps sparse telemetry truthful while
  // allowing a continuous, smooth line instead of disconnected fragments.
  const tokenRows = measuredRows(rows, ["tokens_in", "tokens_out", "tokens_total"]);
  const aiRows = measuredRows(rows, ["ai_p50_latency_ms", "ai_p95_latency_ms", "ai_avg_latency_ms"]);
  const runRows = measuredRows(rows, ["run_p50_latency_ms", "run_p95_latency_ms", "run_avg_latency_ms"]);

  const validTimestamps = rows.map((row) => row.ts).filter((value) => Number.isFinite(value) && value > 0);
  const minTs = validTimestamps.length ? Math.min(...validTimestamps) : Date.now() - DAY_MS;
  const maxTs = validTimestamps.length ? Math.max(...validTimestamps) : Date.now();
  const xDomain: [number, number] = minTs === maxTs
    ? [minTs - DAY_MS, maxTs + DAY_MS]
    : [minTs, maxTs];

  const xAxis = (
    <XAxis
      type="number"
      scale="time"
      dataKey="ts"
      domain={xDomain}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
      tickFormatter={timestampLabel}
      tickCount={5}
      minTickGap={28}
      tickMargin={10}
    />
  );

  return (
    <div className={`grid min-w-0 gap-4 xl:grid-cols-2 ${className}`}>
      <ChartCard icon={<Zap size={19} />} title="Consumo de tokens por dia">
        <ChartFrame empty={tokenRows.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenRows} margin={commonMargin}>
              <defs>
                <linearGradient id="nino-token-input" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.primary} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={C.primary} stopOpacity={0.015} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={C.border} strokeOpacity={0.72} />
              {xAxis}
              <YAxis
                width={56}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                domain={[0, "auto"]}
                tickFormatter={(value) => compact(Number(value))}
              />
              <Tooltip content={<DayTooltip mode="tokens" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Area
                type="monotone"
                dataKey="tokens_in"
                name="Entrada"
                stroke={C.primary}
                strokeWidth={2.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#nino-token-input)"
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="tokens_out"
                name="Saída"
                stroke={C.danger}
                strokeWidth={2.35}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="transparent"
                dot={false}
                activeDot={{ r: 4.2, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>
        <SeriesLegend items={[
          { label: "Entrada", color: C.primary },
          { label: "Saída", color: C.danger },
        ]} />
      </ChartCard>

      <ChartCard icon={<Gauge size={19} />} title="Latência de IA por dia (tempo do modelo)">
        <ChartFrame empty={aiRows.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={aiRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={C.border} strokeOpacity={0.72} />
              {xAxis}
              <YAxis
                width={52}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                domain={[0, "auto"]}
                tickFormatter={(value) => axisSeconds(Number(value))}
              />
              <Tooltip content={<DayTooltip mode="ai" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Line
                type="monotone"
                dataKey="ai_p50_latency_ms"
                name="Mediana"
                stroke={C.primary}
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="ai_p95_latency_ms"
                name="P95"
                stroke={C.danger}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4.2, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="ai_avg_latency_ms"
                name="Média"
                stroke={C.success}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
        <SeriesLegend items={[
          { label: "Mediana", color: C.primary },
          { label: "P95", color: C.danger },
          { label: "Média", color: C.success },
        ]} />
      </ChartCard>

      <ChartCard className="xl:col-span-2" icon={<Activity size={19} />} title="Latência ponta a ponta por dia">
        <ChartFrame empty={runRows.length === 0} tall>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={runRows} margin={commonMargin}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={C.border} strokeOpacity={0.72} />
              {xAxis}
              <YAxis
                width={52}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                domain={[0, "auto"]}
                tickFormatter={(value) => axisSeconds(Number(value))}
              />
              <Tooltip content={<DayTooltip mode="run" />} cursor={{ stroke: C.border, strokeDasharray: "3 5" }} />
              <Line
                type="monotone"
                dataKey="run_p50_latency_ms"
                name="Mediana"
                stroke={C.primary}
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="run_p95_latency_ms"
                name="P95"
                stroke={C.danger}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4.2, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="run_avg_latency_ms"
                name="Média"
                stroke={C.success}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: C.card }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
        <SeriesLegend items={[
          { label: "Mediana", color: C.primary },
          { label: "P95", color: C.danger },
          { label: "Média", color: C.success },
        ]} />
      </ChartCard>
    </div>
  );
}
