import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus, ArrowRight, Info } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";

type Trend = "up" | "down" | "stable";

function Badge({ trend, deltaPct }: { trend: Trend; deltaPct: number | null }) {
  if (deltaPct == null) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ background: "var(--home-neutral-bg)", color: "var(--home-text-2)" }}
      >
        Sem base
      </span>
    );
  }
  if (Math.abs(deltaPct) < 1) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ background: "var(--home-neutral-bg)", color: "var(--home-text-2)" }}
      >
        <Minus size={10} /> Estável
      </span>
    );
  }
  const bad = trend === "up";
  const Icon = trend === "up" ? ArrowUpRight : ArrowDownRight;
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

function hintFor(deltaPct: number | null, trend: Trend, up: string, down: string): string {
  if (deltaPct == null) return "Sem comparação";
  if (Math.abs(deltaPct) < 1) return "No mesmo ritmo";
  return trend === "up" ? up : down;
}

const REASON_LABEL: Record<string, string> = {
  fixed: "Despesa estrutural",
  recurring: "Conta recorrente",
  installment: "Parcelamento",
  outlier: "Gasto atípico do período",
};

type Props = {
  rhythm: RhythmComparison | null;
  card: { value: number; trend: Trend; deltaPct: number | null };
  loading?: boolean;
};

export function RitmoCard({ rhythm, card, loading }: Props) {
  const [open, setOpen] = useState(false);
  const cur = rhythm?.current;
  const prev = rhythm?.previous;

  return (
    <section
      aria-label="Seu ritmo neste período"
      className="rounded-[18px] bg-[color:var(--home-surface)]"
      style={{ border: "1px solid var(--home-hairline)", boxShadow: "var(--shadow-soft)" }}
    >
      <div className="px-4 pt-2.5">
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
          Seu ritmo neste período
        </p>
      </div>

      <div className="relative flex items-stretch pb-1 pt-1">
        <Link
          to="/app/relatorios"
          className="flex min-w-0 flex-1 flex-col rounded-lg px-4 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
            Ritmo típico
          </p>
          <p
            className="mt-1 truncate font-display font-extrabold tabular-nums"
            style={{ fontSize: 20, lineHeight: 1.05, letterSpacing: "-0.025em", color: "var(--home-text-1)" }}
          >
            {loading || !cur ? "—" : formatBRL(cur.typicalAverage)}
            <span className="text-[13px] font-semibold" style={{ color: "var(--home-text-2)" }}>/dia</span>
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge trend={rhythm?.typicalTrend ?? "stable"} deltaPct={rhythm?.typicalDeltaPct ?? null} />
          </div>
          <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--home-text-2)" }}>
            {loading || !cur
              ? "Calculando"
              : `Média total ${formatBRL(cur.average)}/dia`}
          </p>
        </Link>

        <div aria-hidden className="my-3 w-px" style={{ background: "var(--home-hairline)" }} />

        <Link
          to="/app/cartoes"
          className="flex min-w-0 flex-1 flex-col rounded-lg px-4 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
            Cartão
          </p>
          <p
            className="mt-1 truncate font-display font-extrabold tabular-nums"
            style={{ fontSize: 20, lineHeight: 1.05, letterSpacing: "-0.025em", color: "var(--home-text-1)" }}
          >
            {loading ? "—" : formatBRL(card.value)}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge trend={card.trend} deltaPct={card.deltaPct} />
          </div>
          <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--home-text-2)" }}>
            {hintFor(card.deltaPct, card.trend, "Acima do anterior", "Abaixo do anterior")}
          </p>
        </Link>
      </div>

      <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1 px-4 py-1.5 text-[11px] font-semibold"
          style={{ color: "var(--home-text-2)" }}
        >
          <Info size={12} /> {open ? "Ocultar" : "O que entra nesta conta"}
        </button>

        {open && cur ? (
          <div className="space-y-2 px-4 pb-3 text-[11px]" style={{ color: "var(--home-text-2)" }}>
            <p>
              Período {formatRangeShort(cur.range)} · {cur.days} dia{cur.days === 1 ? "" : "s"} corridos (dias sem gasto
              também contam). Comparado com {prev ? formatRangeShort(prev.range) : "—"}, de mesmo tamanho.
            </p>
            <p>
              Compras no cartão entram no dia da compra. Pagamento de fatura, transferências entre suas contas,
              aplicações e resgates de investimento nunca contam como gasto.
            </p>
            <div className="rounded-lg p-2" style={{ background: "var(--home-neutral-bg)" }}>
              <div className="flex justify-between tabular-nums">
                <span>Consumo do período</span>
                <span className="font-semibold">{formatBRL(cur.total)}</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span>Fixas e atípicos fora do ritmo</span>
                <span className="font-semibold">− {formatBRL(cur.excludedTotal)}</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span>Base do ritmo típico</span>
                <span className="font-semibold">{formatBRL(cur.typicalTotal)}</span>
              </div>
            </div>
            {cur.excluded.length > 0 ? (
              <ul className="space-y-1">
                {cur.excluded.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {e.label} <span style={{ color: "var(--home-text-3)" }}>· {REASON_LABEL[e.reason] ?? e.reason}</span>
                    </span>
                    <span className="tabular-nums">{formatBRL(e.amount)}</span>
                  </li>
                ))}
                {cur.excluded.length > 5 ? (
                  <li style={{ color: "var(--home-text-3)" }}>+{cur.excluded.length - 5} outros</li>
                ) : null}
              </ul>
            ) : (
              <p>Nenhum lançamento foi retirado do ritmo típico neste período.</p>
            )}
          </div>
        ) : null}

        <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
          <Link
            to="/app/relatorios"
            className="flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-bold hover:underline"
            style={{ color: "var(--home-brand-violet)" }}
          >
            Ver análise completa <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
