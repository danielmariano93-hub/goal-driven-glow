import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";

function shortDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

type Props = { rhythm: RhythmComparison | null; loading?: boolean };

/**
 * "Ritmo de gastos no período" — linha suave do consumo acumulado dia a dia,
 * com a média acumulada como referência. Substitui a antiga Evolução mensal.
 */
export function RitmoGastosCard({ rhythm, loading }: Props) {
  const cur = rhythm?.current;
  const data = (cur?.series ?? []).map((p) => ({
    date: p.date,
    label: shortDay(p.date),
    acumulado: p.cumulative,
    media: p.runningAverage,
  }));

  const hasData = data.length > 0 && (cur?.total ?? 0) > 0;

  return (
    <section
      aria-label="Ritmo de gastos no período"
      className="rounded-[18px] bg-[color:var(--home-surface)]"
      style={{ border: "1px solid var(--home-hairline)", boxShadow: "var(--shadow-soft)" }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
            Ritmo de gastos no período
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--home-text-2)" }}>
            {cur ? `${formatRangeShort(cur.range)} · acumulado até hoje` : "Calculando"}
          </p>
        </div>
        <p
          className="shrink-0 font-display font-extrabold tabular-nums"
          style={{ fontSize: 18, letterSpacing: "-0.02em", color: "var(--home-text-1)" }}
        >
          {loading || !cur ? "—" : formatBRL(cur.total)}
        </p>
      </div>

      <div className="px-1 pt-2">
        {loading ? (
          <div className="h-[168px] animate-pulse rounded-xl" style={{ background: "var(--home-neutral-bg)" }} />
        ) : !hasData ? (
          <div className="grid h-[168px] place-items-center px-6 text-center text-[12px]" style={{ color: "var(--home-text-2)" }}>
            Ainda não há gastos registrados neste período. Assim que você lançar o primeiro, o ritmo aparece aqui.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={168}>
            <AreaChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="ritmoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--home-brand-violet)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--home-brand-violet)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--home-hairline)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--home-text-3)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ stroke: "var(--home-hairline)" }}
                formatter={(value: number, name: string) => [
                  formatBRL(Number(value)),
                  name === "acumulado" ? "Acumulado" : "Média por dia",
                ]}
                labelFormatter={(l) => `Dia ${l}`}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--home-hairline)",
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="acumulado"
                stroke="var(--home-brand-violet)"
                strokeWidth={2.5}
                fill="url(#ritmoFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="media"
                stroke="var(--home-text-3)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
        <Link
          to="/app/relatorios"
          className="flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-bold hover:underline"
          style={{ color: "var(--home-brand-violet)" }}
        >
          Ver relatório do período <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}
