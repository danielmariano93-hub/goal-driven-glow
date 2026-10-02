import { useId } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export type SmoothSeries = {
  key: string;
  label: string;
  /** Padrão: linha suave. "area" preenche com gradiente; "bar" usa colunas. */
  kind?: "line" | "area" | "bar";
  color?: string;
  /** "right" usa um segundo eixo (ex.: custo ao lado de tokens). */
  axis?: "left" | "right";
  format?: (value: number) => string;
  dashed?: boolean;
};

const PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
];

type TooltipPayload = { dataKey?: string; value?: number; color?: string };

function ChartTooltip({
  active, payload, label, series, formatLabel,
}: {
  active?: boolean; payload?: TooltipPayload[]; label?: string; series: SmoothSeries[]; formatLabel?: (v: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1 font-semibold text-foreground">{formatLabel ? formatLabel(String(label)) : label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => {
          const s = series.find((x) => x.key === p.dataKey);
          if (!s || p.value == null) return null;
          return (
            <li key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
              <span>{s.label}</span>
              <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
                {s.format ? s.format(Number(p.value)) : Number(p.value).toLocaleString("pt-BR")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Gráfico do admin: linhas suaves (monotone), áreas com gradiente e colunas num só
 * componente, com um segundo eixo opcional. Sem moldura: quem usa decide o cartão.
 */
export function SmoothChart({
  data, xKey, series, height = 220, formatX, formatY, formatYRight, emptyLabel = "Sem dados no período.",
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: SmoothSeries[];
  height?: number;
  formatX?: (value: string) => string;
  formatY?: (value: number) => string;
  formatYRight?: (value: number) => string;
  emptyLabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  if (!data?.length) {
    return <p className="grid place-items-center rounded-2xl bg-secondary/40 text-xs text-muted-foreground" style={{ height }}>{emptyLabel}</p>;
  }
  const hasRight = series.some((s) => s.axis === "right");
  const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
  const colorOf = (s: SmoothSeries, i: number) => s.color ?? PALETTE[i % PALETTE.length];

  return (
    <div style={{ height }} role="img" aria-label={`Gráfico: ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 4 : 8, left: -14, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={0.32} />
                <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
          <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={22} tickFormatter={formatX} />
          <YAxis yAxisId="left" tick={axis} tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={formatY} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tick={axis} tickLine={false} axisLine={false} width={52} tickFormatter={formatYRight} />}
          <Tooltip cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "3 3" }} content={<ChartTooltip series={series} formatLabel={formatX} />} />
          {series.map((s, i) => {
            const color = colorOf(s, i);
            const yAxisId = s.axis === "right" ? "right" : "left";
            if (s.kind === "bar") {
              return <Bar key={s.key} dataKey={s.key} yAxisId={yAxisId} fill={color} fillOpacity={0.85} radius={[6, 6, 0, 0]} maxBarSize={22} />;
            }
            if (s.kind === "area") {
              return (
                <Area key={s.key} dataKey={s.key} yAxisId={yAxisId} type="monotone" stroke={color} strokeWidth={2.2}
                  fill={`url(#${uid}-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              );
            }
            return (
              <Line key={s.key} dataKey={s.key} yAxisId={yAxisId} type="monotone" stroke={color} strokeWidth={2.2}
                strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend({ series }: { series: SmoothSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {series.map((s, i) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
