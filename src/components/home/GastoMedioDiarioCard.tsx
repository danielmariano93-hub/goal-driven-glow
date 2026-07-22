import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, ChevronDown } from "lucide-react";
import { formatBRL, type TransactionRow } from "@/lib/engine/facts";
import {
  computeDailyAverageComparison,
  formatRangeShort,
  type DateRange,
} from "@/lib/engine/dailyAverage";

interface Props {
  txs: TransactionRow[];
  range: DateRange;
  loading?: boolean;
}

export function GastoMedioDiarioCard({ txs, range, loading }: Props) {
  const [open, setOpen] = useState(false);

  const data = useMemo(() => computeDailyAverageComparison(txs ?? [], range), [txs, range]);
  const { current, previous, prevRange, deltaPct, trend } = data;

  const hasCurrent = current.days > 0;
  const hasBase = previous.avg > 0;
  const bothZero = current.total === 0 && previous.total === 0;

  const trendIcon =
    trend === "down" ? <ArrowDown size={14} aria-hidden /> :
    trend === "up" ? <ArrowUp size={14} aria-hidden /> :
    <Minus size={14} aria-hidden />;

  const trendClass =
    trend === "down" ? "text-emerald-600 bg-emerald-50 border-emerald-100"
    : trend === "up" ? "text-rose-600 bg-rose-50 border-rose-100"
    : "text-muted-foreground bg-muted border-border";

  let comparisonText = "";
  let a11yText = "";
  let supportText = "";

  if (loading) {
    comparisonText = "Calculando…";
  } else if (bothZero) {
    comparisonText = "Ainda não há dados suficientes";
    a11yText = comparisonText;
  } else if (!hasBase) {
    comparisonText = "Sem base de comparação no mês anterior";
    a11yText = comparisonText;
  } else if (deltaPct === null || trend === "stable") {
    comparisonText = "Sem variação relevante em relação ao mês anterior";
    a11yText = "Ritmo estável";
    supportText = "Seu ritmo de gastos está estável.";
  } else if (trend === "down") {
    const pct = Math.abs(deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    comparisonText = `${pct}% menor que no mesmo período do mês anterior`;
    a11yText = `Queda de ${pct} por cento`;
    supportText = "Você está gastando menos por dia que no mês passado.";
  } else {
    const pct = Math.abs(deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    comparisonText = `${pct}% maior que no mesmo período do mês anterior`;
    a11yText = `Alta de ${pct} por cento`;
    supportText = "Seu ritmo de gastos está acima do mês passado.";
  }

  const value = loading ? "…" : formatBRL(hasCurrent ? current.avg : 0);
  const diffPerDay = current.avg - previous.avg;

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-card"
      aria-label="Gasto médio por dia"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Gasto médio por dia
          </p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground sm:text-3xl">
            {value}
          </p>
        </div>
        {!loading && hasBase && trend !== "stable" && deltaPct !== null ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${trendClass}`}
            aria-label={a11yText}
          >
            {trendIcon}
            <span>
              {Math.abs(deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {comparisonText}
        {hasBase && trend !== "stable" ? (
          <>
            {" "}
            <span className="text-foreground/80">· Comparação: {formatRangeShort(prevRange)}</span>
          </>
        ) : null}
      </p>

      {supportText ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{supportText}</p>
      ) : null}

      {!loading && (hasCurrent || previous.total > 0) ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            aria-expanded={open}
            aria-controls="gasto-medio-detalhes"
          >
            {open ? "Ocultar detalhes" : "Ver detalhes"}
            <ChevronDown
              size={12}
              className={`transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {open ? (
            <dl
              id="gasto-medio-detalhes"
              className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-[11px]"
            >
              <div>
                <dt className="text-muted-foreground">Período atual</dt>
                <dd className="mt-0.5 tabular-nums text-foreground">
                  {formatBRL(current.total)} em {current.days} dia{current.days === 1 ? "" : "s"}
                </dd>
                <dd className="tabular-nums text-muted-foreground">
                  Média: {formatBRL(current.avg)}/dia
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mesmo período anterior</dt>
                <dd className="mt-0.5 tabular-nums text-foreground">
                  {formatBRL(previous.total)} em {previous.days} dia{previous.days === 1 ? "" : "s"}
                </dd>
                <dd className="tabular-nums text-muted-foreground">
                  Média: {formatBRL(previous.avg)}/dia
                </dd>
              </div>
              {hasBase ? (
                <div className="col-span-2 border-t border-border pt-2">
                  <dt className="text-muted-foreground">Diferença por dia</dt>
                  <dd className="mt-0.5 tabular-nums text-foreground">
                    {diffPerDay >= 0 ? "+" : "−"}
                    {formatBRL(Math.abs(diffPerDay))}/dia
                    {deltaPct !== null ? (
                      <span className="ml-1 text-muted-foreground">
                        ({deltaPct > 0 ? "+" : ""}
                        {deltaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
