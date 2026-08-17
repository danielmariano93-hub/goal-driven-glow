import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

export type Polarity = "higher_is_better" | "lower_is_better" | "neutral";

/**
 * Número que decide: valor grande, variação com polaridade e tendência visual.
 * Um por linha no celular, quatro por linha no desktop.
 */
export function MetricTile({
  label,
  value,
  deltaPct,
  polarity = "neutral",
  spark,
  hint,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  deltaPct?: number | null;
  polarity?: Polarity;
  spark?: number[];
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  const delta = deltaPct ?? null;
  const good =
    delta === null || delta === 0 || polarity === "neutral"
      ? null
      : polarity === "higher_is_better"
        ? delta > 0
        : delta < 0;

  const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaTone =
    good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const sparkTone =
    good === null ? "hsl(var(--primary))" : good ? "hsl(var(--success))" : "hsl(var(--destructive))";

  const series = (spark ?? []).map((v, i) => ({ i, v }));

  return (
    <div
      className={`surface-card flex min-w-0 flex-col justify-between p-4 ${
        emphasis ? "border-primary/30" : ""
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums leading-none md:text-3xl">
        {value}
      </p>
      <div className={`mt-2 flex items-center gap-1 text-xs ${deltaTone}`}>
        <Icon size={12} aria-hidden />
        <span className="truncate">
          {delta === null
            ? "sem comparação anterior"
            : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs período anterior`}
        </span>
      </div>
      {series.length > 1 && (
        <div className="mt-3 h-10" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkTone} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={sparkTone} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={sparkTone}
                strokeWidth={1.8}
                fill={`url(#spark-${label.replace(/\W/g, "")})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {hint && <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
