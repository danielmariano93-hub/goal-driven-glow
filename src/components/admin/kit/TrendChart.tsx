import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

export type Tone = "primary" | "success" | "danger" | "muted";

const COLOR: Record<Tone, string> = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  danger: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
};

export type TrendSeries = { key: string; label: string; tone?: Tone };

/**
 * Gráfico único do admin, em duas variações: área (evolução) e barra empilhada
 * (composição por dia). Cores sempre por token semântico.
 */
export function TrendChart({
  data,
  xKey,
  series,
  kind = "area",
  height = 240,
  caption,
  emptyLabel = "Sem movimento no período selecionado.",
  formatValue,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: TrendSeries[];
  kind?: "area" | "bar";
  height?: number;
  caption?: string;
  emptyLabel?: string;
  formatValue?: (value: number) => string;
}) {
  if (!data?.length) {
    return (
      <p className="surface-card px-4 py-8 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
  const tooltip = {
    contentStyle: {
      borderRadius: 16,
      border: "1px solid hsl(var(--border))",
      background: "hsl(var(--card))",
      fontSize: 12,
    },
    formatter: (value: number, name: string) => [
      formatValue ? formatValue(value) : value.toLocaleString("pt-BR"),
      series.find((s) => s.key === name)?.label ?? name,
    ],
  };

  return (
    <figure className="surface-card p-4">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="a"
                  radius={[4, 4, 0, 0]}
                  fill={COLOR[s.tone ?? "primary"]}
                />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR[s.tone ?? "primary"]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={COLOR[s.tone ?? "primary"]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={COLOR[s.tone ?? "primary"]}
                  strokeWidth={2}
                  fill={`url(#grad-${s.key})`}
                  dot={false}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {caption && <figcaption className="mt-3 text-[11px] text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
