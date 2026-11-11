import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { DayActionsSheet } from "@/components/hb/DayActionsSheet";
import { BackfillSheet } from "@/components/hb/BackfillSheet";
import { EditPlanSheet } from "@/components/hb/EditPlanSheet";
import { OUTCOME_CELL, OUTCOME_LABEL } from "@/components/hb/outcomeStyles";
import { PageHeader, PhaseChip, StrengthRing } from "@/components/hb/ui";
import { AreaTile } from "@/components/hb/kit";
import { AutomaticityCard } from "@/components/hb/AutomaticityCard";
import { MeasureCard } from "@/components/hb/MeasureCard";
import { TodayAction } from "@/components/hb/TodayAction";
import { AchievementsCard, FormProgress } from "@/components/hb/FormProgress";
import { hbErrorMessage, useArchiveHabit, useHabitViews, useSetHabitStatus, type HabitView } from "@/lib/habits/api";
import { addDays, dayRows, MIN_CLOSED_DAILY, weekStart } from "@/lib/habits/engine";

const WEEKDAY_SHORT = ["D", "S", "T", "Q", "Q", "S", "S"];
const pct = (n: number | null) => (n == null ? "-" : `${Math.round(n * 100)}%`);

function Heatmap({ view, today, logs }: { view: HabitView; today: string; logs: ReturnType<typeof useHabitViews>["logs"] }) {
  const cells = useMemo(() => {
    const lastWeek = weekStart(today);
    const first = addDays(lastWeek, -7 * 19);
    const rows = dayRows(view.def, logs, first, addDays(lastWeek, 6), today, view.pauses);
    return rows;
  }, [view, logs, today]);
  return (
    <div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }} role="img" aria-label="Mapa das últimas 20 semanas, uma célula por dia">
        {cells.map((c) => <i key={c.date} title={`${c.date}: ${OUTCOME_LABEL[c.outcome]}`} className={cn("block aspect-square rounded-[3px]", OUTCOME_CELL[c.outcome], c.date > today && "opacity-0")} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        {(["done", "minimum", "rest", "missed", "not_expected"] as const).map((o) => (
          <span key={o} className="inline-flex items-center gap-1.5"><i className={cn("inline-block h-2.5 w-2.5 rounded-[3px]", OUTCOME_CELL[o])} />{OUTCOME_LABEL[o]}</span>
        ))}
      </div>
    </div>
  );
}

