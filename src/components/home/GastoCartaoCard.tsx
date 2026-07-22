import { useMemo } from "react";
import { CreditCard, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { formatBRL, type TransactionRow } from "@/lib/engine/facts";
import { computeCardSpendingComparison, formatRangeShort } from "@/lib/engine/dailyAverage";

/**
 * Card compacto de gasto no cartão de crédito no período (data econômica).
 * Não usa o valor da fatura fechada; usa o `occurred_at` de cada compra.
 */
export function GastoCartaoCard({
  txs,
  range,
  loading,
}: {
  txs: TransactionRow[];
  range: { start: string; end: string };
  loading?: boolean;
}) {
  const cmp = useMemo(() => computeCardSpendingComparison(txs, range), [txs, range]);
  const trendIcon =
    cmp.trend === "up" ? <TrendingUp className="h-3 w-3" /> : cmp.trend === "down" ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const trendColor = cmp.trend === "up" ? "text-destructive" : cmp.trend === "down" ? "text-success" : "text-muted-foreground";
  const trendLabel =
    cmp.deltaPct == null
      ? "Sem base de comparação"
      : `${cmp.deltaPct > 0 ? "+" : ""}${cmp.deltaPct.toFixed(1).replace(".", ",")}% vs ${formatRangeShort(cmp.prevRange)}`;

  return (
    <section
      aria-label="Gastos no cartão de crédito"
      className="rounded-3xl bg-card p-4 shadow-card ring-1 ring-border"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
          <CreditCard className="h-3.5 w-3.5" />
        </span>
        Cartão no período
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">
        {loading ? "—" : formatBRL(cmp.current)}
      </p>
      <p className={`mt-1 inline-flex items-center gap-1 text-[11px] ${trendColor}`}>
        <span aria-hidden>{trendIcon}</span>
        <span>{trendLabel}</span>
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">Baseado na data de cada compra, não da fatura.</p>
    </section>
  );
}
