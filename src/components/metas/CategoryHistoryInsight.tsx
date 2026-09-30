import { formatBRL } from "@/lib/engine/facts";
import { spendingMonthLabel, type CategorySpendingAdvice } from "@/lib/engine/spendingGoals";

const monthShort = (ym: string) => spendingMonthLabel(ym).replace(/ de (\d{4})$/, "/$1");
const pct = (ratio: number) => `${Math.round(Math.abs(ratio) * 100)}%`;

type Props = {
  advice: CategorySpendingAdvice;
  /** Usa o limite recomendado no formulário. */
  onUseRecommended?: (limit: number) => void;
  compact?: boolean;
};

/**
 * O que o histórico diz sobre a categoria: média, comportamento recente,
 * extremos, tendência, meses fora do padrão, valor recomendado e o impacto
 * acumulado da mudança. O período recente pesa mais na recomendação.
 */
export function CategoryHistoryInsight({ advice, onUseRecommended, compact }: Props) {
  const max = Math.max(1, ...advice.months.map((m) => m.amount));
  const atypical = new Set(advice.atypical.map((a) => a.month));
  const trend = advice.trend.direction === "up"
    ? `subindo ${pct(advice.trend.pct)}`
    : advice.trend.direction === "down" ? `caindo ${pct(advice.trend.pct)}` : "estável";

  return (
    <div className="rounded-[14px] border border-border bg-[color:var(--home-surface-soft,#F3F1F7)] p-3 text-[12px]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">O que o seu histórico mostra</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <p>Média histórica: <strong className="tabular-nums">{formatBRL(advice.average)}</strong></p>
        <p>Últimos 3 meses: <strong className="tabular-nums">{formatBRL(advice.recent_average)}</strong></p>
        {advice.max ? <p>Maior mês: <strong>{monthShort(advice.max.month)}</strong> · <span className="tabular-nums">{formatBRL(advice.max.amount)}</span></p> : null}
        {advice.min ? <p>Menor mês: <strong>{monthShort(advice.min.month)}</strong> · <span className="tabular-nums">{formatBRL(advice.min.amount)}</span></p> : null}
        <p>Tendência: <strong>{trend}</strong></p>
        <p>Referência: <strong className="tabular-nums">{formatBRL(advice.reference)}</strong></p>
      </div>

      {!compact && advice.months.length > 1 ? (
        <div className="mt-3 flex h-14 items-end gap-1" aria-label="Gasto mês a mês">
          {advice.months.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
              <div
                title={`${spendingMonthLabel(m.month)}: ${formatBRL(m.amount)}`}
                className={`w-full rounded-t ${atypical.has(m.month) ? "bg-amber-400" : "bg-primary/60"}`}
                style={{ height: `${Math.max(4, Math.round((m.amount / max) * 48))}px` }}
              />
              <span className="text-[9px] text-muted-foreground">{spendingMonthLabel(m.month).slice(0, 3)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {advice.atypical.length ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Fora do padrão: {advice.atypical.map((a) => `${spendingMonthLabel(a.month).split(" de ")[0]} (${formatBRL(a.amount)})`).join(", ")}. Esses meses não inflam a referência.
        </p>
      ) : null}

      {advice.merchants.length ? (
        <p className="mt-2">
          Quem mais explica: {advice.merchants.slice(0, 3).map((m) => `${m.label} (${pct(m.share)}${m.behavior === "fixed" ? ", fixo" : ""})`).join(", ")}.
        </p>
      ) : null}

      {advice.discretionary ? (
        <div className="mt-2 rounded-lg bg-card p-2">
          <p>
            Recomendado: <strong className="tabular-nums">{formatBRL(advice.recommended_limit)}</strong> por mês
            {advice.potential_monthly > 0 ? <> · redução de <strong className="tabular-nums">{formatBRL(advice.potential_monthly)}</strong> ({pct(advice.reduction_pct)})</> : null}
          </p>
          {advice.potential_monthly > 0 ? (
            <p className="mt-0.5 text-muted-foreground">
              Impacto acumulado: {formatBRL(advice.impact.m3)} em 3 meses · {formatBRL(advice.impact.m6)} em 6 · {formatBRL(advice.impact.m12)} em 12.
            </p>
          ) : null}
          {onUseRecommended ? (
            <button type="button" onClick={() => onUseRecommended(advice.recommended_limit)} className="mt-1.5 rounded-full border border-primary px-3 py-1 text-[11px] font-semibold text-primary">
              Usar {formatBRL(advice.recommended_limit)}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">Gasto de obrigação ou fixo: o Nino acompanha, mas não sugere corte.</p>
      )}
    </div>
  );
}
