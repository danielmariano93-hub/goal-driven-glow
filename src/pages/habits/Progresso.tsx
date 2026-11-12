import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/hb/ui";
import { WeekSummary } from "@/components/hb/WeekSummary";
import { aggregateAdherence, rowsFor, weekdayAdherence, windowDelta } from "@/lib/habits/aggregate";
import { useHabitViews, useNarrateWeek } from "@/lib/habits/api";
import { addDays, weeklyReview } from "@/lib/habits/engine";

const WINDOWS = [7, 30, 90] as const;
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pct = (n: number | null) => (n == null ? "-" : `${Math.round(n * 100)}%`);

export default function Progresso() {
  const { views, today, logs, isLoading } = useHabitViews();
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(30);
  const narrate = useNarrateWeek();
  const [aiText, setAiText] = useState<string | null>(null);

  const m = useMemo(() => {
    if (!today) return null;
    const inputs = views.map((v) => ({ def: v.def, pauses: v.pauses }));
    const rows = rowsFor(inputs, logs, addDays(today, -(win * 2 + 90)), today, today);
    const adh = aggregateAdherence(rows, today, win, 7);
    const delta = windowDelta(rows, today, win);
    const weekdays = weekdayAdherence(rowsFor(inputs, logs, addDays(today, -83), today, today), today, 84, 4);
    return { adh, delta, weekdays, hasWeekdays: weekdays.some((w) => w.adherence != null) };
  }, [views, logs, today, win]);

  if (isLoading || !today || !m) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;

  const perHabit = (v: (typeof views)[number]) => (v.summary.closed_count < (v.summary.model === "weekly" ? 2 : 7) ? null : win === 7 ? v.summary.adherence7 : win === 30 ? v.summary.adherence30 : v.summary.adherence90);
  const review = weeklyReview(views.filter((v) => v.habit.sensitivity === "normal").map((v) => ({ def: v.def, pauses: v.pauses })), logs, today);
  const askAi = async () => {
    try {
      const r = await narrate.mutateAsync();
      if (r.source === "ai" && r.text) setAiText(r.text);
      else toast.message("Não consegui reescrever agora. O resumo acima continua valendo.");
    } catch {
      toast.message("Não consegui reescrever agora. O resumo acima continua valendo.");
    }
  };
  const firm = views.filter((v) => v.summary.phase === "firm" || v.summary.phase === "maintenance").length;

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Progresso" />
      <div className="flex rounded-xl bg-muted p-0.5" role="group" aria-label="Período">
        {WINDOWS.map((w) => (
          <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)} className={cn("min-h-10 flex-1 rounded-[10px] text-[12px] font-semibold", win === w ? "bg-card shadow-sm" : "text-muted-foreground")}>{w} dias</button>
        ))}
      </div>

      {views.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">Seu progresso aparece aqui depois do primeiro hábito.</p>
      ) : (
        <>
          <section className="mt-4 rounded-3xl bg-gradient-hero p-6 text-primary-foreground shadow-hero" aria-label="Resumo do período">
            <p className="text-[14px] font-medium text-white/75">Constância nos últimos {win} dias</p>
            {m.adh == null ? (
              <>
                <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">Ainda juntando dados</p>
                <p className="mt-1.5 text-[12px] leading-[18px] text-white/65">A constância aparece depois de 7 dias de registros. Ela soma os dias completos (valem 1) e as versões mínimas (valem 0,6); o dia de hoje só entra quando fecha.</p>
              </>
            ) : (
              <>
                <p className="mt-1 font-display text-[44px] font-semibold leading-none tracking-[-0.05em] tabular-nums">{Math.round(m.adh * 100)}<span className="text-[28px] text-white/70">%</span></p>
                <p className="mt-2 text-[12px] leading-[18px] text-white/65">Dia completo vale 1 e versão mínima vale 0,6. O dia de hoje só entra quando fecha.</p>
              </>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
              <div>
                <dd className="font-display text-lg font-semibold tabular-nums">{m.delta.delta_pp == null ? "-" : `${m.delta.delta_pp > 0 ? "+" : ""}${m.delta.delta_pp} pts`}</dd>
                <dt className="text-[12px] text-white/70">vs. {win} dias antes</dt>
              </div>
              <div>
                <dd className="font-display text-lg font-semibold tabular-nums">{firm}</dd>
                <dt className="text-[12px] text-white/70">{firm === 1 ? "hábito firme" : "hábitos firmes"}</dt>
              </div>
            </dl>
          </section>
          {m.delta.delta_pp == null ? <p className="mt-2 px-1 text-[12px] text-muted-foreground">A comparação aparece quando há dados nos dois períodos.</p> : null}

          {review.length > 0 ? (
            <WeekSummary
              rows={review} views={views} logs={logs} today={today} aiText={aiText}
              footer={aiText ? <p className="mt-2 text-xs text-muted-foreground">Os números vêm dos seus registros; a IA só reescreveu o texto.</p> : <Button variant="ghost" className="-ml-3 mt-1 h-10 rounded-full px-3 text-[13px] text-primary" disabled={narrate.isPending} onClick={() => void askAi()}>Reescrever com IA</Button>}
            />
          ) : null}

          <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Por hábito">
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">Por hábito</h2>
            <ul>
              {views.map((v) => {
                const a = perHabit(v);
                return (
                  <li key={v.habit.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.habit.title}</span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true"><i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((a ?? 0) * 100)}%` }} /></span>
                    {a == null ? <span className="w-16 text-right text-xs text-muted-foreground">sem dados</span> : <span className="w-16 text-right text-sm font-semibold tabular-nums">{pct(a)}</span>}
                  </li>
                );
              })}
            </ul>
            {views.some((v) => v.summary.model === "weekly") ? <p className="mt-2 text-xs text-muted-foreground">Hábitos de meta semanal mostram a média das semanas fechadas.</p> : null}
          </section>

          <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Por dia da semana">
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">Quando você mais consegue</h2>
            {m.hasWeekdays ? (
              <>
                <ul className="grid grid-cols-7 items-end gap-1.5" style={{ height: 96 }}>
                  {m.weekdays.map((w) => (
                    <li key={w.dow} className="flex h-full flex-col items-center justify-end gap-1">
                      <i className={cn("block w-full rounded-md", w.adherence == null ? "bg-muted" : "bg-primary")} style={{ height: `${Math.max(6, Math.round((w.adherence ?? 0.06) * 72))}px` }} title={w.adherence == null ? "sem dados suficientes" : `${Math.round(w.adherence * 100)}%`} />
                      <span className="text-[11px] text-muted-foreground">{WEEKDAY[w.dow]}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Baseado nas últimas 12 semanas. Dias em cinza ainda têm poucos dados.</p>
              </>
            ) : (
              <p className="text-sm leading-5 text-muted-foreground">Aparece depois de umas 4 semanas de uso. Antes disso, qualquer padrão seria acaso.</p>
            )}
          </section>
          <Link to="/h/dinheiro" className="mt-3 block rounded-2xl border border-border/60 bg-card p-4 text-sm font-semibold text-primary shadow-card">Ver hábitos e dinheiro</Link>
          <p className="mt-4 px-1 text-xs leading-5 text-muted-foreground">Os números descrevem o que aconteceu com você. Não provam por que aconteceu.</p>
        </>
      )}
    </div>
  );
}
