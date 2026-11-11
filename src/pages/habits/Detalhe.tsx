import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { DayActionsSheet } from "@/components/hb/DayActionsSheet";
import { OUTCOME_CELL, OUTCOME_LABEL } from "@/components/hb/outcomeStyles";
import { PageHeader, PhaseChip, StrengthBar } from "@/components/hb/ui";
import { AutomaticityCard } from "@/components/hb/AutomaticityCard";
import { MeasureCard } from "@/components/hb/MeasureCard";
import { hbErrorMessage, useArchiveHabit, useHabitViews, useSetHabitStatus, useUpdateHabit, type HabitView } from "@/lib/habits/api";
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
  const update = useUpdateHabit();
  const archive = useArchiveHabit();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const view = [...views, ...paused].find((v) => v.habit.id === id);
  const [form, setForm] = useState({ title: "", cue_text: "", minimum_text: "" });

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
  const recent = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  const recentRows = dayRows(view.def, logs, recent[0], today, today, view.pauses);
  const strengthNote = summary.strength == null
    ? (weekly ? "A força aparece depois de 2 semanas de prática." : `A força aparece depois de ${MIN_CLOSED_DAILY} dias de prática.`)
    : "Sobe com constância, cai devagar. É uma estimativa, não uma nota.";

  const openEdit = () => {
    setForm({ title: habit.title, cue_text: habit.cue_text ?? "", minimum_text: habit.minimum_text ?? "" });
    setEditing(true);
  };
  const save = async () => {
    try {
      await update.mutateAsync({ id: habit.id, patch: { title: form.title, cue_text: form.cue_text, minimum_text: form.minimum_text } });
      setEditing(false);
      toast.success("Plano atualizado");
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
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
      <PageHeader title={habit.title} subtitle={habit.cue_text ? `${habit.cue_text}` : undefined} back="/h/habitos" right={<Button variant="ghost" className="mt-6 h-11 rounded-full" onClick={openEdit}>Editar</Button>} />
      {habit.minimum_text ? <p className="-mt-1 mb-3 text-sm text-muted-foreground">Dia ruim: {habit.minimum_text}</p> : null}

      {isPaused ? (
        <div role="status" className="mb-3 rounded-[20px] bg-warning/15 p-4 text-sm leading-5">
          <p className="font-semibold">Hábito pausado</p>
          <p className="text-muted-foreground">Os dias pausados não contam como falha nem quebram a sua sequência. Retome quando quiser.</p>
        </div>
      ) : null}

      <section className="rounded-[20px] bg-card p-4 shadow-card" aria-label="Força do hábito">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Força do hábito</h2>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">estimativa</span>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <p className="font-display text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{summary.strength == null ? "-" : `${Math.round(summary.strength * 100)}%`}</p>
          <PhaseChip phase={summary.phase} />
        </div>
        <div className="mt-3"><StrengthBar value={summary.strength} /></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{strengthNote}</p>
      </section>

      <dl className="mt-3 grid grid-cols-4 gap-2 rounded-[20px] bg-card p-3 text-center shadow-card">
        {[
          { k: weekly ? "semanas seguidas" : "dias seguidos", v: String(summary.streak) },
          { k: "recorde", v: String(summary.best_streak) },
          { k: weekly ? "folgas" : `folga${summary.rests_left_this_week === 1 ? "" : "s"} na semana`, v: weekly ? "-" : String(summary.rests_left_this_week) },
          { k: "últimos 30 dias", v: pct(summary.adherence30) },
        ].map((i) => (
          <div key={i.k}><dd className="font-display text-xl font-extrabold tabular-nums">{i.v}</dd><dt className="text-[11px] leading-4 text-muted-foreground">{i.k}</dt></div>
        ))}
      </dl>

      <section className="mt-3 rounded-[20px] bg-card p-4 shadow-card" aria-label="Últimos 7 dias">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimos 7 dias · toque para corrigir</h2>
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
      </section>

      <section className="mt-3 rounded-[20px] bg-card p-4 shadow-card" aria-label="Mapa de 20 semanas">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimas 20 semanas</h2>
        <Heatmap view={view} today={today} logs={logs} />
      </section>

      {!isPaused ? <div className="mt-3"><AutomaticityCard view={view} /></div> : null}
      {habit.kind === "do_daily" && habit.sensitivity === "normal" ? <div className="mt-3"><MeasureCard view={view} rule={rules.find((r) => r.habit_id === habit.id) ?? null} /></div> : null}

      <Button variant="outline" className="mt-5 h-11 w-full rounded-full font-semibold" disabled={setStatus.isPending} onClick={() => void togglePause()}>{isPaused ? "Retomar este hábito" : "Pausar este hábito"}</Button>
      <Button variant="ghost" className="mt-2 h-11 w-full rounded-full text-muted-foreground" onClick={() => setConfirmArchive(true)}>Arquivar este hábito</Button>
      <p className="mt-1 text-center text-xs text-muted-foreground"><Link to="/h/habitos" className="underline underline-offset-2">Ver todos os hábitos</Link></p>

      {dayOpen ? <DayActionsSheet view={view} date={dayOpen} today={today} logs={logs} open onOpenChange={(o) => !o && setDayOpen(null)} /> : null}

      <Drawer open={editing} onOpenChange={setEditing}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <DrawerHeader className="text-left"><DrawerTitle className="font-display text-xl">Editar o plano</DrawerTitle></DrawerHeader>
            <div className="flex flex-col gap-4 px-4">
              <div><Label htmlFor="hb-title">Nome</Label><Input id="hb-title" value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-12 rounded-2xl" /></div>
              <div><Label htmlFor="hb-cue">Quando você vai fazer (depois de…)</Label><Input id="hb-cue" value={form.cue_text} maxLength={120} onChange={(e) => setForm({ ...form, cue_text: e.target.value })} placeholder="Depois de tomar café" className="mt-1 h-12 rounded-2xl" /></div>
              <div><Label htmlFor="hb-min">Versão mínima (dia ruim)</Label><Input id="hb-min" value={form.minimum_text} maxLength={120} onChange={(e) => setForm({ ...form, minimum_text: e.target.value })} placeholder="3 respirações" className="mt-1 h-12 rounded-2xl" /></div>
              <Button className="h-12 rounded-full text-[15px] font-semibold" disabled={update.isPending || form.title.trim().length < 2} onClick={() => void save()}>Salvar</Button>
              <p className="text-center text-xs text-muted-foreground">Mudar o plano não altera o seu histórico.</p>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

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
