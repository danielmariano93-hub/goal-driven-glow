import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export type ChartSeries = {
  key: string;
  label: string;
  color?: string;
};

/**
 * Gráfico único do admin: linha suave, eixos discretos, poucas séries.
 * Sempre acompanhado de período e universo — número sem contexto não entra.
 */
export function AdminChart({
  data,
  xKey,
  series,
  caption,
  height = 220,
  formatValue,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: ChartSeries[];
  caption?: string;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const palette = ["hsl(var(--primary))", "#2FC99A", "#FF6B5F"];

  if (!data?.length) {
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        Sem movimento no período selecionado.
      </p>
    );
  }

  return (
    <figure className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatValue ? formatValue(value) : value,
                series.find((s) => s.key === name)?.label ?? name,
              ]}
              contentStyle={{
                borderRadius: 18,
                border: "1px solid hsl(var(--border))",
                fontSize: 12,
              }}
            />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color ?? palette[i % palette.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color ?? palette[i % palette.length] }}
            />
            {s.label}
          </span>
        ))}
        {caption && <span className="w-full">{caption}</span>}
      </figcaption>
    </figure>
  );
}
