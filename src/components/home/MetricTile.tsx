import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";

type Trend = "up" | "down" | "stable";

type Props = {
  title: string;
  value: number;
  trend: Trend;
  deltaPct: number | null;
  compareLabel: string; // frase curta abaixo do valor
  ctaLabel: string;
  ctaTo: string;
  /** invertido: para gastos, "up" é ruim */
  higherIsWorse?: boolean;
  loading?: boolean;
};

export function MetricTile({ title, value, trend, deltaPct, compareLabel, ctaLabel, ctaTo, higherIsWorse = true, loading }: Props) {
  const bad = higherIsWorse ? trend === "up" : trend === "down";
  const good = higherIsWorse ? trend === "down" : trend === "up";
  const badgeCls = bad
    ? "bg-[hsl(350_88%_97%)] text-destructive"
    : good
      ? "bg-[hsl(160_60%_94%)] text-success"
      : "bg-muted text-muted-foreground";
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const badgeText =
    deltaPct == null
      ? "Sem base"
      : Math.abs(deltaPct) < 1
        ? "Estável"
        : `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1).replace(".", ",")}%`;

  return (
    <section className="flex min-w-0 flex-col rounded-[18px] border border-border bg-card p-4 shadow-card">
      <p className="truncate text-[12px] font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 font-display text-[clamp(1.2rem,5.5vw,1.4rem)] font-extrabold tabular-nums text-foreground">
        {loading ? "—" : formatBRL(value)}
      </p>
      <span className={`mt-2 inline-flex w-fit items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
        <Icon size={10} /> {badgeText}
      </span>
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{compareLabel}</p>
      <Link to={ctaTo} className="mt-2 text-[11px] font-semibold text-primary hover:underline">
        {ctaLabel} →
      </Link>
    </section>
  );
}
