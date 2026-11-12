import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { QuickLogSheet } from "@/components/hb/QuickLogSheet";
import { hbErrorMessage, useLogHabit, useUnlogHabit, type HabitView } from "@/lib/habits/api";
import { countsDone, dayFraction, formSubtitle, logLabel, recurringLine } from "@/lib/habits/present";
import type { LogRow } from "@/lib/habits/engine";

const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

function statusText(v: HabitView, today: string, logs: LogRow[]): string {
  const q = v.summary.today.quantity ?? 0;
  switch (v.form) {
    case "check": return countsDone(v) ? "Feito" : "Ainda não feito";
    case "recurring": {
      const last = logs.filter((l) => l.habit_id === v.habit.id).map((l) => l.local_date).sort().pop() ?? null;
      return recurringLine(v, last, today).text;
    }
    case "value": return v.summary.today.quantity != null ? `${num(q)} ${v.habit.quantity_unit ?? ""}`.trim() : "Ainda não registrado";
    case "project": return `${num(q)} de ${num(v.habit.quantity_target ?? 0)} ${v.habit.quantity_unit ?? v.project?.unit ?? ""} hoje`.trim();
    default: return formSubtitle(v, today).split(" · ")[0] || "Ainda não registrado";
  }
}

/** Cartão "Hoje" do detalhe: mostra onde o dia está e tem o botão de registrar, de acordo com a forma de medir. */
export function TodayAction({ view, today, logs, paused }: { view: HabitView; today: string; logs: LogRow[]; paused: boolean }) {
  const log = useLogHabit();
  const unlog = useUnlogHabit();
  const [open, setOpen] = useState(false);
  if (paused) return null;
  const simple = view.form === "check" || view.form === "weekly";
  const done = countsDone(view);
  const frac = dayFraction(view);
  const status = statusText(view, today, logs);

  const press = async () => {
    if (!simple) return setOpen(true);
    try {
      if (done) await unlog.mutateAsync({ habit_id: view.habit.id, date: today });
      else await log.mutateAsync({ habit_id: view.habit.id, date: today, status: "done" });
    } catch (e) { toast.error(hbErrorMessage(e)); }
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Hoje">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[12px] font-medium text-muted-foreground">Hoje</h2>
          <p className="mt-0.5 truncate font-display text-[18px] font-semibold leading-6 tracking-[-0.01em]">{status}</p>
        </div>
        {done ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" /></span> : null}
      </div>
      {frac != null ? <div className="mt-3 h-2 rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label="Progresso de hoje"><i className={cn("block h-full rounded-full transition-[width] duration-500", frac >= 1 ? "bg-success" : "bg-primary")} style={{ width: `${Math.round(frac * 100)}%` }} /></div> : null}
      <button
        type="button"
        onClick={() => void press()}
        disabled={log.isPending || unlog.isPending}
        className={cn("mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-colors active:scale-[0.99]", simple && done ? "border border-border bg-card text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90")}
      >
        {simple && done ? "Desfazer" : <><Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />{logLabel(view.form)}</>}
      </button>
      {open ? <QuickLogSheet key={view.habit.id} view={view} date={today} open onOpenChange={setOpen} /> : null}
    </section>
  );
}
