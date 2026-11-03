import type { WeekdayPattern } from "@/lib/engine/benefitWallet";

/** Gasto por dia da semana; o dia de pico fica destacado. */
export function WeekdayBars({ pattern }: { pattern: WeekdayPattern }) {
  const max = Math.max(1, ...pattern.by_weekday.map((d) => d.total));
  const peak = pattern.peak?.weekday ?? -1;
  return (
    <div role="img" aria-label="Gasto no Ticket por dia da semana" className="flex items-end justify-between gap-1 px-1">
      {pattern.by_weekday.map((d) => {
        const isPeak = d.weekday === peak;
        return (
          <div key={d.weekday} className="flex flex-1 flex-col items-center gap-1">
            <span className={`text-[11px] font-bold ${isPeak ? "text-primary" : "text-transparent"}`}>{d.share_pct}%</span>
            <div className="flex h-24 w-full items-end justify-center">
              <div className={`w-7 rounded-md ${isPeak ? "bg-primary" : "bg-primary/30"}`} style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} />
            </div>
            <span className={`text-xs ${isPeak ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
