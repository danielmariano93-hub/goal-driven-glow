import { useMemo } from "react";
import { buildWeekStrip, saoPauloDay, summarizeWeek } from "@/lib/emotions/history";
import { useEmotionHistory } from "@/lib/emotions/useEmotionHistory";

/** Os últimos 7 dias, um emoji por dia, e uma frase do Nino. Dia sem registro é só um ponto, sem cobrança. */
export function EmotionWeekStrip() {
  const { data } = useEmotionHistory(10);
  const today = saoPauloDay(new Date());
  const week = useMemo(() => buildWeekStrip(data ?? [], today), [data, today]);
  const summary = useMemo(() => summarizeWeek(week), [week]);
  if (!data || data.length === 0) return null;
  return (
    <div className="mt-3" data-testid="emotion-week">
      <ol className="grid grid-cols-7 gap-1" aria-label="Como você se sentiu nos últimos 7 dias">
        {week.map((d) => (
          <li key={d.date} className="flex flex-col items-center gap-1">
            <span
              className={`grid h-10 w-full max-w-[44px] place-items-center rounded-2xl text-[20px] ${d.isToday ? "ring-2 ring-primary/40" : ""} ${d.emotion ? "bg-primary/8 bg-secondary/60" : "border border-dashed border-border"}`}
              role="img"
              aria-label={d.emotion ? `${d.weekday}: ${d.emotion.label}` : `${d.weekday}: sem registro`}
              title={d.emotion ? d.emotion.label : "Sem registro"}
            >
              {d.emotion ? d.emotion.emoji : <i className="h-1 w-1 rounded-full bg-muted-foreground/40" aria-hidden />}
            </span>
            <span className={`text-[10px] ${d.isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.isToday ? "hoje" : d.weekday}</span>
          </li>
        ))}
      </ol>
      {summary ? <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">{summary}</p> : null}
    </div>
  );
}