export default function Detalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { views, paused, rules, today, logs, isLoading } = useHabitViews();
  const setStatus = useSetHabitStatus();
  const archive = useArchiveHabit();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const view = [...views, ...paused].find((v) => v.habit.id === id);
  const [backfillOpen, setBackfillOpen] = useState(false);

  if (isLoading || !today) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  if (!view) {
    return (
      <div className="px-4">
        <PageHeader title="Hábito não encontrado" back="/h/habitos" />
        <p className="text-sm text-muted-foreground">Ele pode ter sido arquivado.</p>
      </div>
    );
  }

  const { habit, summary } = view;
  const weekly = summary.model === "weekly";
  const recurring = view.form === "recurring";
  const recent = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  const recentRows = dayRows(view.def, logs, recent[0], today, today, view.pauses);
  const strengthNote = summary.strength == null
    ? (weekly ? "A força aparece depois de 2 semanas de prática." : `A força aparece depois de ${MIN_CLOSED_DAILY} dias de prática.`)
    : "Sobe com constância, cai devagar. É uma estimativa, não uma nota.";

  const openEdit = () => setEditing(true);
  const isPaused = habit.status === "paused";
  const togglePause = async () => {
    try {
      await setStatus.mutateAsync({ id: habit.id, status: isPaused ? "active" : "paused" });
      toast.success(isPaused ? "Hábito retomado" : "Hábito pausado. Os dias parados não contam como falha.");
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const doArchive = async () => {
    try {
      await archive.mutateAsync(habit.id);
      toast.success("Hábito arquivado");
      navigate("/h/habitos", { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  return (
    <div className="px-4 pb-6">
      <section className="-mx-4 max-w-none rounded-b-[32px] bg-gradient-hero px-5 pb-7 pt-3 text-primary-foreground" aria-label="Força do hábito">
        <div className="flex items-center justify-between">
          <Link to="/h/habitos" aria-label="Voltar" className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
          <button type="button" onClick={openEdit} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-medium text-white transition-colors hover:bg-white/10">Editar</button>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <AreaTile area={habit.area} title={habit.title} size={44} onDark />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.02em]">{habit.title}</h1>
            {habit.cue_text ? <p className="truncate text-[14px] text-white/75">{habit.cue_text}</p> : null}
          </div>
        </div>
        {recurring ? null : (
          <>
            <div className="mt-6"><StrengthRing value={summary.strength} /></div>
            <div className="mt-4 flex items-center justify-center gap-2"><PhaseChip phase={summary.phase} /><span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-medium">estimativa</span></div>
            <p className="mx-auto mt-3 max-w-[300px] text-center text-[13px] leading-5 text-white/75">{strengthNote}</p>
          </>
        )}
      </section>
      <div className="mt-4"><TodayAction view={view} today={today} logs={logs} paused={habit.status === "paused"} /></div>
      {habit.minimum_text ? <p className="mt-3 px-1 text-[14px] text-muted-foreground">Dia ruim: {habit.minimum_text}</p> : null}

      {isPaused ? (
        <div role="status" className="mt-3 rounded-2xl bg-warning/15 p-4 text-sm leading-5">
          <p className="font-medium">Hábito pausado</p>
          <p className="text-muted-foreground">Os dias pausados não contam como falha nem quebram a sua sequência. Retome quando quiser.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3"><FormProgress view={view} today={today} logs={logs} /></div>

      {recurring ? null : <dl className="mt-4 grid grid-cols-4 gap-2 rounded-2xl border border-border/60 bg-card p-3 text-center shadow-card">
        {[
          { k: weekly ? "semanas seguidas" : "dias seguidos", v: String(summary.streak) },
          { k: "recorde", v: String(summary.best_streak) },
          { k: weekly ? "folgas" : `folga${summary.rests_left_this_week === 1 ? "" : "s"} na semana`, v: weekly ? "-" : String(summary.rests_left_this_week) },
          { k: "últimos 30 dias", v: pct(summary.adherence30) },
        ].map((i) => (
          <div key={i.k}><dd className="font-display text-xl font-semibold tabular-nums">{i.v}</dd><dt className="text-[11px] leading-4 text-muted-foreground">{i.k}</dt></div>
        ))}
      </dl>}

      {recurring ? null : <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Últimos 7 dias">
        <div className="flex items-center justify-between gap-2"><h2 className="text-[13px] font-medium text-muted-foreground">Últimos 7 dias · toque para corrigir</h2>{view.form !== "steps" ? <button type="button" onClick={() => setBackfillOpen(true)} className="shrink-0 rounded-full px-2 py-1 text-[12.5px] font-medium text-primary hover:bg-primary/5">Dia anterior</button> : null}</div>
        <ul className="mt-3 grid grid-cols-7 gap-1.5">
          {recent.map((d, i) => {
            const o = recentRows[i].outcome;
            const editable = d >= habit.started_on && d <= today;
            return (
              <li key={d}>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setDayOpen(d)}
                  aria-label={`${d.slice(8, 10)}/${d.slice(5, 7)}: ${OUTCOME_LABEL[o]}`}
                  className={cn("flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold disabled:opacity-40", d === today ? "border-primary" : "border-border")}
                >
                  <span className="text-muted-foreground">{WEEKDAY_SHORT[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
                  <i className={cn("block h-3 w-3 rounded-full", OUTCOME_CELL[o])} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>}

      {recurring ? null : <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Mapa de 20 semanas">
        <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">Últimas 20 semanas</h2>
        <Heatmap view={view} today={today} logs={logs} />
      </section>}

      <div className="mt-3"><AchievementsCard view={view} today={today} logs={logs} /></div>
      {!isPaused && view.form !== "recurring" ? <div className="mt-3"><AutomaticityCard view={view} /></div> : null}
      {view.form === "check" && habit.sensitivity === "normal" ? <div className="mt-3"><MeasureCard view={view} rule={rules.find((r) => r.habit_id === habit.id) ?? null} /></div> : null}

      <Button variant="outline" className="mt-5 h-11 w-full rounded-full font-semibold" disabled={setStatus.isPending} onClick={() => void togglePause()}>{isPaused ? "Retomar este hábito" : "Pausar este hábito"}</Button>
      <Button variant="ghost" className="mt-2 h-11 w-full rounded-full text-muted-foreground" onClick={() => setConfirmArchive(true)}>Arquivar este hábito</Button>
      <p className="mt-1 text-center text-xs text-muted-foreground"><Link to="/h/habitos" className="underline underline-offset-2">Ver todos os hábitos</Link></p>

      {dayOpen ? <DayActionsSheet view={view} date={dayOpen} today={today} logs={logs} open onOpenChange={(o) => !o && setDayOpen(null)} /> : null}

      {editing ? <EditPlanSheet key={habit.id} view={view} today={today} open onOpenChange={setEditing} /> : null}
      {today ? <BackfillSheet today={today} weekly={weekly} open={backfillOpen} onOpenChange={setBackfillOpen} onPick={(d) => setDayOpen(d)} /> : null}

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{habit.title}”?</AlertDialogTitle>
            <AlertDialogDescription>Ele sai da sua lista e libera uma vaga. O histórico fica guardado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doArchive()}>Arquivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
