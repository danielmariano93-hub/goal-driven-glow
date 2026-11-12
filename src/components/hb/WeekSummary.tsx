import { cn } from "@/lib/utils";
import { HabitTile } from "@/components/hb/kit";
import { OUTCOME_CELL, OUTCOME_LABEL } from "@/components/hb/outcomeStyles";
import type { HabitView } from "@/lib/habits/api";
import { addDays, dayRows, weekStart, type LogRow, type WeeklyReviewRow } from "@/lib/habits/engine";

const WD = ["S", "T", "Q", "Q", "S", "S", "D"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;

/** Só o fato: como foi a semana passada inteira. A semana atual ainda não acabou, então não vira "melhor" nem "pior". */
function Previous({ row }: { row: WeeklyReviewRow }) {
  if (row.prev_expected <= 0) return null;
  return <span className="text-[11px] text-muted-foreground">semana passada: {num(row.prev_done)} de {num(row.prev_expected)}</span>;
}

/** Semana (segunda a domingo): um cartão por hábito com o desenho da semana, em vez de uma lista de frases. */
export function WeekSummary({ rows, views, logs, today, aiText, footer }: { rows: WeeklyReviewRow[]; views: HabitView[]; logs: LogRow[]; today: string; aiText?: string | null; footer?: React.ReactNode }) {
  const ws = weekStart(today);
  const dayIndex = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${ws}T12:00:00Z`).getTime()) / 86_400_000);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return (
    <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Resumo da semana">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-medium text-muted-foreground">Resumo da semana</h2>
          <p className="mt-0.5 font-display text-[16px] font-semibold leading-tight tracking-[-0.01em]">{dm(ws)} a {dm(addDays(ws, 6))}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary">dia {dayIndex + 1} de 7</span>
      </div>

      <ul className="mt-3 divide-y divide-border/60">
        {rows.map((r) => {
          const v = views.find((x) => x.habit.id === r.habit_id);
          if (!v) return null;
          const weekly = r.weekly === true;
          const strip = weekly ? null : dayRows(v.def, logs, ws, addDays(ws, 6), today, v.pauses);
          const unit = weekly ? (r.expected === 1 ? "vez" : "vezes") : r.expected === 1 ? "dia" : "dias";
          const slots = weekly ? Math.max(1, Math.round(r.expected)) : 7;
          return (
            <li key={r.habit_id} className="py-3 first:pt-1 last:pb-0">
              <div className="flex items-center gap-2.5">
                <HabitTile title={v.habit.title} form={v.form} area={v.habit.area} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold leading-5">{v.habit.title}</p>
                  <Previous row={r} />
                </div>
                <p className="shrink-0 text-right font-display text-[16px] font-semibold leading-none tabular-nums">
                  {num(r.done)}<span className="text-[12px] font-normal text-muted-foreground"> de {num(r.expected)} {unit}</span>
                </p>
              </div>
              {strip ? (
                <div className="mt-2.5 grid grid-cols-7 gap-1.5" role="img" aria-label={`${v.habit.title}: ${strip.map((d, i) => `${WD[i]} ${d.date > today ? "ainda não chegou" : OUTCOME_LABEL[d.outcome]}`).join(", ")}`}>
                  {strip.map((d, i) => (
                    <div key={d.date} className="flex flex-col items-center gap-1">
                      <i className={cn("block h-5 w-full rounded-[6px]", d.date > today ? "border border-dashed border-muted-foreground/25" : OUTCOME_CELL[d.outcome], d.date === today && "ring-1 ring-primary/50 ring-offset-1 ring-offset-card")} />
                      <span className="text-[10px] leading-3 text-muted-foreground" aria-hidden="true">{WD[i]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2.5 flex gap-1.5" role="img" aria-label={`${num(r.done)} de ${num(r.expected)} ${unit} nesta semana`}>
                  {Array.from({ length: slots }, (_, i) => <i key={i} className={cn("h-5 flex-1 rounded-[6px]", i < Math.floor(r.done) ? "bg-primary" : i < r.done ? "bg-primary/45" : "bg-muted")} />)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {aiText ? <p className="mt-3 whitespace-pre-line rounded-xl bg-primary/5 px-3.5 py-3 text-[13px] leading-5">{aiText}</p> : null}
      <p className="mt-3 text-[12px] text-muted-foreground">Semana que vem é um novo começo.</p>
      {footer}
    </section>
  );
}
