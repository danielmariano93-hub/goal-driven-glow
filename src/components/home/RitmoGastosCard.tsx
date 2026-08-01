import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";

function shortDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

type Props = { rhythm: RhythmComparison | null; loading?: boolean };

/**
 * Série canônica: o último ponto coincide com as métricas do resumo superior.
 */
export function RitmoGastosCard({ rhythm, loading }: Props) {
  const cur = rhythm?.current;
  const data = (cur?.series ?? []).map((p) => ({
    date: p.date,
    label: shortDay(p.date),
    gastoDoDia: p.grossAmount,
    reembolsoDoDia: p.refundAmount,
    liquidoDoDia: p.netAmount,
    mediaTotal: p.runningAverage,
    ritmoTipico: p.typicalRunningAverage,
  }));

  const hasData = data.length > 0 && (cur?.totalGross ?? 0) > 0;
  const hasRefunds = (cur?.totalRefunds ?? 0) > 0;


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
            {cur ? `${formatRangeShort(cur.range)} · dias sem gasto entram na média` : "Calculando"}
          </p>
        </div>
        <p
          className="shrink-0 font-display font-extrabold tabular-nums"
          style={{ fontSize: 18, letterSpacing: "-0.02em", color: "var(--home-text-1)" }}
        >
          {loading || !cur ? "—" : `${formatBRL(cur.average)}/dia`}
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
                  name === "gastoDoDia"
                    ? "Gasto do dia"
                    : name === "mediaTotal"
                      ? "Média total até o dia"
                      : "Ritmo típico até o dia",
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
                dataKey="gastoDoDia"
                stroke="var(--home-brand-violet)"
                strokeWidth={1.5}
                fill="url(#ritmoFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="mediaTotal"
                stroke="var(--home-text-3)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="ritmoTipico"
                stroke="var(--home-pos)"
                strokeWidth={2}
                dot={false}
              />
              <Legend
                iconType="line"
                wrapperStyle={{ fontSize: 10 }}
                formatter={(name) => name === "gastoDoDia" ? "Gasto do dia" : name === "mediaTotal" ? "Média total" : "Ritmo típico"}
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
