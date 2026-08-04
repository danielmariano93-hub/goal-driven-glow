import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, ArrowRight, ChevronDown, Minus } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { EXCLUSION_REASON_LABEL, formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";

type Trend = "up" | "down" | "stable";

function Badge({ trend, deltaPct }: { trend: Trend; deltaPct: number | null }) {
  if (deltaPct == null || Math.abs(deltaPct) < 1) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ background: "var(--home-neutral-bg)", color: "var(--home-text-2)" }}
      >
        {deltaPct == null ? "Sem base" : <><Minus size={10} /> Estável</>}
      </span>
    );
  }
  const bad = trend === "up";
  const Icon = bad ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
      style={{
        background: bad ? "var(--home-neg-bg)" : "var(--home-pos-bg)",
        color: bad ? "var(--home-neg)" : "var(--home-pos)",
      }}
    >
      <Icon size={10} /> {deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

function shortDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

type Props = {
  rhythm: RhythmComparison | null;
  projection: SpendingProjection | null;
  card: { value: number; trend: Trend; deltaPct: number | null };
  loading?: boolean;
};

/**
 * Card único de ritmo da Home. O número protagonista é o RITMO ATUAL do mês
 * (`projection.currentDailyPace`) — a mesma definição usada na projeção e no
 * assessor. O ritmo típico aparece rotulado, nunca com o mesmo nome.
 */
export function RitmoUnificadoCard({ rhythm, projection, card, loading }: Props) {
  const [open, setOpen] = useState(false);
  const cur = rhythm?.current;
  const prev = rhythm?.previous;

  const data = (cur?.series ?? []).map((p) => ({
    label: shortDay(p.date),
    gastoDoDia: p.grossAmount,
    mediaTotal: p.runningAverage,
    ritmoTipico: p.typicalRunningAverage,
  }));
  const hasData = data.length > 0 && (cur?.totalGross ?? 0) > 0;

  return (
    <section
      aria-label="Seu ritmo neste período"
      className="rounded-[18px] bg-[color:var(--home-surface)]"
      style={{ border: "1px solid var(--home-hairline)", boxShadow: "var(--shadow-soft)" }}
    >
      <div className="flex items-end justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
            Ritmo atual
          </p>
          <p
            className="mt-1 truncate font-display font-extrabold tabular-nums"
            style={{ fontSize: 26, lineHeight: 1.05, letterSpacing: "-0.025em", color: "var(--home-text-1)" }}
          >
            {loading || !projection ? "—" : formatBRL(projection.currentDailyPace)}
            <span className="text-[13px] font-semibold" style={{ color: "var(--home-text-2)" }}>/dia</span>
          </p>
          <p className="mt-1 truncate text-[11px] tabular-nums" style={{ color: "var(--home-text-2)" }}>
            {projection
              ? `Ritmo típico ${formatBRL(projection.typicalDailyPace)}/dia · mês até hoje (${projection.daysElapsed} dia(s))`
              : "Calculando"}
          </p>
        </div>
        <div className="shrink-0 pb-1">
          <Badge trend={rhythm?.typicalTrend ?? "stable"} deltaPct={rhythm?.typicalDeltaPct ?? null} />
        </div>
      </div>


      <div className="px-1 pt-2">
        {loading ? (
          <div className="mx-3 h-[132px] animate-pulse rounded-xl" style={{ background: "var(--home-neutral-bg)" }} />
        ) : !hasData ? (
          <div className="grid h-[110px] place-items-center px-6 text-center text-[12px]" style={{ color: "var(--home-text-2)" }}>
            Assim que você lançar o primeiro gasto, o ritmo aparece aqui.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={132}>
            <AreaChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="ritmoUniFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--home-brand-violet)" stopOpacity={0.26} />
                  <stop offset="100%" stopColor="var(--home-brand-violet)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--home-hairline)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--home-text-3)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ stroke: "var(--home-hairline)" }}
                formatter={(value: number, name: string) => [
                  formatBRL(Number(value)),
                  name === "gastoDoDia" ? "Gasto do dia" : name === "mediaTotal" ? "Média até o dia" : "Ritmo típico",
                ]}
                labelFormatter={(l) => `Dia ${l}`}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--home-hairline)", fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="gastoDoDia"
                stroke="var(--home-brand-violet)"
                strokeWidth={1.5}
                fill="url(#ritmoUniFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line type="monotone" dataKey="ritmoTipico" stroke="var(--home-pos)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1 px-4 py-2 text-[11px] font-semibold"
          style={{ color: "var(--home-text-2)" }}
        >
          {open ? "Ocultar detalhes" : "Ver detalhes"}
          <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>

        {open && cur ? (
          <div className="space-y-2 px-4 pb-3 text-[11px]" style={{ color: "var(--home-text-2)" }}>
            <div className="rounded-lg p-2" style={{ background: "var(--home-neutral-bg)" }}>
              <div className="flex justify-between tabular-nums">
                <span>Média total do período</span>
                <span className="font-semibold">{formatBRL(cur.average)}/dia</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span>Consumo líquido</span>
                <span className="font-semibold">{formatBRL(cur.total)}</span>
              </div>
              {cur.totalRefunds > 0 ? (
                <div className="flex justify-between tabular-nums">
                  <span>Estornos e reembolsos</span>
                  <span className="font-semibold">− {formatBRL(cur.totalRefunds)}</span>
                </div>
              ) : null}
              <div className="flex justify-between tabular-nums">
                <span>Compras no cartão</span>
                <span className="font-semibold">{formatBRL(card.value)}</span>
              </div>
            </div>
            <p>
              Comparado com {prev ? formatRangeShort(prev.range) : "—"}. Dias sem gasto entram na média. Compras no
              cartão são histórico, não a dívida da fatura. Pagamento de fatura, transferências entre suas contas,
              aplicações e resgates nunca contam como gasto.
            </p>
            {cur.excludedByReason.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {cur.excludedByReason.map((g) => (
                  <span
                    key={g.reason}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                    style={{ background: "var(--home-neutral-bg)", color: "var(--home-text-2)" }}
                  >
                    {g.label} · {g.count}x · {formatBRL(g.total)}
                  </span>
                ))}
              </div>
            ) : null}
            {cur.excluded.length > 0 ? (
              <ul className="space-y-1">
                {cur.excluded.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {e.label}{" "}
                      <span style={{ color: "var(--home-text-3)" }}>
                        · {EXCLUSION_REASON_LABEL[e.reason] ?? e.reason}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatBRL(e.amount)}</span>
                  </li>
                ))}
                {cur.excluded.length > 3 ? (
                  <li style={{ color: "var(--home-text-3)" }}>+{cur.excluded.length - 3} outros</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
          <Link
            to="/app/relatorios"
            className="flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-bold hover:underline"
            style={{ color: "var(--home-brand-violet)" }}
          >
            Ver rotina e como o saldo mudou <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
