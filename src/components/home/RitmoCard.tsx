import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus, ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";

type Trend = "up" | "down" | "stable";

type Metric = {
  label: string;
  value: number;
  suffix?: string;
  trend: Trend;
  deltaPct: number | null;
  hint: string;
  to: string;
  higherIsWorse?: boolean;
  loading?: boolean;
};

function Badge({ trend, deltaPct, higherIsWorse = true }: Pick<Metric, "trend" | "deltaPct" | "higherIsWorse">) {
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
  const bad = higherIsWorse ? trend === "up" : trend === "down";
  const bg = bad ? "var(--home-neg-bg)" : "var(--home-pos-bg)";
  const color = bad ? "var(--home-neg)" : "var(--home-pos)";
  const Icon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
      style={{ background: bg, color }}
    >
      <Icon size={10} /> {deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

function Col({ m }: { m: Metric }) {
  return (
    <Link to={m.to} className="flex min-w-0 flex-1 flex-col px-4 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-lg">
      <p
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
      >
        {m.label}
      </p>
      <p
        className="mt-1 truncate font-display font-extrabold tabular-nums"
        style={{ fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.025em", color: "var(--home-text-1)" }}
      >
        {m.loading ? "—" : formatBRL(m.value)}
        {m.suffix ? <span className="text-[13px] font-semibold" style={{ color: "var(--home-text-2)" }}>{m.suffix}</span> : null}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Badge trend={m.trend} deltaPct={m.deltaPct} higherIsWorse={m.higherIsWorse} />
      </div>
      <p className="mt-1 truncate text-[11px]" style={{ color: "var(--home-text-2)" }}>{m.hint}</p>
    </Link>
  );
}

type Props = {
  daily: { value: number; trend: Trend; deltaPct: number | null };
  card: { value: number; trend: Trend; deltaPct: number | null };
  loading?: boolean;
};

export function RitmoCard({ daily, card, loading }: Props) {
  const dailyHint =
    daily.deltaPct == null
      ? "Sem comparação"
      : Math.abs(daily.deltaPct) < 1
        ? "No mesmo ritmo"
        : daily.trend === "down"
          ? "Menor que antes"
          : "Maior que antes";
  const cardHint =
    card.deltaPct == null
      ? "Sem comparação"
      : Math.abs(card.deltaPct) < 1
        ? "Ritmo estável"
        : card.trend === "up"
          ? "Acima do anterior"
          : "Abaixo do anterior";

  return (
    <section
      aria-label="Seu ritmo neste período"
      className="rounded-[18px] bg-[color:var(--home-surface)]"
      style={{
        border: "1px solid var(--home-hairline)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="px-4 pt-3">
        <p
          className="text-[10px] font-bold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
        >
          Seu ritmo neste período
        </p>
      </div>
      <div className="relative flex items-stretch pb-2 pt-2">
        <Col
          m={{
            label: "Gasto médio",
            value: daily.value,
            suffix: "/dia",
            trend: daily.trend,
            deltaPct: daily.deltaPct,
            hint: dailyHint,
            to: "/app/relatorios",
            higherIsWorse: true,
            loading,
          }}
        />
        <div aria-hidden className="my-3 w-px" style={{ background: "var(--home-hairline)" }} />
        <Col
          m={{
            label: "Cartão",
            value: card.value,
            trend: card.trend,
            deltaPct: card.deltaPct,
            hint: cardHint,
            to: "/app/cartoes",
            higherIsWorse: true,
            loading,
          }}
        />
      </div>
      <div style={{ borderTop: "1px solid var(--home-hairline)" }}>
        <Link
          to="/app/relatorios"
          className="flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-bold hover:underline"
          style={{ color: "var(--home-brand-violet)" }}
        >
          Ver análise completa <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}
